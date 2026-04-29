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

const STORE_DIR = path.join(__dirname, "data");
const STORE_PATH = path.join(STORE_DIR, "chats.json");
const MAX_LOG_LINES = Number(process.env.MAX_LOG_LINES || 700);
const MAX_MESSAGES_PER_CHAT = Number(process.env.MAX_MESSAGES_PER_CHAT || 120);
const MAX_RUNS_PER_CHAT = Number(process.env.MAX_RUNS_PER_CHAT || 80);

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function trimArray(arr, maxSize) {
  if (arr.length > maxSize) {
    arr.splice(0, arr.length - maxSize);
  }
}

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

function isAssistantItemType(itemType) {
  return ["agent_message", "assistant_message", "agentMessage", "assistantMessage"].includes(itemType);
}

function extractAssistantText(event) {
  const eventType = event.type || event.method;

  if (eventType === "item/agentMessage/delta") {
    return { delta: event.params?.delta || "", final: null };
  }

  if (eventType === "item.completed") {
    const item = event.item || {};
    const itemType = item.type || item.item_type;
    if (isAssistantItemType(itemType) && typeof item.text === "string") {
      return { delta: null, final: item.text };
    }
  }

  if (eventType === "item/completed") {
    const item = event.params?.item || {};
    const itemType = item.type || item.item_type;
    if (isAssistantItemType(itemType) && typeof item.text === "string") {
      return { delta: null, final: item.text };
    }
  }

  return { delta: null, final: null };
}

function makeChat(title) {
  const ts = nowIso();
  return {
    id: randomId("chat"),
    title: title || "New chat",
    createdAt: ts,
    updatedAt: ts,
    status: "idle",
    currentRunId: null,
    lastError: "",
    cwd: DEFAULT_CWD,
    mode: "read-only",
    logs: [],
    messages: [],
    runs: []
  };
}

function lastMessageByRole(chat, role) {
  for (let i = chat.messages.length - 1; i >= 0; i -= 1) {
    if (chat.messages[i].role === role) {
      return chat.messages[i].text;
    }
  }
  return "";
}

function toChatSummary(chat) {
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    status: chat.status,
    currentRunId: chat.currentRunId,
    lastError: chat.lastError,
    cwd: chat.cwd,
    mode: chat.mode,
    messageCount: chat.messages.length,
    runCount: chat.runs.length,
    lastUserMessage: lastMessageByRole(chat, "user"),
    lastAssistantMessage: lastMessageByRole(chat, "assistant")
  };
}

function toChatDetail(chat) {
  return {
    ...toChatSummary(chat),
    logs: chat.logs,
    messages: chat.messages,
    runs: chat.runs
  };
}

const chats = new Map();
const runtimes = new Map();
const clients = new Map();
let persistTimer = null;

function getRuntime(chatId) {
  if (!runtimes.has(chatId)) {
    runtimes.set(chatId, {
      child: null,
      stdoutBuffer: "",
      stderrBuffer: "",
      streamingText: "",
      finalText: ""
    });
  }
  return runtimes.get(chatId);
}

function listChatsSorted() {
  return Array.from(chats.values())
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1))
    .map((chat) => toChatSummary(chat));
}

function send(ws, payload) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(payload));
  }
}

function sendSnapshot(ws) {
  send(ws, {
    type: "chats/snapshot",
    chats: listChatsSorted()
  });
}

function broadcastToAuthed(payload) {
  clients.forEach((clientState, ws) => {
    if (clientState.authed) {
      send(ws, payload);
    }
  });
}

function schedulePersist() {
  if (persistTimer) {
    return;
  }

  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      fs.mkdirSync(STORE_DIR, { recursive: true });
      const payload = {
        version: 1,
        updatedAt: nowIso(),
        chats: Array.from(chats.values())
      };
      const tmpPath = `${STORE_PATH}.tmp`;
      fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), "utf8");
      fs.renameSync(tmpPath, STORE_PATH);
    } catch (err) {
      console.error("failed to persist chats:", err.message);
    }
  }, 160);
}

