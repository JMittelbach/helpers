const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const { WebSocketServer } = require("ws");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const APP_TOKEN = process.env.APP_TOKEN || "";
const EXPLICIT_CODEX_BIN = process.env.CODEX_BIN || "";
const DEFAULT_CWD = path.resolve(process.env.DEFAULT_CWD || "/Users/jannes/Github");
const ALLOWED_ROOTS = (process.env.ALLOWED_ROOTS || DEFAULT_CWD)
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean)
  .map((p) => path.resolve(p));

function findBundledCodex() {
  const extRoot = path.join(os.homedir(), ".vscode", "extensions");

  let entries;
  try {
    entries = fs.readdirSync(extRoot, { withFileTypes: true });
  } catch {
    return null;
  }

  const matches = entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("openai.chatgpt-"))
    .map((entry) => {
      const fullDir = path.join(extRoot, entry.name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(fullDir).mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      return { fullDir, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const match of matches) {
    const candidates = [
      path.join(match.fullDir, "bin", "macos-aarch64", "codex"),
      path.join(match.fullDir, "bin", "macos-x64", "codex"),
      path.join(match.fullDir, "bin", "linux-x64", "codex"),
      path.join(match.fullDir, "bin", "linux-arm64", "codex")
    ];

    for (const candidate of candidates) {
      try {
        fs.accessSync(candidate, fs.constants.X_OK);
        return candidate;
      } catch {
        continue;
      }
    }
  }

  return null;
}

const DETECTED_CODEX_BIN = findBundledCodex();
const CODEX_BIN = EXPLICIT_CODEX_BIN || DETECTED_CODEX_BIN || "codex";

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    defaultCwd: DEFAULT_CWD,
    allowedRoots: ALLOWED_ROOTS,
    requiresToken: Boolean(APP_TOKEN),
    codexBin: CODEX_BIN
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function send(ws, payload) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function isPathAllowed(targetPath) {
  const resolvedTarget = path.resolve(targetPath);
  return ALLOWED_ROOTS.some((root) => {
    return resolvedTarget === root || resolvedTarget.startsWith(root + path.sep);
  });
}

function resolveCwd(cwd) {
  const resolved = path.resolve(cwd || DEFAULT_CWD);
  return isPathAllowed(resolved) ? resolved : null;
}

function buildCodexArgs(prompt, cwd, mode) {
  const args = ["exec", "--json", "--cwd", cwd];

  if (mode === "workspace-write") {
    args.push("--sandbox", "workspace-write");
  } else {
    args.push("--sandbox", "read-only");
  }

  args.push(prompt);
  return args;
}

function maybeCaptureAgentText(event, state) {
  const eventType = event.type || event.method;

  if (eventType === "item/agentMessage/delta" && event.params?.delta) {
    state.streamingText += event.params.delta;
  }

  if (eventType === "item.completed") {
    const item = event.item;
    if (item && item.type === "agent_message" && typeof item.text === "string") {
      state.finalText = item.text;
    }
  }

  if (eventType === "item/completed") {
    const item = event.params?.item;
    if (item && item.type === "agentMessage" && typeof item.text === "string") {
      state.finalText = item.text;
    }
  }
}

wss.on("connection", (ws) => {
  const state = {
    authed: APP_TOKEN.length === 0,
    child: null,
    stdoutBuffer: "",
    stderrBuffer: "",
    runId: null,
    finalText: "",
    streamingText: ""
  };

  send(ws, {
    type: "hello",
    requiresToken: APP_TOKEN.length > 0,
    defaultCwd: DEFAULT_CWD,
    allowedRoots: ALLOWED_ROOTS,
    running: false
  });

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      send(ws, { type: "server/error", error: "Invalid JSON message." });
      return;
    }

    if (msg.type === "ping") {
      send(ws, { type: "pong", ts: Date.now() });
      return;
    }

    if (msg.type === "auth") {
      if (!APP_TOKEN) {
        state.authed = true;
        send(ws, { type: "auth/ok" });
        return;
      }

      if (msg.token === APP_TOKEN) {
        state.authed = true;
        send(ws, { type: "auth/ok" });
      } else {
        send(ws, { type: "auth/error", error: "Token mismatch." });
      }
      return;
    }

    if (msg.type === "cancel") {
      if (state.child) {
        state.child.kill("SIGINT");
        setTimeout(() => {
          if (state.child) {
            state.child.kill("SIGTERM");
          }
        }, 1000);
      }
      return;
    }

    if (msg.type !== "run") {
      send(ws, { type: "server/error", error: "Unsupported message type." });
      return;
    }

    if (!state.authed) {
      send(ws, { type: "server/error", error: "Not authenticated." });
      return;
    }

    if (state.child) {
      send(ws, { type: "server/error", error: "Another run is already active." });
      return;
    }

    const prompt = typeof msg.prompt === "string" ? msg.prompt.trim() : "";
    const mode = msg.mode === "workspace-write" ? "workspace-write" : "read-only";
    const cwd = resolveCwd(msg.cwd);

    if (!prompt) {
      send(ws, { type: "server/error", error: "Prompt is empty." });
      return;
    }

    if (prompt.length > 12000) {
      send(ws, { type: "server/error", error: "Prompt too long (max 12000 chars)." });
      return;
    }

    if (!cwd) {
      send(ws, {
        type: "server/error",
        error: "Invalid workspace path. It must stay inside allowed roots."
      });
      return;
    }

    const args = buildCodexArgs(prompt, cwd, mode);
    const runId = `run_${Date.now()}`;

    state.runId = runId;
    state.finalText = "";
    state.streamingText = "";
    state.stdoutBuffer = "";
    state.stderrBuffer = "";

    send(ws, {
      type: "run/accepted",
      runId,
      command: [CODEX_BIN, ...args].join(" "),
      cwd,
      mode
    });

    const child = spawn(CODEX_BIN, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    state.child = child;

    child.stdout.on("data", (chunk) => {
      state.stdoutBuffer += chunk.toString("utf8");

      let nl;
      while ((nl = state.stdoutBuffer.indexOf("\n")) >= 0) {
        const line = state.stdoutBuffer.slice(0, nl).trim();
        state.stdoutBuffer = state.stdoutBuffer.slice(nl + 1);

        if (!line) {
          continue;
        }

        try {
          const event = JSON.parse(line);
          maybeCaptureAgentText(event, state);
          send(ws, { type: "run/event", runId, event });
        } catch {
          send(ws, { type: "run/raw", runId, line });
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      state.stderrBuffer += chunk.toString("utf8");

      let nl;
      while ((nl = state.stderrBuffer.indexOf("\n")) >= 0) {
        const line = state.stderrBuffer.slice(0, nl);
        state.stderrBuffer = state.stderrBuffer.slice(nl + 1);
        if (line.trim()) {
          send(ws, { type: "run/stderr", runId, line });
        }
      }
    });

    child.on("error", (err) => {
      const notFoundHint =
        err && err.code === "ENOENT"
          ? `Codex binary not found: ${CODEX_BIN}. Set CODEX_BIN in .env or fix PATH.`
          : null;
      send(ws, {
        type: "run/error",
        runId,
        error: notFoundHint || err.message || "Failed to start codex process."
      });
    });

    child.on("close", (code, signal) => {
      if (state.stdoutBuffer.trim()) {
        const tail = state.stdoutBuffer.trim();
        try {
          const event = JSON.parse(tail);
          maybeCaptureAgentText(event, state);
          send(ws, { type: "run/event", runId, event });
        } catch {
          send(ws, { type: "run/raw", runId, line: tail });
        }
      }

      if (state.stderrBuffer.trim()) {
        send(ws, { type: "run/stderr", runId, line: state.stderrBuffer.trim() });
      }

      const finalText = state.finalText || state.streamingText || "";
      send(ws, {
        type: code === 0 ? "run/completed" : "run/failed",
        runId,
        exitCode: code,
        signal: signal || null,
        finalText
      });

      state.child = null;
      state.runId = null;
      state.stdoutBuffer = "";
      state.stderrBuffer = "";
      state.finalText = "";
      state.streamingText = "";
    });
  });

  ws.on("close", () => {
    if (state.child) {
      state.child.kill("SIGTERM");
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`codex-mobile-bridge listening on http://${HOST}:${PORT}`);
  console.log(`default cwd: ${DEFAULT_CWD}`);
  console.log(`allowed roots: ${ALLOWED_ROOTS.join(", ")}`);
  console.log(`codex bin: ${CODEX_BIN}`);
  console.log(`token required: ${APP_TOKEN ? "yes" : "no"}`);
});