function restoreChats() {
  let restored = false;

  try {
    if (fs.existsSync(STORE_PATH)) {
      const raw = fs.readFileSync(STORE_PATH, "utf8");
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.chats)) {
        for (const entry of parsed.chats) {
          if (!entry || typeof entry !== "object" || typeof entry.id !== "string") {
            continue;
          }

          const chat = {
            id: entry.id,
            title: typeof entry.title === "string" && entry.title.trim() ? entry.title.trim() : "Restored chat",
            createdAt: typeof entry.createdAt === "string" ? entry.createdAt : nowIso(),
            updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : nowIso(),
            status: "idle",
            currentRunId: null,
            lastError: typeof entry.lastError === "string" ? entry.lastError : "",
            cwd: resolveCwd(entry.cwd) || DEFAULT_CWD,
            mode: entry.mode === "workspace-write" ? "workspace-write" : "read-only",
            logs: Array.isArray(entry.logs) ? entry.logs.slice(-MAX_LOG_LINES) : [],
            messages: Array.isArray(entry.messages) ? entry.messages.slice(-MAX_MESSAGES_PER_CHAT) : [],
            runs: Array.isArray(entry.runs) ? entry.runs.slice(-MAX_RUNS_PER_CHAT) : []
          };

          chats.set(chat.id, chat);
          getRuntime(chat.id);
        }
        restored = chats.size > 0;
      }
    }
  } catch (err) {
    console.error("failed to restore chat store:", err.message);
  }

  if (!restored) {
    const starter = makeChat("General");
    chats.set(starter.id, starter);
    getRuntime(starter.id);
    schedulePersist();
  }
}

function createChat(title) {
  const name = typeof title === "string" && title.trim() ? title.trim() : `Chat ${chats.size + 1}`;
  const chat = makeChat(name);
  chats.set(chat.id, chat);
  getRuntime(chat.id);
  schedulePersist();
  return chat;
}

function addLogLine(chat, line) {
  chat.logs.push(line);
  trimArray(chat.logs, MAX_LOG_LINES);
}

function appendMessage(chat, role, text, runId) {
  chat.messages.push({
    id: randomId("msg"),
    role,
    text,
    runId: runId || null,
    createdAt: nowIso()
  });
  trimArray(chat.messages, MAX_MESSAGES_PER_CHAT);
}

function appendRun(chat, run) {
  chat.runs.push(run);
  trimArray(chat.runs, MAX_RUNS_PER_CHAT);
}

function findRun(chat, runId) {
  for (let i = chat.runs.length - 1; i >= 0; i -= 1) {
    if (chat.runs[i].id === runId) {
      return chat.runs[i];
    }
  }
  return null;
}

restoreChats();

const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    defaultCwd: DEFAULT_CWD,
    allowedRoots: ALLOWED_ROOTS,
    requiresToken: Boolean(APP_TOKEN),
    codexBin: CODEX_BIN,
    chatCount: chats.size
  });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  const state = {
    authed: APP_TOKEN.length === 0
  };

  clients.set(ws, state);

  send(ws, {
    type: "hello",
    requiresToken: APP_TOKEN.length > 0,
    defaultCwd: DEFAULT_CWD,
    allowedRoots: ALLOWED_ROOTS,
    codexBin: CODEX_BIN
  });

  if (state.authed) {
    sendSnapshot(ws);
  }

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
      if (!APP_TOKEN || msg.token === APP_TOKEN) {
        state.authed = true;
        send(ws, { type: "auth/ok" });
        sendSnapshot(ws);
      } else {
        send(ws, { type: "auth/error", error: "Token mismatch." });
      }
      return;
    }

    if (!state.authed) {
      send(ws, { type: "server/error", error: "Not authenticated." });
      return;
    }

    if (msg.type === "create_chat") {
      const chat = createChat(msg.title);
      broadcastToAuthed({ type: "chat/created", chat: toChatSummary(chat) });
      return;
    }

    if (msg.type === "get_chat") {
      const chatId = typeof msg.chatId === "string" ? msg.chatId : "";
      const chat = chats.get(chatId);
      if (!chat) {
        send(ws, { type: "server/error", error: "Chat not found." });
        return;
      }
      send(ws, { type: "chat/detail", chat: toChatDetail(chat) });
      return;
    }

    if (msg.type === "cancel") {
      const chatId = typeof msg.chatId === "string" ? msg.chatId : "";
      const chat = chats.get(chatId);
      const runtime = runtimes.get(chatId);
      if (!chat || !runtime || !runtime.child) {
        send(ws, { type: "server/error", error: "No active run for this chat." });
        return;
      }
      runtime.child.kill("SIGINT");
      setTimeout(() => {
        if (runtime.child) {
          runtime.child.kill("SIGTERM");
        }
      }, 1000);
      return;
    }

    if (msg.type !== "run") {
      send(ws, { type: "server/error", error: "Unsupported message type." });
      return;
    }

    const chatId = typeof msg.chatId === "string" ? msg.chatId : "";
    const chat = chats.get(chatId);

    if (!chat) {
      send(ws, { type: "server/error", error: "Chat not found." });
      return;
    }

    const runtime = getRuntime(chatId);
    if (runtime.child) {
      send(ws, { type: "server/error", error: "This chat already has a running task." });
      return;
    }

    const prompt = typeof msg.prompt === "string" ? msg.prompt.trim() : "";
    const mode = msg.mode === "workspace-write" ? "workspace-write" : "read-only";
    const cwd = resolveCwd(msg.cwd || chat.cwd || DEFAULT_CWD);

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

    const runId = randomId("run");
    const args = buildCodexArgs(prompt, cwd, mode);

    chat.cwd = cwd;
    chat.mode = mode;
    chat.status = "running";
    chat.currentRunId = runId;
    chat.lastError = "";
    chat.updatedAt = nowIso();
    chat.logs = [];

    appendMessage(chat, "user", prompt, runId);
    appendRun(chat, {
      id: runId,
      createdAt: nowIso(),
      completedAt: null,
      status: "running",
      mode,
      cwd,
      prompt,
      command: [CODEX_BIN, ...args].join(" "),
      exitCode: null,
      signal: null,
      finalText: "",
      error: ""
    });

    runtime.stdoutBuffer = "";
    runtime.stderrBuffer = "";
    runtime.streamingText = "";
    runtime.finalText = "";

    const child = spawn(CODEX_BIN, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    });

    runtime.child = child;

    broadcastToAuthed({ type: "chat/updated", chat: toChatSummary(chat) });
    broadcastToAuthed({
      type: "run/accepted",
      chatId,
      runId,
      command: [CODEX_BIN, ...args].join(" "),
      cwd,
      mode
    });

    child.stdout.on("data", (chunk) => {
      runtime.stdoutBuffer += chunk.toString("utf8");

      let nl;
      while ((nl = runtime.stdoutBuffer.indexOf("\n")) >= 0) {
        const line = runtime.stdoutBuffer.slice(0, nl).trim();
        runtime.stdoutBuffer = runtime.stdoutBuffer.slice(nl + 1);

        if (!line) {
          continue;
        }

        addLogLine(chat, line);

        try {
          const event = JSON.parse(line);
          const textUpdate = extractAssistantText(event);
          if (textUpdate.delta) {
            runtime.streamingText += textUpdate.delta;
          }
          if (textUpdate.final) {
            runtime.finalText = textUpdate.final;
          }
          broadcastToAuthed({ type: "run/event", chatId, runId, event });
        } catch {
          broadcastToAuthed({ type: "run/raw", chatId, runId, line });
        }

        chat.updatedAt = nowIso();
      }

      schedulePersist();
    });

    child.stderr.on("data", (chunk) => {
      runtime.stderrBuffer += chunk.toString("utf8");

      let nl;
      while ((nl = runtime.stderrBuffer.indexOf("\n")) >= 0) {
        const line = runtime.stderrBuffer.slice(0, nl).trim();
        runtime.stderrBuffer = runtime.stderrBuffer.slice(nl + 1);
        if (!line) {
          continue;
        }

        addLogLine(chat, `stderr: ${line}`);
        chat.updatedAt = nowIso();
        broadcastToAuthed({ type: "run/stderr", chatId, runId, line });
      }

      schedulePersist();
    });

    child.on("error", (err) => {
      const notFoundHint =
        err && err.code === "ENOENT"
          ? `Codex binary not found: ${CODEX_BIN}. Set CODEX_BIN in .env or fix PATH.`
          : null;
      const errorText = notFoundHint || err.message || "Failed to start codex process.";

      chat.status = "failed";
      chat.currentRunId = null;
      chat.lastError = errorText;
      chat.updatedAt = nowIso();

      const run = findRun(chat, runId);
      if (run) {
        run.status = "failed";
        run.completedAt = nowIso();
        run.error = errorText;
      }

      addLogLine(chat, `run error: ${errorText}`);
      runtime.child = null;

      broadcastToAuthed({ type: "chat/updated", chat: toChatSummary(chat) });
      broadcastToAuthed({ type: "run/error", chatId, runId, error: errorText });
      schedulePersist();
    });

    child.on("close", (code, signal) => {
      if (runtime.stdoutBuffer.trim()) {
        const tail = runtime.stdoutBuffer.trim();
        addLogLine(chat, tail);
        try {
          const event = JSON.parse(tail);
          const textUpdate = extractAssistantText(event);
          if (textUpdate.delta) {
            runtime.streamingText += textUpdate.delta;
          }
          if (textUpdate.final) {
            runtime.finalText = textUpdate.final;
          }
          broadcastToAuthed({ type: "run/event", chatId, runId, event });
        } catch {
          broadcastToAuthed({ type: "run/raw", chatId, runId, line: tail });
        }
      }

      if (runtime.stderrBuffer.trim()) {
        const tailErr = runtime.stderrBuffer.trim();
        addLogLine(chat, `stderr: ${tailErr}`);
        broadcastToAuthed({ type: "run/stderr", chatId, runId, line: tailErr });
      }

      const finalText = runtime.finalText || runtime.streamingText || "";
      if (finalText) {
        appendMessage(chat, "assistant", finalText, runId);
      }

      const run = findRun(chat, runId);
      if (run) {
        run.completedAt = nowIso();
        run.exitCode = code;
        run.signal = signal || null;
        run.status = code === 0 ? "completed" : "failed";
        run.finalText = finalText;
        if (code !== 0 && !run.error) {
          run.error = `Exit code ${String(code)}`;
        }
      }

      chat.status = code === 0 ? "idle" : "failed";
      chat.currentRunId = null;
      if (code === 0) {
        chat.lastError = "";
      } else {
        chat.lastError = `Run failed with exit ${String(code)}`;
      }
      chat.updatedAt = nowIso();

      runtime.child = null;
      runtime.stdoutBuffer = "";
      runtime.stderrBuffer = "";
      runtime.streamingText = "";
      runtime.finalText = "";

      broadcastToAuthed({ type: "chat/updated", chat: toChatSummary(chat) });
      broadcastToAuthed({
        type: code === 0 ? "run/completed" : "run/failed",
        chatId,
        runId,
        exitCode: code,
        signal: signal || null,
        finalText
      });

      schedulePersist();
    });

    schedulePersist();
  });

  ws.on("close", () => {
    clients.delete(ws);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`codex-mobile-bridge listening on http://${HOST}:${PORT}`);
  console.log(`default cwd: ${DEFAULT_CWD}`);
  console.log(`allowed roots: ${ALLOWED_ROOTS.join(", ")}`);
  console.log(`codex bin: ${CODEX_BIN}`);
  console.log(`token required: ${APP_TOKEN ? "yes" : "no"}`);
  console.log(`chat store: ${STORE_PATH}`);
});
