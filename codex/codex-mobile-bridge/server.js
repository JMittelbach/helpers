const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync, spawn } = require("child_process");

require("dotenv").config();

const express = require("express");
const helmet = require("helmet");
const { WebSocketServer } = require("ws");

const HOST = process.env.HOST || "0.0.0.0";
const PORT = Number(process.env.PORT || 4173);
const APP_TOKEN = process.env.APP_TOKEN || "";
const EXPLICIT_CODEX_BIN = process.env.CODEX_BIN || "";
const EXPLICIT_GITHUB_PROFILE_URL = process.env.GITHUB_PROFILE_URL || "";
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
const VSCODE_MIRROR_ENABLED = process.env.VSCODE_MIRROR_ENABLED !== "0";
const VSCODE_MIRROR_SCAN_MS = Math.max(Number(process.env.VSCODE_MIRROR_SCAN_MS || 3000), 1200);
const VSCODE_MIRROR_MAX_FILES = Math.max(Number(process.env.VSCODE_MIRROR_MAX_FILES || 300), 20);
const CODEX_SESSION_MIRROR_ENABLED = process.env.CODEX_SESSION_MIRROR_ENABLED !== "0";
const CODEX_SESSION_MIRROR_MAX_FILES = Math.max(Number(process.env.CODEX_SESSION_MIRROR_MAX_FILES || 120), 10);
const DEFAULT_VSCODE_MIRROR_ROOTS = [
  path.join(os.homedir(), "Library/Application Support/Code/User/workspaceStorage"),
  path.join(os.homedir(), "Library/Application Support/Code - Insiders/User/workspaceStorage"),
  path.join(os.homedir(), "Library/Application Support/Code/User/globalStorage/emptyWindowChatSessions"),
  path.join(os.homedir(), "Library/Application Support/Code - Insiders/User/globalStorage/emptyWindowChatSessions")
];
const VSCODE_MIRROR_ROOTS = (process.env.VSCODE_MIRROR_ROOTS || DEFAULT_VSCODE_MIRROR_ROOTS.join(","))
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
const CODEX_SESSION_ROOTS = [
  path.join(os.homedir(), ".codex/sessions"),
  path.join(os.homedir(), ".codex/archived_sessions")
];
const CODEX_SESSION_INDEX_PATH = path.join(os.homedir(), ".codex/session_index.jsonl");
const BROWSE_MAX_ENTRIES = Math.max(Number(process.env.BROWSE_MAX_ENTRIES || 400), 40);
const BROWSE_MAX_FILE_BYTES = Math.max(Number(process.env.BROWSE_MAX_FILE_BYTES || 160000), 8000);
const APP_SERVER_ENABLED = process.env.APP_SERVER_ENABLED !== "0";
const APP_SERVER_SYNC_MS = Math.max(Number(process.env.APP_SERVER_SYNC_MS || 5000), 1500);
const APP_SERVER_THREAD_LIMIT = Math.max(Number(process.env.APP_SERVER_THREAD_LIMIT || 200), 20);
const APP_SERVER_REQUEST_TIMEOUT_MS = Math.max(Number(process.env.APP_SERVER_REQUEST_TIMEOUT_MS || 25000), 3000);

function dedupePaths(paths) {
  const uniq = [];
  const seen = new Set();
  for (const rawPath of paths) {
    if (!rawPath || typeof rawPath !== "string") {
      continue;
    }
    const resolved = path.resolve(rawPath.trim());
    if (!resolved || seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    uniq.push(resolved);
  }
  return uniq;
}

function normalizeGithubProfileUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    return "";
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return "";
  }
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed.replace(/^\/+/, "")}`;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return "";
    }
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "";
  }
}

function githubOwnerFromRemote(remoteUrl) {
  const raw = typeof remoteUrl === "string" ? remoteUrl.trim() : "";
  if (!raw) {
    return "";
  }
  const patterns = [
    /^git@github\.com:([^/]+)\/[^/]+(?:\.git)?$/i,
    /^ssh:\/\/git@github\.com\/([^/]+)\/[^/]+(?:\.git)?\/?$/i,
    /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/[^/]+(?:\.git)?\/?$/i
  ];
  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }
  return "";
}

function detectGithubProfileUrl() {
  const explicit = normalizeGithubProfileUrl(EXPLICIT_GITHUB_PROFILE_URL);
  if (explicit) {
    return explicit;
  }

  const probeDirs = dedupePaths([__dirname, process.cwd(), DEFAULT_CWD]);
  for (const probeDir of probeDirs) {
    try {
      const remote = execSync("git config --get remote.origin.url", {
        cwd: probeDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"]
      }).trim();
      const owner = githubOwnerFromRemote(remote);
      if (owner) {
        return `https://github.com/${owner}`;
      }
    } catch {
      continue;
    }
  }

  return "";
}

const DEFAULT_BROWSE_ROOTS = dedupePaths([
  ...ALLOWED_ROOTS,
  path.join(os.homedir(), ".codex"),
  path.join(os.homedir(), "Library/Application Support/Code/User"),
  ...VSCODE_MIRROR_ROOTS
]);
const BROWSE_ROOTS = dedupePaths(
  (process.env.BROWSE_ROOTS || DEFAULT_BROWSE_ROOTS.join(","))
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)
);

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

function toNumberOrNull(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return num;
}

function toIntOrNull(value) {
  const num = toNumberOrNull(value);
  if (num === null) {
    return null;
  }
  return Math.max(0, Math.round(num));
}

function normalizeTokenUsage(rawUsage) {
  if (!rawUsage || typeof rawUsage !== "object") {
    return null;
  }

  const inputTokens = toIntOrNull(rawUsage.input_tokens ?? rawUsage.inputTokens) || 0;
  const cachedInputTokens = toIntOrNull(rawUsage.cached_input_tokens ?? rawUsage.cachedInputTokens) || 0;
  const outputTokens = toIntOrNull(rawUsage.output_tokens ?? rawUsage.outputTokens) || 0;
  const reasoningOutputTokens =
    toIntOrNull(rawUsage.reasoning_output_tokens ?? rawUsage.reasoningOutputTokens) || 0;
  const explicitTotal = toIntOrNull(rawUsage.total_tokens ?? rawUsage.totalTokens);
  const totalTokens =
    explicitTotal !== null ? explicitTotal : inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens;

  if (totalTokens === 0 && inputTokens === 0 && cachedInputTokens === 0 && outputTokens === 0 && reasoningOutputTokens === 0) {
    return null;
  }

  return {
    inputTokens,
    cachedInputTokens,
    outputTokens,
    reasoningOutputTokens,
    totalTokens
  };
}

function normalizeRateLimitBucket(rawBucket) {
  if (!rawBucket || typeof rawBucket !== "object") {
    return null;
  }

  const usedPercentRaw = toNumberOrNull(rawBucket.used_percent ?? rawBucket.usedPercent);
  const windowMinutes = toIntOrNull(rawBucket.window_minutes ?? rawBucket.windowMinutes);
  const resetsAt = toIntOrNull(rawBucket.resets_at ?? rawBucket.resetsAt);

  if (usedPercentRaw === null && windowMinutes === null && resetsAt === null) {
    return null;
  }

  const usedPercent = usedPercentRaw === null ? null : Math.max(0, Math.min(100, Math.round(usedPercentRaw * 10) / 10));
  return {
    usedPercent,
    windowMinutes,
    resetsAt
  };
}

function normalizeCredits(rawCredits) {
  if (!rawCredits || typeof rawCredits !== "object") {
    return null;
  }

  const hasCredits = typeof rawCredits.has_credits === "boolean" ? rawCredits.has_credits : null;
  const unlimited = typeof rawCredits.unlimited === "boolean" ? rawCredits.unlimited : null;
  const balance =
    rawCredits.balance === null || rawCredits.balance === undefined ? null : String(rawCredits.balance);

  if (hasCredits === null && unlimited === null && balance === null) {
    return null;
  }

  return {
    hasCredits,
    unlimited,
    balance
  };
}

function normalizeTokenStats(rawStats) {
  if (!rawStats || typeof rawStats !== "object") {
    return null;
  }

  const total = normalizeTokenUsage(rawStats.total || rawStats.totalUsage);
  const last = normalizeTokenUsage(rawStats.last || rawStats.lastUsage);
  const modelContextWindow = toIntOrNull(rawStats.modelContextWindow || rawStats.model_context_window);
  const primary = normalizeRateLimitBucket(rawStats.rateLimits?.primary || rawStats.primary);
  const secondary = normalizeRateLimitBucket(rawStats.rateLimits?.secondary || rawStats.secondary);
  const credits = normalizeCredits(rawStats.rateLimits?.credits || rawStats.credits);
  const updatedAt = typeof rawStats.updatedAt === "string" && rawStats.updatedAt ? rawStats.updatedAt : null;
  const source = typeof rawStats.source === "string" && rawStats.source ? rawStats.source : "token_count";

  if (!total && !last && modelContextWindow === null && !primary && !secondary && !credits) {
    return null;
  }

  const rateLimits = {};
  if (primary) {
    rateLimits.primary = primary;
  }
  if (secondary) {
    rateLimits.secondary = secondary;
  }
  if (credits) {
    rateLimits.credits = credits;
  }

  return {
    source,
    updatedAt,
    modelContextWindow,
    total,
    last,
    rateLimits
  };
}

function parseTokenCountPayload(payload, timestampHint) {
  if (!payload || typeof payload !== "object" || payload.type !== "token_count") {
    return null;
  }

  const info = payload.info && typeof payload.info === "object" ? payload.info : {};
  return normalizeTokenStats({
    source: "token_count",
    updatedAt: typeof timestampHint === "string" && timestampHint ? timestampHint : nowIso(),
    modelContextWindow: info.model_context_window ?? info.modelContextWindow,
    total: info.total_token_usage ?? info.totalTokenUsage,
    last: info.last_token_usage ?? info.lastTokenUsage,
    rateLimits: payload.rate_limits ?? payload.rateLimits
  });
}

function applyTokenCountEvent(chat, runId, event) {
  if (!chat || !event || typeof event !== "object") {
    return false;
  }
  if (event.type !== "event_msg") {
    return false;
  }

  const tokenStats = parseTokenCountPayload(event.payload, toIsoFromAny(event.timestamp, Date.now()));
  if (!tokenStats) {
    return false;
  }

  chat.tokenStats = tokenStats;
  const candidateRunId =
    typeof runId === "string" && runId
      ? runId
      : typeof chat.currentRunId === "string" && chat.currentRunId
        ? chat.currentRunId
        : "";
  if (candidateRunId) {
    const run = findRun(chat, candidateRunId);
    if (run) {
      run.tokenUsage = tokenStats.last || run.tokenUsage || null;
      run.tokenStatsUpdatedAt = tokenStats.updatedAt;
    }
  }

  return true;
}

function extractTokenStatsFromTurn(turn) {
  if (!turn || typeof turn !== "object") {
    return null;
  }

  const usage = turn.tokenUsage || turn.token_usage || turn.usage || null;
  const total =
    (usage && (usage.total_token_usage || usage.totalTokenUsage || usage.total)) ||
    turn.total_token_usage ||
    turn.totalTokenUsage ||
    null;
  const last =
    (usage && (usage.last_token_usage || usage.lastTokenUsage || usage.last)) ||
    turn.last_token_usage ||
    turn.lastTokenUsage ||
    null;
  const rateLimits =
    (usage && (usage.rate_limits || usage.rateLimits || usage.limits)) ||
    turn.rate_limits ||
    turn.rateLimits ||
    null;

  return normalizeTokenStats({
    source: "turn_usage",
    updatedAt: toIsoFromAny(turn.completedAt || turn.startedAt, Date.now()),
    modelContextWindow:
      (usage && (usage.model_context_window || usage.modelContextWindow)) ||
      turn.model_context_window ||
      turn.modelContextWindow ||
      null,
    total,
    last,
    rateLimits
  });
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
const GITHUB_PROFILE_URL = detectGithubProfileUrl();

function isPathAllowed(targetPath) {
  const resolvedTarget = path.resolve(targetPath);
  return ALLOWED_ROOTS.some((root) => {
    return resolvedTarget === root || resolvedTarget.startsWith(root + path.sep);
  });
}

function isPathWithinRoots(targetPath, roots) {
  const resolvedTarget = path.resolve(targetPath);
  return roots.some((root) => resolvedTarget === root || resolvedTarget.startsWith(root + path.sep));
}

function resolveCwd(cwd) {
  const resolved = path.resolve(cwd || DEFAULT_CWD);
  return isPathAllowed(resolved) ? resolved : null;
}

function resolveBrowsePath(targetPath) {
  const candidate = path.resolve(targetPath || BROWSE_ROOTS[0] || DEFAULT_CWD);
  return isPathWithinRoots(candidate, BROWSE_ROOTS) ? candidate : null;
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

function buildCodexResumeArgs(sessionId, prompt) {
  return ["exec", "resume", "--json", sessionId, prompt];
}

function resolveExistingDir(targetPath, fallbackDir) {
  const candidate = path.resolve(targetPath || fallbackDir || DEFAULT_CWD);
  try {
    const stat = fs.statSync(candidate);
    if (stat.isDirectory()) {
      return candidate;
    }
  } catch {
    return path.resolve(fallbackDir || DEFAULT_CWD);
  }
  return path.resolve(fallbackDir || DEFAULT_CWD);
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
    source: "local",
    readOnly: false,
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
    runs: [],
    tokenStats: null
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
  const linkedLiveChatId = findLinkedLiveChatId(chat);
  const tokenStats = normalizeTokenStats(chat.tokenStats);
  return {
    id: chat.id,
    source: chat.source || "local",
    readOnly: Boolean(chat.readOnly),
    linkedLiveChatId,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    status: chat.status,
    currentRunId: chat.currentRunId,
    lastError: chat.lastError,
    cwd: chat.cwd,
    mode: chat.mode,
    tokenStats,
    messageCount: chat.messages.length,
    runCount: chat.runs.length,
    lastUserMessage: lastMessageByRole(chat, "user"),
    lastAssistantMessage: lastMessageByRole(chat, "assistant")
  };
}

function toChatDetail(chat) {
  const approvals = getChatApprovals(chat);
  return {
    ...toChatSummary(chat),
    logs: chat.logs,
    messages: chat.messages,
    runs: chat.runs,
    mirror: chat.mirror || null,
    approvals
  };
}

const chats = new Map();
const mirroredChats = new Map();
const appServerChats = new Map();
const runtimes = new Map();
const clients = new Map();
const codexSessionFileCache = new Map();
let persistTimer = null;
let mirrorScanTimer = null;
const appServerState = {
  child: null,
  stdoutBuffer: "",
  pending: new Map(),
  pendingApprovals: new Map(),
  activeTurnByThread: new Map(),
  runningTurnByThread: new Map(),
  nextId: 1,
  ready: false,
  syncing: false,
  initialized: false,
  restartTimer: null,
  syncTimer: null
};

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

function getAnyChat(chatId) {
  return chats.get(chatId) || mirroredChats.get(chatId) || appServerChats.get(chatId) || null;
}

function canResumeCodexMirror(chat) {
  return Boolean(
    chat &&
      chat.readOnly &&
      chat.source === "codex-session-mirror" &&
      chat.mirror &&
      typeof chat.mirror.sessionId === "string" &&
      chat.mirror.sessionId
  );
}

function appChatIdForThread(threadId) {
  return `as:${threadId}`;
}

function appThreadIdFromChatId(chatId) {
  if (typeof chatId !== "string" || !chatId.startsWith("as:")) {
    return "";
  }
  return chatId.slice(3);
}

function isAppServerChat(chat) {
  return Boolean(chat && chat.source === "app-server-thread" && chat.appThread && chat.appThread.threadId);
}

function extractThreadIdCandidate(rawValue) {
  if (typeof rawValue !== "string" || !rawValue.trim()) {
    return "";
  }
  const m = rawValue.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return m ? m[0] : "";
}

function findAppChatIdByPath(targetPath) {
  if (typeof targetPath !== "string" || !targetPath) {
    return "";
  }
  const resolvedTarget = path.resolve(targetPath);
  for (const chat of appServerChats.values()) {
    if (!isAppServerChat(chat) || !chat.appThread || typeof chat.appThread.path !== "string" || !chat.appThread.path) {
      continue;
    }
    if (path.resolve(chat.appThread.path) === resolvedTarget) {
      return chat.id;
    }
  }
  return "";
}

function mirrorThreadId(chat) {
  if (!chat || !chat.readOnly || !chat.mirror || typeof chat.mirror !== "object") {
    return "";
  }

  const direct = extractThreadIdCandidate(chat.mirror.sessionId);
  if (direct) {
    return direct;
  }

  const fromPath = extractThreadIdCandidate(chat.mirror.path);
  if (fromPath) {
    return fromPath;
  }

  const fromId = extractThreadIdCandidate(chat.id);
  if (fromId) {
    return fromId;
  }

  return "";
}

function findLinkedLiveChatId(chat) {
  if (!chat || isAppServerChat(chat)) {
    return "";
  }

  const threadId = mirrorThreadId(chat);
  if (threadId) {
    const appChatId = appChatIdForThread(threadId);
    if (appServerChats.has(appChatId)) {
      return appChatId;
    }
  }

  if (chat.mirror && typeof chat.mirror.path === "string" && chat.mirror.path) {
    return findAppChatIdByPath(chat.mirror.path);
  }

  return "";
}

function getChatApprovals(chat) {
  if (!isAppServerChat(chat)) {
    return [];
  }
  const threadId = chat.appThread.threadId;
  const list = appServerState.pendingApprovals.get(threadId) || [];
  return list
    .map((req) => ({
      requestId: req.requestId,
      method: req.method,
      createdAt: req.createdAt,
      params: req.params
    }))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

function listChatsSorted() {
  return [...Array.from(chats.values()), ...Array.from(mirroredChats.values()), ...Array.from(appServerChats.values())]
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
            source: "local",
            readOnly: false,
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
            runs: Array.isArray(entry.runs) ? entry.runs.slice(-MAX_RUNS_PER_CHAT) : [],
            tokenStats: normalizeTokenStats(entry.tokenStats)
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

function cloneAnyChatToLocal(sourceChat, requestedTitle) {
  const sourceTitle = sourceChat && sourceChat.title ? sourceChat.title : "Imported chat";
  const cloneTitle =
    typeof requestedTitle === "string" && requestedTitle.trim()
      ? requestedTitle.trim()
      : `Continue: ${sourceTitle}`.slice(0, 96);
  const chat = makeChat(cloneTitle);

  if (sourceChat && Array.isArray(sourceChat.messages)) {
    chat.messages = sourceChat.messages
      .map((msg) => ({
        id: randomId("msg"),
        role: msg && msg.role === "assistant" ? "assistant" : "user",
        text: typeof msg?.text === "string" ? msg.text : "",
        runId: null,
        createdAt: typeof msg?.createdAt === "string" ? msg.createdAt : nowIso()
      }))
      .filter((msg) => msg.text);
    trimArray(chat.messages, MAX_MESSAGES_PER_CHAT);
  }

  if (sourceChat && sourceChat.cwd) {
    const safeCwd = resolveCwd(sourceChat.cwd);
    if (safeCwd) {
      chat.cwd = safeCwd;
    }
  }

  chat.mode = "read-only";
  chat.tokenStats = normalizeTokenStats(sourceChat && sourceChat.tokenStats);
  chat.logs = [
    `[clone] source=${sourceChat?.id || "unknown"}`,
    `[clone] title=${sourceTitle}`
  ];
  chat.updatedAt = nowIso();

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

function safeJsonParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function normalizePathSegments(rawPath) {
  if (Array.isArray(rawPath)) {
    return rawPath.map((p) => (typeof p === "string" && /^\d+$/.test(p) ? Number(p) : p)).filter((p) => p !== "");
  }

  if (typeof rawPath !== "string") {
    return [];
  }

  const trimmed = rawPath.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    const parsed = safeJsonParse(trimmed);
    if (Array.isArray(parsed)) {
      return normalizePathSegments(parsed);
    }
  }

  return trimmed
    .split(".")
    .filter(Boolean)
    .map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

function applyDeltaAtPath(target, rawPath, value) {
  const segments = normalizePathSegments(rawPath);
  if (!segments.length || !target || typeof target !== "object") {
    return;
  }

  let node = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const seg = segments[i];
    const nextSeg = segments[i + 1];

    if (typeof seg === "number") {
      if (!Array.isArray(node)) {
        return;
      }
      if (node[seg] === undefined || node[seg] === null || typeof node[seg] !== "object") {
        node[seg] = typeof nextSeg === "number" ? [] : {};
      }
      node = node[seg];
      continue;
    }

    if (node[seg] === undefined || node[seg] === null || typeof node[seg] !== "object") {
      node[seg] = typeof nextSeg === "number" ? [] : {};
    }
    node = node[seg];
  }

  const finalSeg = segments[segments.length - 1];
  if (typeof finalSeg === "number") {
    if (!Array.isArray(node)) {
      return;
    }
    node[finalSeg] = value;
    return;
  }

  node[finalSeg] = value;
}

function parseSessionJsonl(raw) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  let session = null;

  for (const line of lines) {
    const parsed = safeJsonParse(line);
    if (!parsed || typeof parsed !== "object") {
      continue;
    }

    if (parsed.kind === 0 && parsed.v && typeof parsed.v === "object") {
      session = deepClone(parsed.v);
      continue;
    }

    if ((parsed.kind === 1 || parsed.kind === 2) && session && parsed.k !== undefined) {
      applyDeltaAtPath(session, parsed.k, parsed.v);
      continue;
    }

    if (parsed.v && typeof parsed.v === "object") {
      session = deepClone(parsed.v);
      continue;
    }

    if (!session && (parsed.sessionId || parsed.requests || parsed.pendingRequests)) {
      session = deepClone(parsed);
    }
  }

  return session;
}

function readSessionFromFile(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  if (!raw.trim()) {
    return null;
  }

  if (filePath.endsWith(".jsonl")) {
    return parseSessionJsonl(raw);
  }

  const parsed = safeJsonParse(raw);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }
  if (parsed.v && typeof parsed.v === "object") {
    return parsed.v;
  }
  return parsed;
}

function toIsoFromAny(value, fallbackMs) {
  if (typeof value === "string") {
    const ms = Date.parse(value);
    if (!Number.isNaN(ms)) {
      return new Date(ms).toISOString();
    }
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    return new Date(ms).toISOString();
  }

  return new Date(fallbackMs || Date.now()).toISOString();
}

function textFromMessage(message) {
  if (typeof message === "string") {
    return message.trim();
  }
  if (!message || typeof message !== "object") {
    return "";
  }
  if (typeof message.text === "string" && message.text.trim()) {
    return message.text.trim();
  }

  if (Array.isArray(message.parts)) {
    const bits = [];
    for (const part of message.parts) {
      if (typeof part === "string" && part.trim()) {
        bits.push(part.trim());
      } else if (part && typeof part === "object") {
        if (typeof part.text === "string" && part.text.trim()) {
          bits.push(part.text.trim());
        }
        if (typeof part.value === "string" && part.value.trim()) {
          bits.push(part.value.trim());
        }
      }
    }
    return bits.join("\n").trim();
  }

  return "";
}

function collectStrings(value, out, depth = 0) {
  if (depth > 7 || out.length >= 40 || value === null || value === undefined) {
    return;
  }

  if (typeof value === "string") {
    const t = value.trim();
    if (t) {
      out.push(t);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, out, depth + 1);
      if (out.length >= 40) {
        return;
      }
    }
    return;
  }

  if (typeof value === "object") {
    if (typeof value.text === "string") {
      collectStrings(value.text, out, depth + 1);
    }
    if (typeof value.value === "string") {
      collectStrings(value.value, out, depth + 1);
    }
    if (typeof value.markdown === "string") {
      collectStrings(value.markdown, out, depth + 1);
    }

    const nestedKeys = ["response", "result", "parts", "items", "content", "messages"];
    for (const key of nestedKeys) {
      if (value[key] !== undefined) {
        collectStrings(value[key], out, depth + 1);
      }
    }
  }
}

function extractAssistantTextFromRequest(request) {
  const candidates = [];
  collectStrings(request.response, candidates);
  collectStrings(request.result, candidates);
  collectStrings(request.responseMarkdownInfo, candidates);

  const unique = [];
  const seen = new Set();
  for (const c of candidates) {
    const clean = c.replace(/\s+/g, " ").trim();
    if (!clean) {
      continue;
    }
    if (clean.length < 3) {
      continue;
    }
    if (seen.has(clean)) {
      continue;
    }
    seen.add(clean);
    unique.push(clean);
  }

  return unique.join("\n\n").slice(0, 12000);
}

function toVscodeMirrorChat(session, filePath, stat) {
  if (!session || typeof session !== "object") {
    return null;
  }

  const sessionId =
    (typeof session.sessionId === "string" && session.sessionId) ||
    path.basename(filePath).replace(/\.(json|jsonl)$/i, "");
  if (!sessionId) {
    return null;
  }

  const requests = Array.isArray(session.requests) ? session.requests : [];
  const pendingRequests = Array.isArray(session.pendingRequests) ? session.pendingRequests : [];
  const messages = [];
  const runs = [];

  for (const req of requests) {
    const requestId = (req && typeof req.requestId === "string" && req.requestId) || randomId("vscode_req");
    const requestTs = toIsoFromAny(req?.timestamp, stat.mtimeMs);
    const userText = textFromMessage(req?.message);
    if (userText) {
      messages.push({
        id: `vscode_msg_user_${requestId}`,
        role: "user",
        text: userText,
        runId: requestId,
        createdAt: requestTs
      });
    }

    const assistantText = extractAssistantTextFromRequest(req || {});
    if (assistantText) {
      messages.push({
        id: `vscode_msg_assistant_${requestId}`,
        role: "assistant",
        text: assistantText,
        runId: requestId,
        createdAt: requestTs
      });
    }

    runs.push({
      id: `vscode_run_${requestId}`,
      createdAt: requestTs,
      completedAt: requestTs,
      status: "completed",
      mode: "read-only",
      cwd: DEFAULT_CWD,
      prompt: userText || "",
      command: "vscode-chat-session (mirrored)",
      exitCode: 0,
      signal: null,
      finalText: assistantText || "",
      error: ""
    });
  }

  for (const req of pendingRequests) {
    const pendingId = (req && typeof req.requestId === "string" && req.requestId) || randomId("vscode_pending");
    const requestTs = toIsoFromAny(req?.timestamp, stat.mtimeMs);
    const userText = textFromMessage(req?.message);
    if (userText) {
      messages.push({
        id: `vscode_msg_pending_${pendingId}`,
        role: "user",
        text: userText,
        runId: pendingId,
        createdAt: requestTs
      });
    }

    runs.push({
      id: `vscode_run_${pendingId}`,
      createdAt: requestTs,
      completedAt: null,
      status: "running",
      mode: "read-only",
      cwd: DEFAULT_CWD,
      prompt: userText || "",
      command: "vscode-chat-session (mirrored, pending)",
      exitCode: null,
      signal: null,
      finalText: "",
      error: ""
    });
  }

  const createdAt = toIsoFromAny(session.creationDate, stat.mtimeMs);
  const updatedAt = toIsoFromAny(session.lastMessageDate || session.creationDate, stat.mtimeMs);
  const titleSeed = textFromMessage(requests[0]?.message) || textFromMessage(pendingRequests[0]?.message) || sessionId;
  const title = titleSeed.slice(0, 72) || `VS Code ${sessionId.slice(0, 8)}`;

  const mirrorInfo = {
    sessionId,
    path: filePath,
    source: "vscode",
    fileType: path.extname(filePath).replace(".", ""),
    pendingCount: pendingRequests.length
  };

  return {
    id: `vscode:${sessionId}`,
    source: "vscode-mirror",
    readOnly: true,
    title,
    createdAt,
    updatedAt,
    status: pendingRequests.length > 0 ? "running" : "idle",
    currentRunId: pendingRequests.length > 0 ? `vscode_run_${pendingRequests[0]?.requestId || "pending"}` : null,
    lastError: "",
    cwd: DEFAULT_CWD,
    mode: "read-only",
    logs: [
      `[mirror] VS Code session from ${filePath}`,
      `[mirror] requests=${requests.length} pending=${pendingRequests.length}`
    ],
    messages: messages.slice(-MAX_MESSAGES_PER_CHAT),
    runs: runs.slice(-MAX_RUNS_PER_CHAT),
    mirror: mirrorInfo
  };
}

function addSessionFilesFromDir(dirPath, out) {
  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isFile()) {
      continue;
    }
    if (!/\.(json|jsonl)$/i.test(entry.name)) {
      continue;
    }

    const fullPath = path.join(dirPath, entry.name);
    try {
      const stat = fs.statSync(fullPath);
      out.push({ path: fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {
      continue;
    }
  }
}

function addSessionFilesRecursively(dirPath, out, depth = 0) {
  if (depth > 5) {
    return;
  }

  let entries = [];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      addSessionFilesRecursively(fullPath, out, depth + 1);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".jsonl")) {
      continue;
    }
    try {
      const stat = fs.statSync(fullPath);
      out.push({ path: fullPath, mtimeMs: stat.mtimeMs, size: stat.size });
    } catch {
      continue;
    }
  }
}

function findVscodeMirrorSessionFiles() {
  const files = [];

  for (const root of VSCODE_MIRROR_ROOTS) {
    let stat;
    try {
      stat = fs.statSync(root);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) {
      continue;
    }

    if (path.basename(root) === "workspaceStorage") {
      let workspaces = [];
      try {
        workspaces = fs.readdirSync(root, { withFileTypes: true });
      } catch {
        workspaces = [];
      }
      for (const wsEntry of workspaces) {
        if (!wsEntry.isDirectory()) {
          continue;
        }
        addSessionFilesFromDir(path.join(root, wsEntry.name, "chatSessions"), files);
      }
      continue;
    }

    if (path.basename(root) === "emptyWindowChatSessions" || path.basename(root) === "chatSessions") {
      addSessionFilesFromDir(root, files);
      continue;
    }

    addSessionFilesFromDir(root, files);
    addSessionFilesFromDir(path.join(root, "chatSessions"), files);
  }

  files.sort((a, b) => (a.mtimeMs < b.mtimeMs ? 1 : -1));
  return files.slice(0, VSCODE_MIRROR_MAX_FILES);
}

function findCodexSessionFiles() {
  const files = [];
  for (const root of CODEX_SESSION_ROOTS) {
    let stat;
    try {
      stat = fs.statSync(root);
    } catch {
      continue;
    }
    if (!stat.isDirectory()) {
      continue;
    }
    addSessionFilesRecursively(root, files);
  }
  files.sort((a, b) => (a.mtimeMs < b.mtimeMs ? 1 : -1));
  return files.slice(0, CODEX_SESSION_MIRROR_MAX_FILES);
}

function extractTextFromMessageContent(content) {
  if (!Array.isArray(content)) {
    return "";
  }
  const out = [];
  for (const part of content) {
    if (!part || typeof part !== "object") {
      continue;
    }
    if (typeof part.text === "string" && part.text.trim()) {
      out.push(part.text.trim());
    }
    if (typeof part.value === "string" && part.value.trim()) {
      out.push(part.value.trim());
    }
  }
  return out.join("\n\n").trim();
}

function loadCodexSessionIndex() {
  const map = new Map();
  let raw;
  try {
    raw = fs.readFileSync(CODEX_SESSION_INDEX_PATH, "utf8");
  } catch {
    return map;
  }

  for (const line of raw.split(/\r?\n/).filter(Boolean)) {
    const parsed = safeJsonParse(line);
    if (!parsed || typeof parsed !== "object" || typeof parsed.id !== "string") {
      continue;
    }
    map.set(parsed.id, {
      threadName: typeof parsed.thread_name === "string" ? parsed.thread_name.trim() : "",
      updatedAt: typeof parsed.updated_at === "string" ? parsed.updated_at : ""
    });
  }

  return map;
}

function parseCodexSessionChatFromFile(filePath, stat, indexMeta) {
  const cacheKey = filePath;
  const cached = codexSessionFileCache.get(cacheKey);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    if (indexMeta && indexMeta.threadName) {
      const nextTitle = indexMeta.threadName.slice(0, 90);
      if (cached.chat.title !== nextTitle) {
        const patchedChat = {
          ...cached.chat,
          title: nextTitle,
          updatedAt: toIsoFromAny(indexMeta.updatedAt || cached.chat.updatedAt, stat.mtimeMs)
        };
        codexSessionFileCache.set(cacheKey, {
          mtimeMs: cached.mtimeMs,
          size: cached.size,
          chat: patchedChat
        });
        return patchedChat;
      }
    }
    return cached.chat;
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }

  const lines = raw.split(/\r?\n/).filter(Boolean);
  let sessionMeta = null;
  const messages = [];
  let lastTs = stat.mtimeMs;
  const openTurnIds = new Set();
  let taskStartedCount = 0;
  let taskCompleteCount = 0;
  let lastOpenTurnId = "";
  let tokenStats = null;

  for (const line of lines) {
    const event = safeJsonParse(line);
    if (!event || typeof event !== "object") {
      continue;
    }

    if (typeof event.timestamp === "string") {
      const ts = Date.parse(event.timestamp);
      if (!Number.isNaN(ts)) {
        lastTs = ts;
      }
    }

    if (event.type === "event_msg" && event.payload && typeof event.payload === "object") {
      const evtType = event.payload.type;
      const turnId = typeof event.payload.turn_id === "string" ? event.payload.turn_id : "";
      if (evtType === "token_count") {
        const nextTokenStats = parseTokenCountPayload(
          event.payload,
          typeof event.timestamp === "string" ? event.timestamp : toIsoFromAny(lastTs, stat.mtimeMs)
        );
        if (nextTokenStats) {
          tokenStats = nextTokenStats;
        }
        continue;
      }
      if (evtType === "task_started") {
        taskStartedCount += 1;
        if (turnId) {
          openTurnIds.add(turnId);
          lastOpenTurnId = turnId;
        }
        continue;
      }
      if (evtType === "task_complete") {
        taskCompleteCount += 1;
        if (turnId) {
          openTurnIds.delete(turnId);
          if (turnId === lastOpenTurnId) {
            const tail = Array.from(openTurnIds);
            lastOpenTurnId = tail.length > 0 ? tail[tail.length - 1] : "";
          }
        }
        continue;
      }
    }

    if (event.type === "session_meta" && event.payload && typeof event.payload === "object") {
      sessionMeta = event.payload;
      continue;
    }

    if (event.type !== "response_item") {
      continue;
    }

    const payload = event.payload || {};
    if (payload.type !== "message") {
      continue;
    }
    if (payload.role !== "user" && payload.role !== "assistant") {
      continue;
    }

    const text = extractTextFromMessageContent(payload.content);
    if (!text) {
      continue;
    }

    messages.push({
      id: randomId("codex_msg"),
      role: payload.role,
      text,
      runId: null,
      createdAt: typeof event.timestamp === "string" ? event.timestamp : toIsoFromAny(lastTs, stat.mtimeMs)
    });
  }

  trimArray(messages, MAX_MESSAGES_PER_CHAT);

  const filename = path.basename(filePath);
  const idFromNameMatch = filename.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const sessionId =
    (sessionMeta && typeof sessionMeta.id === "string" && sessionMeta.id) ||
    (idFromNameMatch ? idFromNameMatch[0] : filename.replace(/\.jsonl$/i, ""));
  if (!sessionId) {
    return null;
  }

  const title =
    (indexMeta && typeof indexMeta.threadName === "string" && indexMeta.threadName) ||
    (sessionMeta && typeof sessionMeta.thread_name === "string" && sessionMeta.thread_name.trim()) ||
    (sessionMeta && typeof sessionMeta.cwd === "string" ? `Codex ${path.basename(sessionMeta.cwd)}` : "") ||
    `Codex ${sessionId.slice(0, 8)}`;

  const createdAt = toIsoFromAny(sessionMeta?.timestamp, stat.mtimeMs);
  const updatedAt = toIsoFromAny((indexMeta && indexMeta.updatedAt) || lastTs, stat.mtimeMs);
  const isRunning = openTurnIds.size > 0 || taskStartedCount > taskCompleteCount;
  const currentRunId = isRunning ? lastOpenTurnId || `codex_run_${sessionId.slice(0, 8)}` : null;

  const chat = {
    id: `codex:${sessionId}`,
    source: "codex-session-mirror",
    readOnly: true,
    title: title.slice(0, 90),
    createdAt,
    updatedAt,
    status: isRunning ? "running" : "idle",
    currentRunId,
    lastError: "",
    cwd: sessionMeta?.cwd || DEFAULT_CWD,
    mode: "read-only",
    logs: [
      `[mirror] Codex session from ${filePath}`,
      `[mirror] messages=${messages.length}`,
      `[mirror] tasks started=${taskStartedCount} completed=${taskCompleteCount} open=${openTurnIds.size}`
    ],
    messages,
    runs: [],
    tokenStats,
    mirror: {
      sessionId,
      path: filePath,
      source: "codex",
      fileType: "jsonl"
    }
  };

  codexSessionFileCache.set(cacheKey, { mtimeMs: stat.mtimeMs, size: stat.size, chat });
  return chat;
}

function mirrorSignature(chat) {
  const lastUser = lastMessageByRole(chat, "user");
  const lastAssistant = lastMessageByRole(chat, "assistant");
  const totalTokens =
    chat && chat.tokenStats && chat.tokenStats.total ? chat.tokenStats.total.totalTokens || 0 : 0;
  const lastTokens =
    chat && chat.tokenStats && chat.tokenStats.last ? chat.tokenStats.last.totalTokens || 0 : 0;
  const tokenUpdatedAt = chat && chat.tokenStats && chat.tokenStats.updatedAt ? chat.tokenStats.updatedAt : "";
  return [
    chat.updatedAt,
    chat.status,
    chat.currentRunId || "",
    chat.messages.length,
    chat.runs.length,
    chat.lastError,
    chat.title,
    chat.source,
    `${totalTokens}:${lastTokens}:${tokenUpdatedAt}`,
    `${lastUser.length}:${lastAssistant.length}`,
    lastUser.slice(-220),
    lastAssistant.slice(-220)
  ].join("|");
}

function replaceMirrorSubset(prefix, nextSubset) {
  const prevSubset = new Map();
  for (const [id, chat] of mirroredChats.entries()) {
    if (id.startsWith(prefix)) {
      prevSubset.set(id, chat);
    }
  }

  let changed = prevSubset.size !== nextSubset.size;
  if (!changed) {
    for (const [id, nextChat] of nextSubset.entries()) {
      const prevChat = prevSubset.get(id);
      if (!prevChat || mirrorSignature(prevChat) !== mirrorSignature(nextChat)) {
        changed = true;
        break;
      }
    }
  }

  if (!changed) {
    return false;
  }

  for (const id of prevSubset.keys()) {
    mirroredChats.delete(id);
  }
  for (const [id, chat] of nextSubset.entries()) {
    mirroredChats.set(id, chat);
  }
  return true;
}

function syncVscodeMirrorsInternal() {
  if (!VSCODE_MIRROR_ENABLED) {
    return replaceMirrorSubset("vscode:", new Map());
  }

  const files = findVscodeMirrorSessionFiles();
  const nextMap = new Map();

  for (const file of files) {
    const session = readSessionFromFile(file.path);
    const mirrorChat = toVscodeMirrorChat(session, file.path, file);
    if (!mirrorChat) {
      continue;
    }
    nextMap.set(mirrorChat.id, mirrorChat);
  }

  return replaceMirrorSubset("vscode:", nextMap);
}

function syncCodexMirrorsInternal() {
  if (!CODEX_SESSION_MIRROR_ENABLED) {
    codexSessionFileCache.clear();
    return replaceMirrorSubset("codex:", new Map());
  }

  const files = findCodexSessionFiles();
  const indexMap = loadCodexSessionIndex();
  const nextMap = new Map();

  for (const file of files) {
    const idMatch = path.basename(file.path).match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    const indexMeta = idMatch ? indexMap.get(idMatch[0]) || null : null;
    const chat = parseCodexSessionChatFromFile(file.path, file, indexMeta);
    if (!chat) {
      continue;
    }
    nextMap.set(chat.id, chat);
  }

  return replaceMirrorSubset("codex:", nextMap);
}

function syncMirrorsAndBroadcast(force = false) {
  const changedVscode = syncVscodeMirrorsInternal();
  const changedCodex = syncCodexMirrorsInternal();
  const changed = changedVscode || changedCodex;
  if (force || changed) {
    broadcastToAuthed({
      type: "chats/snapshot",
      chats: listChatsSorted()
    });
  }
  return changed;
}

function sessionSourceToLabel(source) {
  if (typeof source === "string") {
    return source;
  }
  if (!source || typeof source !== "object") {
    return "unknown";
  }
  if (typeof source.custom === "string" && source.custom) {
    return source.custom;
  }
  if (source.subAgent) {
    return "subAgent";
  }
  return "unknown";
}

function threadStatusToChatStatus(status) {
  const kind = status && typeof status === "object" ? status.type : "";
  if (kind === "active") {
    return "running";
  }
  if (kind === "systemError") {
    return "failed";
  }
  return "idle";
}

function turnStatusToRunStatus(turnStatus) {
  if (turnStatus === "inProgress") {
    return "running";
  }
  if (turnStatus === "failed") {
    return "failed";
  }
  if (turnStatus === "interrupted") {
    return "failed";
  }
  return "completed";
}

function extractUserInputText(items) {
  if (!Array.isArray(items)) {
    return "";
  }
  const parts = [];
  for (const item of items) {
    if (!item || typeof item !== "object") {
      continue;
    }
    if (item.type === "text" && typeof item.text === "string" && item.text.trim()) {
      parts.push(item.text.trim());
    }
  }
  return parts.join("\n\n").trim();
}

function threadTitle(thread) {
  if (thread && typeof thread.name === "string" && thread.name.trim()) {
    return thread.name.trim().slice(0, 96);
  }
  if (thread && typeof thread.preview === "string" && thread.preview.trim()) {
    return thread.preview.trim().slice(0, 96);
  }
  const id = thread && typeof thread.id === "string" ? thread.id : randomId("thread");
  return `Thread ${id.slice(0, 8)}`;
}

function appChatSignature(chat) {
  return [
    chat.id,
    chat.updatedAt,
    chat.status,
    chat.appThread && chat.appThread.statusType ? chat.appThread.statusType : "",
    chat.currentRunId || "",
    chat.title,
    chat.lastError || "",
    chat.cwd || "",
    chat.messageCount || chat.messages.length,
    chat.tokenStats && chat.tokenStats.total ? chat.tokenStats.total.totalTokens || 0 : 0,
    chat.tokenStats && chat.tokenStats.last ? chat.tokenStats.last.totalTokens || 0 : 0,
    chat.tokenStats && chat.tokenStats.updatedAt ? chat.tokenStats.updatedAt : ""
  ].join("|");
}

function buildAppServerChatFromThread(thread, existingChat) {
  const chatId = appChatIdForThread(thread.id);
  const sourceLabel = sessionSourceToLabel(thread.source);
  const status = threadStatusToChatStatus(thread.status);
  const chat = existingChat
    ? {
        ...existingChat
      }
    : {
        id: chatId,
        source: "app-server-thread",
        readOnly: false,
        title: threadTitle(thread),
        createdAt: toIsoFromAny(thread.createdAt, Date.now()),
        updatedAt: toIsoFromAny(thread.updatedAt, Date.now()),
        status: "idle",
        currentRunId: null,
        lastError: "",
        cwd: thread.cwd || DEFAULT_CWD,
        mode: "workspace-write",
        logs: [],
        messages: [],
        runs: [],
        tokenStats: null
      };

  chat.source = "app-server-thread";
  chat.readOnly = false;
  chat.title = threadTitle(thread);
  chat.createdAt = toIsoFromAny(thread.createdAt, Date.now());
  chat.updatedAt = toIsoFromAny(thread.updatedAt, Date.now());
  chat.status = status;
  chat.currentRunId = appServerState.runningTurnByThread.get(thread.id) || null;
  chat.cwd = thread.cwd || chat.cwd || DEFAULT_CWD;
  chat.mode = chat.mode || "workspace-write";
  chat.appThread = {
    threadId: thread.id,
    source: sourceLabel,
    path: typeof thread.path === "string" ? thread.path : null,
    statusType: thread && thread.status && typeof thread.status.type === "string" ? thread.status.type : "unknown"
  };
  return chat;
}

function replaceAppServerChats(nextMap) {
  let changed = appServerChats.size !== nextMap.size;
  if (!changed) {
    for (const [id, nextChat] of nextMap.entries()) {
      const prevChat = appServerChats.get(id);
      if (!prevChat || appChatSignature(prevChat) !== appChatSignature(nextChat)) {
        changed = true;
        break;
      }
    }
  }
  if (!changed) {
    return false;
  }

  appServerChats.clear();
  for (const [id, chat] of nextMap.entries()) {
    appServerChats.set(id, chat);
  }
  return true;
}

function findRunForTurn(chat, turnId) {
  for (let i = chat.runs.length - 1; i >= 0; i -= 1) {
    if (chat.runs[i].id === turnId) {
      return chat.runs[i];
    }
  }
  return null;
}

function appendMessageDedup(chat, role, text, runId, createdAtOverride) {
  if (!text || typeof text !== "string") {
    return;
  }
  const normalized = text.trim();
  if (!normalized) {
    return;
  }
  const last = chat.messages[chat.messages.length - 1];
  if (last && last.role === role && last.text === normalized && last.runId === (runId || null)) {
    return;
  }
  chat.messages.push({
    id: randomId("msg"),
    role,
    text: normalized,
    runId: runId || null,
    createdAt: createdAtOverride || nowIso()
  });
  trimArray(chat.messages, MAX_MESSAGES_PER_CHAT);
}

function hydrateChatFromThreadRead(chat, thread) {
  chat.logs = [];
  chat.messages = [];
  chat.runs = [];

  if (!thread || !Array.isArray(thread.turns)) {
    return;
  }

  for (const turn of thread.turns) {
    const turnTokenStats = extractTokenStatsFromTurn(turn);
    const run = {
      id: turn.id || randomId("turn"),
      createdAt: toIsoFromAny(turn.startedAt, Date.now()),
      completedAt: turn.completedAt ? toIsoFromAny(turn.completedAt, Date.now()) : null,
      status: turnStatusToRunStatus(turn.status),
      mode: chat.mode || "workspace-write",
      cwd: chat.cwd || DEFAULT_CWD,
      prompt: "",
      command: "codex app-server turn/start",
      exitCode: null,
      signal: null,
      finalText: "",
      error: turn && turn.error && typeof turn.error.message === "string" ? turn.error.message : "",
      tokenUsage: turnTokenStats ? turnTokenStats.last || turnTokenStats.total || null : null,
      tokenStatsUpdatedAt: turnTokenStats ? turnTokenStats.updatedAt : null
    };

    if (turnTokenStats) {
      chat.tokenStats = turnTokenStats;
    }

    for (const item of Array.isArray(turn.items) ? turn.items : []) {
      if (!item || typeof item !== "object") {
        continue;
      }

      if (item.type === "userMessage") {
        const userText = extractUserInputText(item.content);
        if (userText) {
          appendMessageDedup(chat, "user", userText, run.id, run.createdAt);
          if (!run.prompt) {
            run.prompt = userText;
          }
        }
        continue;
      }

      if (item.type === "agentMessage") {
        if (typeof item.text === "string" && item.text.trim()) {
          appendMessageDedup(chat, "assistant", item.text, run.id, run.completedAt || run.createdAt);
          run.finalText = item.text.trim();
        }
        continue;
      }

      if (item.type === "commandExecution") {
        if (typeof item.command === "string" && item.command.trim()) {
          addLogLine(chat, `cmd: ${item.command.trim()}`);
        }
        if (typeof item.aggregatedOutput === "string" && item.aggregatedOutput.trim()) {
          const snippet = item.aggregatedOutput.trim().split("\n").slice(0, 6).join("\n");
          addLogLine(chat, `output:\n${snippet}`);
        }
        continue;
      }

      if (item.type === "fileChange") {
        addLogLine(chat, `fileChange: ${item.status || "updated"}`);
      }
    }

    chat.runs.push(run);
    trimArray(chat.runs, MAX_RUNS_PER_CHAT);
  }

  trimArray(chat.logs, MAX_LOG_LINES);
}

function appServerWrite(payload) {
  if (!appServerState.child || !appServerState.child.stdin || appServerState.child.killed) {
    throw new Error("App-server is not running.");
  }
  appServerState.child.stdin.write(`${JSON.stringify(payload)}\n`);
}

function appServerRequest(method, params, timeoutMs = APP_SERVER_REQUEST_TIMEOUT_MS) {
  if (!appServerState.child) {
    return Promise.reject(new Error("App-server is not available."));
  }

  const id = appServerState.nextId++;
  const payload = {
    jsonrpc: "2.0",
    id,
    method,
    params
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      appServerState.pending.delete(id);
      reject(new Error(`App-server request timeout: ${method}`));
    }, timeoutMs);

    appServerState.pending.set(id, { resolve, reject, timer, method });
    try {
      appServerWrite(payload);
    } catch (err) {
      clearTimeout(timer);
      appServerState.pending.delete(id);
      reject(err);
    }
  });
}

function appServerNotify(method, params = undefined) {
  if (!appServerState.child) {
    return;
  }
  const payload = {
    jsonrpc: "2.0",
    method
  };
  if (params !== undefined) {
    payload.params = params;
  }
  try {
    appServerWrite(payload);
  } catch (err) {
    console.error("[app-server] notify failed:", err.message);
  }
}

function removePendingApproval(threadId, requestId) {
  const list = appServerState.pendingApprovals.get(threadId) || [];
  const next = list.filter((req) => String(req.requestId) !== String(requestId));
  if (next.length > 0) {
    appServerState.pendingApprovals.set(threadId, next);
  } else {
    appServerState.pendingApprovals.delete(threadId);
  }

  const chatId = appChatIdForThread(threadId);
  const chat = appServerChats.get(chatId);
  if (chat) {
    chat.updatedAt = nowIso();
    broadcastToAuthed({ type: "chat/updated", chat: toChatSummary(chat) });
  }
  broadcastToAuthed({ type: "approval/resolved", chatId, requestId: String(requestId) });
}

function registerPendingApproval(method, requestId, params) {
  const threadId =
    (params && typeof params.threadId === "string" && params.threadId) ||
    (params && typeof params.conversationId === "string" && params.conversationId) ||
    "";
  if (!threadId) {
    return;
  }
  const chatId = appChatIdForThread(threadId);
  const existing = appServerState.pendingApprovals.get(threadId) || [];
  const pending = {
    method,
    requestId: String(requestId),
    createdAt: nowIso(),
    params
  };
  existing.push(pending);
  appServerState.pendingApprovals.set(threadId, existing);

  broadcastToAuthed({
    type: "approval/request",
    chatId,
    approval: {
      requestId: pending.requestId,
      method,
      createdAt: pending.createdAt,
      params
    }
  });

  let chat = appServerChats.get(chatId);
  if (!chat) {
    chat = {
      id: chatId,
      source: "app-server-thread",
      readOnly: false,
      title: `Thread ${threadId.slice(0, 8)}`,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      status: "running",
      currentRunId: appServerState.runningTurnByThread.get(threadId) || null,
      lastError: "",
      cwd: DEFAULT_CWD,
      mode: "workspace-write",
      logs: [],
      messages: [],
      runs: [],
      tokenStats: null,
      appThread: {
        threadId,
        source: "unknown",
        path: null
      }
    };
    appServerChats.set(chatId, chat);
    broadcastToAuthed({ type: "chats/snapshot", chats: listChatsSorted() });
  }

  if (chat) {
    chat.status = "running";
    chat.currentRunId = appServerState.runningTurnByThread.get(threadId) || chat.currentRunId || null;
    chat.updatedAt = nowIso();
    addLogLine(chat, `[approval] ${method}`);
    broadcastToAuthed({ type: "chat/updated", chat: toChatSummary(chat) });
  }
}

function handleAppServerServerRequest(message) {
  registerPendingApproval(message.method, message.id, message.params || {});
}

function handleTurnStartedNotification(params) {
  const threadId = params && typeof params.threadId === "string" ? params.threadId : "";
  const turn = params ? params.turn : null;
  if (!threadId || !turn || typeof turn !== "object") {
    return;
  }
  appServerState.runningTurnByThread.set(threadId, turn.id);
  appServerState.activeTurnByThread.set(threadId, turn.id);

  const chatId = appChatIdForThread(threadId);
  const chat = appServerChats.get(chatId);
  if (!chat) {
    return;
  }

  chat.status = "running";
  chat.currentRunId = turn.id;
  chat.updatedAt = nowIso();
  if (!findRunForTurn(chat, turn.id)) {
    appendRun(chat, {
      id: turn.id,
      createdAt: toIsoFromAny(turn.startedAt, Date.now()),
      completedAt: null,
      status: "running",
      mode: chat.mode || "workspace-write",
      cwd: chat.cwd || DEFAULT_CWD,
      prompt: "",
      command: "codex app-server turn/start",
      exitCode: null,
      signal: null,
      finalText: "",
      error: "",
      tokenUsage: null,
      tokenStatsUpdatedAt: null
    });
  }

  broadcastToAuthed({ type: "chat/updated", chat: toChatSummary(chat) });
  broadcastToAuthed({
    type: "run/accepted",
    chatId,
    runId: turn.id,
    command: "codex app-server turn/start",
    cwd: chat.cwd || DEFAULT_CWD,
    mode: chat.mode || "workspace-write"
  });
}

function handleTurnCompletedNotification(params) {
  const threadId = params && typeof params.threadId === "string" ? params.threadId : "";
  const turn = params ? params.turn : null;
  if (!threadId || !turn || typeof turn !== "object") {
    return;
  }

  const chatId = appChatIdForThread(threadId);
  const chat = appServerChats.get(chatId);
  appServerState.runningTurnByThread.delete(threadId);
  appServerState.activeTurnByThread.delete(threadId);

  if (!chat) {
    return;
  }

  const run = findRunForTurn(chat, turn.id);
  const turnTokenStats = extractTokenStatsFromTurn(turn);
  const runStatus = turnStatusToRunStatus(turn.status);
  const finalText = run ? run.finalText || "" : "";
  const failed = runStatus === "failed";

  if (run) {
    run.status = runStatus;
    run.completedAt = turn.completedAt ? toIsoFromAny(turn.completedAt, Date.now()) : nowIso();
    if (turn && turn.error && typeof turn.error.message === "string") {
      run.error = turn.error.message;
    }
    if (turnTokenStats) {
      run.tokenUsage = turnTokenStats.last || turnTokenStats.total || run.tokenUsage || null;
      run.tokenStatsUpdatedAt = turnTokenStats.updatedAt;
    }
  }

  if (turnTokenStats) {
    chat.tokenStats = turnTokenStats;
  }

  chat.status = failed ? "failed" : "idle";
  chat.currentRunId = null;
  chat.lastError = failed ? (run && run.error) || "Turn failed." : "";
  chat.updatedAt = nowIso();

  broadcastToAuthed({ type: "chat/updated", chat: toChatSummary(chat) });
  broadcastToAuthed({
    type: failed ? "run/failed" : "run/completed",
    chatId,
    runId: turn.id,
    exitCode: failed ? 1 : 0,
    signal: null,
    finalText
  });
}

function handleItemCompletedNotification(params) {
  const threadId = params && typeof params.threadId === "string" ? params.threadId : "";
  const turnId = params && typeof params.turnId === "string" ? params.turnId : "";
  const item = params ? params.item : null;
  if (!threadId || !item || typeof item !== "object") {
    return;
  }

  const chatId = appChatIdForThread(threadId);
  const chat = appServerChats.get(chatId);
  if (!chat) {
    return;
  }

  if (item.type === "userMessage") {
    const text = extractUserInputText(item.content);
    if (text) {
      appendMessageDedup(chat, "user", text, turnId, nowIso());
      const run = findRunForTurn(chat, turnId);
      if (run && !run.prompt) {
        run.prompt = text;
      }
    }
  } else if (item.type === "agentMessage") {
    if (typeof item.text === "string" && item.text.trim()) {
      const text = item.text.trim();
      appendMessageDedup(chat, "assistant", text, turnId, nowIso());
      const run = findRunForTurn(chat, turnId);
      if (run) {
        run.finalText = text;
      }
      broadcastToAuthed({
        type: "run/event",
        chatId,
        runId: turnId,
        event: {
          method: "item/completed",
          params: {
            item: {
              type: "agentMessage",
              text
            }
          }
        }
      });
    }
  }

  chat.updatedAt = nowIso();
  broadcastToAuthed({ type: "chat/updated", chat: toChatSummary(chat) });
}

function handleAppServerNotification(message) {
  const method = message.method;
  const params = message.params || {};

  if (method === "thread/started" && params.thread && typeof params.thread === "object") {
    const thread = params.thread;
    const chatId = appChatIdForThread(thread.id);
    const existing = appServerChats.get(chatId);
    const chat = buildAppServerChatFromThread(thread, existing);
    appServerChats.set(chatId, chat);
    broadcastToAuthed({ type: "chats/snapshot", chats: listChatsSorted() });
    return;
  }

  if (method === "thread/status/changed") {
    const threadId = typeof params.threadId === "string" ? params.threadId : "";
    if (!threadId) {
      return;
    }
    const chat = appServerChats.get(appChatIdForThread(threadId));
    if (!chat) {
      return;
    }
    chat.status = threadStatusToChatStatus(params.status);
    chat.updatedAt = nowIso();
    broadcastToAuthed({ type: "chat/updated", chat: toChatSummary(chat) });
    return;
  }

  if (method === "turn/started") {
    handleTurnStartedNotification(params);
    return;
  }

  if (method === "turn/completed") {
    handleTurnCompletedNotification(params);
    return;
  }

  if (method === "item/agentMessage/delta") {
    const threadId = typeof params.threadId === "string" ? params.threadId : "";
    const turnId = typeof params.turnId === "string" ? params.turnId : "";
    if (!threadId || !turnId) {
      return;
    }
    const chatId = appChatIdForThread(threadId);
    const chat = appServerChats.get(chatId);
    if (!chat) {
      return;
    }
    chat.updatedAt = nowIso();
    broadcastToAuthed({
      type: "run/event",
      chatId,
      runId: turnId,
      event: {
        method,
        params
      }
    });
    return;
  }

  if (method === "item/completed") {
    handleItemCompletedNotification(params);
    return;
  }

  if (method === "item/commandExecution/outputDelta" || method === "item/fileChange/outputDelta") {
    const threadId = typeof params.threadId === "string" ? params.threadId : "";
    const turnId = typeof params.turnId === "string" ? params.turnId : "";
    if (!threadId || !turnId) {
      return;
    }
    const chatId = appChatIdForThread(threadId);
    broadcastToAuthed({
      type: "run/event",
      chatId,
      runId: turnId,
      event: {
        method,
        params
      }
    });
    return;
  }
}

function handleAppServerResponse(message) {
  const pending =
    appServerState.pending.get(message.id) ||
    (typeof message.id === "string" ? appServerState.pending.get(Number(message.id)) : null);
  if (!pending) {
    return;
  }
  clearTimeout(pending.timer);
  appServerState.pending.delete(message.id);
  if (typeof message.id === "string") {
    appServerState.pending.delete(Number(message.id));
  }
  if (message.error) {
    pending.reject(new Error(message.error.message || "App-server request failed."));
    return;
  }

  pending.resolve(message.result);
}

function handleAppServerJsonLine(line) {
  const message = safeJsonParse(line);
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
    handleAppServerResponse(message);
    return;
  }

  if (message.id !== undefined && typeof message.method === "string") {
    handleAppServerServerRequest(message);
    return;
  }

  if (typeof message.method === "string") {
    handleAppServerNotification(message);
  }
}

function clearAppServerPending(reasonText) {
  for (const [id, pending] of appServerState.pending.entries()) {
    clearTimeout(pending.timer);
    pending.reject(new Error(reasonText || "App-server connection closed."));
    appServerState.pending.delete(id);
  }
}

function scheduleAppServerRestart() {
  if (!APP_SERVER_ENABLED) {
    return;
  }
  if (appServerState.restartTimer) {
    return;
  }
  appServerState.restartTimer = setTimeout(() => {
    appServerState.restartTimer = null;
    startAppServerLoop();
  }, 2200);
}

async function syncAppServerThreads(force = false) {
  if (!APP_SERVER_ENABLED || !appServerState.ready || appServerState.syncing) {
    return false;
  }

  appServerState.syncing = true;
  try {
    let cursor = null;
    let pageCount = 0;
    const collected = [];

    while (pageCount < 8 && collected.length < APP_SERVER_THREAD_LIMIT) {
      const params = {
        limit: Math.min(80, APP_SERVER_THREAD_LIMIT),
        sortKey: "updated_at",
        sortDirection: "desc",
        archived: false
      };
      if (cursor) {
        params.cursor = cursor;
      }

      const result = await appServerRequest("thread/list", params, APP_SERVER_REQUEST_TIMEOUT_MS);
      const data = result && Array.isArray(result.data) ? result.data : [];
      for (const thread of data) {
        collected.push(thread);
        if (collected.length >= APP_SERVER_THREAD_LIMIT) {
          break;
        }
      }
      cursor = result && typeof result.nextCursor === "string" ? result.nextCursor : null;
      pageCount += 1;
      if (!cursor) {
        break;
      }
    }

    const nextMap = new Map();
    for (const thread of collected) {
      if (!thread || typeof thread !== "object" || typeof thread.id !== "string") {
        continue;
      }
      const chatId = appChatIdForThread(thread.id);
      const existing = appServerChats.get(chatId);
      const chat = buildAppServerChatFromThread(thread, existing);
      nextMap.set(chatId, chat);
    }

    const changed = replaceAppServerChats(nextMap);
    if (force || changed) {
      broadcastToAuthed({ type: "chats/snapshot", chats: listChatsSorted() });
    }
    return changed;
  } catch (err) {
    console.error("[app-server] thread sync failed:", err.message);
    return false;
  } finally {
    appServerState.syncing = false;
  }
}

async function refreshAppThreadDetail(chatId) {
  const initial = appServerChats.get(chatId);
  if (!initial || !isAppServerChat(initial) || !appServerState.ready) {
    return null;
  }
  try {
    const chat = await ensureAppThreadLoaded(initial);
    const threadId = chat.appThread.threadId;
    const result = await appServerRequest("thread/read", { threadId, includeTurns: true }, APP_SERVER_REQUEST_TIMEOUT_MS);
    const thread = result && result.thread ? result.thread : null;
    if (!thread) {
      return chat;
    }
    const refreshed = buildAppServerChatFromThread(thread, chat);
    hydrateChatFromThreadRead(refreshed, thread);
    appServerChats.set(chatId, refreshed);
    return refreshed;
  } catch (err) {
    addLogLine(initial, `[app-server] detail refresh failed: ${err.message}`);
    return initial;
  }
}

async function ensureAppThreadLoaded(chat) {
  if (!chat || !isAppServerChat(chat) || !appServerState.ready) {
    return chat;
  }
  if (!chat.appThread || chat.appThread.statusType !== "notLoaded") {
    return chat;
  }

  const threadId = chat.appThread.threadId;
  if (!threadId) {
    return chat;
  }

  const params = {
    threadId,
    approvalPolicy: "on-request",
    approvalsReviewer: "user",
    persistExtendedHistory: true,
    excludeTurns: false
  };
  if (chat.cwd) {
    params.cwd = chat.cwd;
  }

  try {
    const result = await appServerRequest("thread/resume", params, APP_SERVER_REQUEST_TIMEOUT_MS);
    const resumedThread = result && result.thread ? result.thread : null;
    if (!resumedThread) {
      return chat;
    }

    const refreshed = buildAppServerChatFromThread(resumedThread, appServerChats.get(chat.id) || chat);
    if (Array.isArray(resumedThread.turns) && resumedThread.turns.length > 0) {
      hydrateChatFromThreadRead(refreshed, resumedThread);
    }
    appServerChats.set(refreshed.id, refreshed);
    broadcastToAuthed({ type: "chat/updated", chat: toChatSummary(refreshed) });
    return refreshed;
  } catch (err) {
    chat.appThread.statusType = "resumeFailed";
    chat.lastError = err.message || "Failed to resume thread.";
    chat.updatedAt = nowIso();
    addLogLine(chat, `[app-server] resume failed: ${chat.lastError}`);
    appServerChats.set(chat.id, chat);
    broadcastToAuthed({ type: "chat/updated", chat: toChatSummary(chat) });
    throw err;
  }
}

async function startAppServerLoop() {
  if (!APP_SERVER_ENABLED || appServerState.child) {
    return;
  }

  const child = spawn(CODEX_BIN, ["app-server", "--listen", "stdio://"], {
    cwd: DEFAULT_CWD,
    env: process.env,
    stdio: ["pipe", "pipe", "pipe"]
  });
  appServerState.child = child;
  appServerState.stdoutBuffer = "";
  appServerState.ready = false;
  appServerState.initialized = false;
  console.log("[app-server] started");

  child.stdout.on("data", (chunk) => {
    appServerState.stdoutBuffer += chunk.toString("utf8");
    let nl;
    while ((nl = appServerState.stdoutBuffer.indexOf("\n")) >= 0) {
      const line = appServerState.stdoutBuffer.slice(0, nl).trim();
      appServerState.stdoutBuffer = appServerState.stdoutBuffer.slice(nl + 1);
      if (!line) {
        continue;
      }
      handleAppServerJsonLine(line);
    }
  });

  child.stderr.on("data", (chunk) => {
    const lines = chunk
      .toString("utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) {
      if (/^\d{4}-\d{2}-\d{2}T/.test(line)) {
        continue;
      }
      console.log(`[app-server:stderr] ${line}`);
    }
  });

  child.on("error", (err) => {
    console.error("[app-server] process error:", err.message);
  });

  child.on("close", (code, signal) => {
    console.log(`[app-server] closed (code=${String(code)} signal=${signal || "none"})`);
    appServerState.ready = false;
    appServerState.initialized = false;
    appServerState.child = null;
    if (appServerState.syncTimer) {
      clearInterval(appServerState.syncTimer);
      appServerState.syncTimer = null;
    }
    clearAppServerPending("App-server process closed.");
    broadcastToAuthed({
      type: "appserver/status",
      enabled: APP_SERVER_ENABLED,
      ready: false
    });
    scheduleAppServerRestart();
  });

  try {
    await appServerRequest(
      "initialize",
      {
        clientInfo: {
          name: "codex_mobile_bridge",
          title: "Codex Mobile Bridge",
          version: "0.2.0"
        },
        capabilities: {
          experimentalApi: true
        }
      },
      12000
    );
    appServerNotify("initialized");
    appServerState.ready = true;
    appServerState.initialized = true;
    broadcastToAuthed({
      type: "appserver/status",
      enabled: APP_SERVER_ENABLED,
      ready: true
    });
    await syncAppServerThreads(true);
    if (!appServerState.syncTimer) {
      appServerState.syncTimer = setInterval(() => {
        syncAppServerThreads(false);
      }, APP_SERVER_SYNC_MS);
    }
  } catch (err) {
    console.error("[app-server] init failed:", err.message);
    clearAppServerPending("App-server initialization failed.");
    try {
      child.kill("SIGTERM");
    } catch {
      // noop
    }
  }
}

async function respondToAppServerApproval(requestId, action) {
  const reqIdRaw = Number(requestId);
  const reqId = Number.isFinite(reqIdRaw) ? reqIdRaw : requestId;

  let match = null;
  let threadId = "";
  for (const [tid, list] of appServerState.pendingApprovals.entries()) {
    for (const entry of list) {
      if (String(entry.requestId) === String(requestId)) {
        match = entry;
        threadId = tid;
        break;
      }
    }
    if (match) {
      break;
    }
  }
  if (!match) {
    throw new Error("Approval request not found.");
  }

  if (match.method === "item/commandExecution/requestApproval") {
    const decision = action === "approve_session" ? "acceptForSession" : action === "approve" ? "accept" : "decline";
    await appServerWrite({
      jsonrpc: "2.0",
      id: reqId,
      result: {
        decision
      }
    });
    removePendingApproval(threadId, requestId);
    return;
  }

  if (match.method === "item/fileChange/requestApproval") {
    const decision = action === "approve_session" ? "acceptForSession" : action === "approve" ? "accept" : "decline";
    await appServerWrite({
      jsonrpc: "2.0",
      id: reqId,
      result: {
        decision
      }
    });
    removePendingApproval(threadId, requestId);
    return;
  }

  if (match.method === "item/permissions/requestApproval") {
    const requested = match.params && typeof match.params === "object" ? match.params.permissions : null;
    const granted = action === "approve" || action === "approve_session" ? requested || {} : {};
    await appServerWrite({
      jsonrpc: "2.0",
      id: reqId,
      result: {
        scope: action === "approve_session" ? "session" : "turn",
        permissions: granted
      }
    });
    removePendingApproval(threadId, requestId);
    return;
  }

  if (match.method === "execCommandApproval" || match.method === "applyPatchApproval") {
    const decision = action === "approve_session" ? "approved_for_session" : action === "approve" ? "approved" : "denied";
    await appServerWrite({
      jsonrpc: "2.0",
      id: reqId,
      result: {
        decision
      }
    });
    removePendingApproval(threadId, requestId);
    return;
  }

  await appServerWrite({
    jsonrpc: "2.0",
    id: reqId,
    result: {
      decision: "decline"
    }
  });
  removePendingApproval(threadId, requestId);
}

function listDirectoryEntries(targetPath) {
  const resolved = resolveBrowsePath(targetPath);
  if (!resolved) {
    return { error: "Path is outside allowed browse roots." };
  }

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { error: "Path does not exist." };
  }
  if (!stat.isDirectory()) {
    return { error: "Path is not a directory." };
  }

  let entries;
  try {
    entries = fs.readdirSync(resolved, { withFileTypes: true });
  } catch (err) {
    return { error: `Failed to read directory: ${err.message}` };
  }

  const mapped = [];
  for (const entry of entries) {
    const fullPath = path.join(resolved, entry.name);
    try {
      const childStat = fs.statSync(fullPath);
      mapped.push({
        name: entry.name,
        path: fullPath,
        kind: childStat.isDirectory() ? "dir" : "file",
        size: childStat.isDirectory() ? null : childStat.size,
        mtime: childStat.mtime.toISOString()
      });
    } catch {
      continue;
    }
  }

  mapped.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "dir" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return {
    path: resolved,
    parent:
      resolved === path.parse(resolved).root
        ? null
        : isPathWithinRoots(path.dirname(resolved), BROWSE_ROOTS)
          ? path.dirname(resolved)
          : null,
    entries: mapped.slice(0, BROWSE_MAX_ENTRIES),
    truncated: mapped.length > BROWSE_MAX_ENTRIES
  };
}

function readFilePreview(targetPath) {
  const resolved = resolveBrowsePath(targetPath);
  if (!resolved) {
    return { error: "Path is outside allowed browse roots." };
  }

  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { error: "Path does not exist." };
  }
  if (!stat.isFile()) {
    return { error: "Path is not a file." };
  }

  const bytes = Math.min(stat.size, BROWSE_MAX_FILE_BYTES);
  let raw;
  try {
    raw = fs.readFileSync(resolved, "utf8");
  } catch (err) {
    return { error: `Failed to read file: ${err.message}` };
  }

  const text = raw.length > bytes ? raw.slice(0, bytes) : raw;
  return {
    path: resolved,
    size: stat.size,
    truncated: raw.length > text.length,
    text
  };
}

function startMirrorLoop() {
  if (mirrorScanTimer) {
    return;
  }
  syncMirrorsAndBroadcast(true);
  mirrorScanTimer = setInterval(syncMirrorsAndBroadcast, VSCODE_MIRROR_SCAN_MS);
}

restoreChats();
startMirrorLoop();
startAppServerLoop();

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
    chatCount: chats.size + mirroredChats.size + appServerChats.size,
    localChatCount: chats.size,
    mirroredChatCount: mirroredChats.size,
    appServerChatCount: appServerChats.size,
    vscodeMirrorEnabled: VSCODE_MIRROR_ENABLED,
    codexSessionMirrorEnabled: CODEX_SESSION_MIRROR_ENABLED,
    appServerEnabled: APP_SERVER_ENABLED,
    appServerReady: appServerState.ready,
    vscodeMirrorScanMs: VSCODE_MIRROR_SCAN_MS,
    browseRoots: BROWSE_ROOTS,
    githubProfileUrl: GITHUB_PROFILE_URL
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
    codexBin: CODEX_BIN,
    browseRoots: BROWSE_ROOTS,
    githubProfileUrl: GITHUB_PROFILE_URL,
    mirror: {
      vscodeEnabled: VSCODE_MIRROR_ENABLED,
      codexSessionEnabled: CODEX_SESSION_MIRROR_ENABLED
    },
    appServer: {
      enabled: APP_SERVER_ENABLED,
      ready: appServerState.ready,
      syncMs: APP_SERVER_SYNC_MS
    }
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

    if (msg.type === "create_live_chat") {
      if (!APP_SERVER_ENABLED || !appServerState.ready) {
        send(ws, { type: "server/error", error: "App-server is not ready." });
        return;
      }
      const requestedTitle = typeof msg.title === "string" ? msg.title.trim() : "";
      const requestedCwd = resolveCwd(msg.cwd || DEFAULT_CWD) || DEFAULT_CWD;
      const requestedMode = msg.mode === "read-only" ? "read-only" : "workspace-write";

      appServerRequest("thread/start", {
        cwd: requestedCwd,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        sandbox: requestedMode === "workspace-write" ? "workspace-write" : "read-only",
        experimentalRawEvents: false,
        persistExtendedHistory: true
      })
        .then(async (result) => {
          const thread = result && result.thread;
          if (!thread || typeof thread.id !== "string") {
            send(ws, { type: "server/error", error: "Failed to create live chat." });
            return;
          }

          if (requestedTitle) {
            try {
              await appServerRequest("thread/name/set", { threadId: thread.id, name: requestedTitle });
              thread.name = requestedTitle;
            } catch {
              // keep default title if name update fails
            }
          }

          const chatId = appChatIdForThread(thread.id);
          const existing = appServerChats.get(chatId);
          const chat = buildAppServerChatFromThread(thread, existing);
          appServerChats.set(chatId, chat);
          broadcastToAuthed({ type: "chat/created", chat: toChatSummary(chat) });
          broadcastToAuthed({ type: "chats/snapshot", chats: listChatsSorted() });
        })
        .catch((err) => {
          send(ws, { type: "server/error", error: `Live chat create failed: ${err.message}` });
        });
      return;
    }

    if (msg.type === "activate_live_chat") {
      if (!APP_SERVER_ENABLED || !appServerState.ready) {
        send(ws, { type: "server/error", error: "App-server is not ready." });
        return;
      }
      const sourceChatId = typeof msg.sourceChatId === "string" ? msg.sourceChatId : "";
      const sourceChat = getAnyChat(sourceChatId);
      if (!sourceChat) {
        send(ws, { type: "server/error", error: "Source chat not found." });
        return;
      }
      if (isAppServerChat(sourceChat)) {
        send(ws, {
          type: "chat/activated_live",
          sourceChatId,
          chatId: sourceChat.id
        });
        return;
      }
      if (!sourceChat.readOnly) {
        send(ws, { type: "server/error", error: "This chat is already editable." });
        return;
      }

      const linkedLive = findLinkedLiveChatId(sourceChat);
      if (linkedLive && appServerChats.has(linkedLive)) {
        send(ws, {
          type: "chat/activated_live",
          sourceChatId,
          chatId: linkedLive
        });
        return;
      }

      const threadId = mirrorThreadId(sourceChat);
      if (!threadId) {
        send(ws, {
          type: "server/error",
          error: "No resumable live thread id found for this mirrored chat."
        });
        return;
      }

      const resumeParams = {
        threadId,
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        persistExtendedHistory: true,
        excludeTurns: false
      };
      const sourceCwd = resolveCwd(sourceChat.cwd || DEFAULT_CWD);
      if (sourceCwd) {
        resumeParams.cwd = sourceCwd;
      }

      appServerRequest("thread/resume", resumeParams, APP_SERVER_REQUEST_TIMEOUT_MS)
        .then((result) => {
          const thread = result && result.thread;
          if (!thread || typeof thread.id !== "string") {
            send(ws, { type: "server/error", error: "Failed to resume live thread." });
            return;
          }

          const chatId = appChatIdForThread(thread.id);
          const existing = appServerChats.get(chatId);
          const chat = buildAppServerChatFromThread(thread, existing);
          if (Array.isArray(thread.turns) && thread.turns.length > 0) {
            hydrateChatFromThreadRead(chat, thread);
          }
          appServerChats.set(chatId, chat);

          broadcastToAuthed({ type: "chats/snapshot", chats: listChatsSorted() });
          send(ws, {
            type: "chat/activated_live",
            sourceChatId,
            chatId
          });
        })
        .catch((err) => {
          send(ws, { type: "server/error", error: `Live activation failed: ${err.message}` });
        });
      return;
    }

    if (msg.type === "clone_chat") {
      const sourceChatId = typeof msg.sourceChatId === "string" ? msg.sourceChatId : "";
      const sourceChat = getAnyChat(sourceChatId);
      if (!sourceChat) {
        send(ws, { type: "server/error", error: "Source chat not found." });
        return;
      }
      const cloned = cloneAnyChatToLocal(sourceChat, msg.title);
      broadcastToAuthed({ type: "chat/created", chat: toChatSummary(cloned) });
      send(ws, { type: "chat/cloned", sourceChatId, chatId: cloned.id });
      return;
    }

    if (msg.type === "refresh_mirror") {
      syncMirrorsAndBroadcast(true);
      syncAppServerThreads(true)
        .then(() => {
          send(ws, {
            type: "mirror/refreshed",
            count: mirroredChats.size + appServerChats.size
          });
        })
        .catch((err) => {
          send(ws, { type: "server/error", error: `Refresh failed: ${err.message}` });
        });
      return;
    }

    if (msg.type === "fs/list") {
      const result = listDirectoryEntries(msg.path);
      if (result.error) {
        send(ws, { type: "fs/error", error: result.error });
      } else {
        send(ws, { type: "fs/list", ...result });
      }
      return;
    }

    if (msg.type === "fs/read") {
      const result = readFilePreview(msg.path);
      if (result.error) {
        send(ws, { type: "fs/error", error: result.error });
      } else {
        send(ws, { type: "fs/read", ...result });
      }
      return;
    }

    if (msg.type === "approval/respond") {
      const requestId = typeof msg.requestId === "string" || typeof msg.requestId === "number" ? msg.requestId : null;
      const action = msg.action === "approve_session" ? "approve_session" : msg.action === "deny" ? "deny" : "approve";
      if (requestId === null) {
        send(ws, { type: "server/error", error: "Approval request id is missing." });
        return;
      }
      respondToAppServerApproval(requestId, action)
        .then(() => {
          send(ws, { type: "approval/ack", requestId: String(requestId), action });
        })
        .catch((err) => {
          send(ws, { type: "server/error", error: `Approval response failed: ${err.message}` });
        });
      return;
    }

    if (msg.type === "get_chat") {
      const chatId = typeof msg.chatId === "string" ? msg.chatId : "";
      const chat = getAnyChat(chatId);
      if (!chat) {
        send(ws, { type: "server/error", error: "Chat not found." });
        return;
      }
      if (isAppServerChat(chat)) {
        refreshAppThreadDetail(chatId)
          .then((fresh) => {
            send(ws, { type: "chat/detail", chat: toChatDetail(fresh || chat) });
          })
          .catch((err) => {
            send(ws, { type: "server/error", error: `Failed to read live chat: ${err.message}` });
          });
        return;
      }

      send(ws, { type: "chat/detail", chat: toChatDetail(chat) });
      return;
    }

    if (msg.type === "cancel") {
      const chatId = typeof msg.chatId === "string" ? msg.chatId : "";
      const chat = getAnyChat(chatId);
      if (!chat) {
        send(ws, { type: "server/error", error: "Chat not found." });
        return;
      }

      if (isAppServerChat(chat)) {
        const threadId = chat.appThread.threadId;
        const turnId = appServerState.runningTurnByThread.get(threadId) || chat.currentRunId;
        if (!turnId) {
          send(ws, { type: "server/error", error: "No active live turn for this chat." });
          return;
        }
        appServerRequest("turn/interrupt", { threadId, turnId })
          .then(() => {
            addLogLine(chat, "[app-server] interrupt requested");
            chat.updatedAt = nowIso();
            broadcastToAuthed({ type: "chat/updated", chat: toChatSummary(chat) });
          })
          .catch((err) => {
            send(ws, { type: "server/error", error: `Interrupt failed: ${err.message}` });
          });
        return;
      }

      const canResumeMirror = canResumeCodexMirror(chat);
      if (chat.readOnly && !canResumeMirror) {
        send(ws, { type: "server/error", error: "Mirrored chats are read-only in this app." });
        return;
      }
      const runtime = runtimes.get(chatId);
      if (!runtime || !runtime.child) {
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
    let chat = getAnyChat(chatId);

    if (!chat) {
      send(ws, { type: "server/error", error: "Chat not found." });
      return;
    }

    const canResumeMirror = canResumeCodexMirror(chat);
    if (chat.readOnly && !canResumeMirror) {
      send(ws, { type: "server/error", error: "Mirrored chats are read-only in this app." });
      return;
    }

    if (isAppServerChat(chat)) {
      const prompt = typeof msg.prompt === "string" ? msg.prompt.trim() : "";
      if (!prompt) {
        send(ws, { type: "server/error", error: "Prompt is empty." });
        return;
      }
      if (!APP_SERVER_ENABLED || !appServerState.ready) {
        send(ws, { type: "server/error", error: "App-server is not ready." });
        return;
      }

      const requestedCwd = resolveCwd(msg.cwd || chat.cwd || DEFAULT_CWD);
      if (msg.cwd && !requestedCwd) {
        send(ws, {
          type: "server/error",
          error: "Invalid workspace path. It must stay inside allowed roots."
        });
        return;
      }

      ensureAppThreadLoaded(chat)
        .then((loadedChat) => {
          chat = loadedChat || chat;
          const threadId = chat.appThread.threadId;
          if (!threadId) {
            throw new Error("Live thread id is missing.");
          }

          if (requestedCwd) {
            chat.cwd = requestedCwd;
          }

          chat.status = "running";
          chat.lastError = "";
          chat.updatedAt = nowIso();
          appendMessageDedup(chat, "user", prompt, null, nowIso());
          broadcastToAuthed({ type: "chat/updated", chat: toChatSummary(chat) });

          return appServerRequest("turn/start", {
            threadId,
            input: [{ type: "text", text: prompt, text_elements: [] }],
            cwd: chat.cwd || DEFAULT_CWD,
            approvalPolicy: "on-request",
            approvalsReviewer: "user"
          }).then((result) => ({ result, threadId }));
        })
        .then(({ result, threadId }) => {
          const turn = result && result.turn ? result.turn : null;
          const runId = turn && typeof turn.id === "string" ? turn.id : randomId("turn");
          appServerState.runningTurnByThread.set(threadId, runId);
          appServerState.activeTurnByThread.set(threadId, runId);
          chat.currentRunId = runId;
          chat.status = "running";
          chat.updatedAt = nowIso();

          if (!findRunForTurn(chat, runId)) {
            appendRun(chat, {
              id: runId,
              createdAt: nowIso(),
              completedAt: null,
              status: "running",
              mode: chat.mode || "workspace-write",
              cwd: chat.cwd || DEFAULT_CWD,
              prompt,
              command: "codex app-server turn/start",
              exitCode: null,
              signal: null,
              finalText: "",
              error: "",
              tokenUsage: null,
              tokenStatsUpdatedAt: null
            });
          }

          broadcastToAuthed({ type: "chat/updated", chat: toChatSummary(chat) });
          broadcastToAuthed({
            type: "run/accepted",
            chatId,
            runId,
            command: "codex app-server turn/start",
            cwd: chat.cwd || DEFAULT_CWD,
            mode: chat.mode || "workspace-write"
          });
        })
        .catch((err) => {
          chat.status = "failed";
          chat.currentRunId = null;
          chat.lastError = err.message || "Live run failed.";
          chat.updatedAt = nowIso();
          addLogLine(chat, `[app-server] run failed: ${chat.lastError}`);
          broadcastToAuthed({ type: "chat/updated", chat: toChatSummary(chat) });
          broadcastToAuthed({
            type: "run/error",
            chatId,
            runId: null,
            error: chat.lastError
          });
        });
      return;
    }

    const runtime = getRuntime(chatId);
    if (runtime.child) {
      send(ws, { type: "server/error", error: "This chat already has a running task." });
      return;
    }

    const prompt = typeof msg.prompt === "string" ? msg.prompt.trim() : "";
    const requestedMode = msg.mode === "workspace-write" ? "workspace-write" : "read-only";
    const localCwd = resolveCwd(msg.cwd || chat.cwd || DEFAULT_CWD);
    const fallbackCwd = resolveCwd(chat.cwd || DEFAULT_CWD) || ALLOWED_ROOTS[0] || DEFAULT_CWD;
    const cwd = canResumeMirror ? fallbackCwd : localCwd;

    if (!prompt) {
      send(ws, { type: "server/error", error: "Prompt is empty." });
      return;
    }

    if (prompt.length > 12000) {
      send(ws, { type: "server/error", error: "Prompt too long (max 12000 chars)." });
      return;
    }

    if (!canResumeMirror && !cwd) {
      send(ws, {
        type: "server/error",
        error: "Invalid workspace path. It must stay inside allowed roots."
      });
      return;
    }

    const runId = randomId("run");
    const mode = canResumeMirror ? "resume" : requestedMode;
    const args = canResumeMirror
      ? buildCodexResumeArgs(chat.mirror.sessionId, prompt)
      : buildCodexArgs(prompt, cwd, requestedMode);
    const commandText = [CODEX_BIN, ...args].join(" ");

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
      command: commandText,
      exitCode: null,
      signal: null,
      finalText: "",
      error: "",
      tokenUsage: null,
      tokenStatsUpdatedAt: null
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
      command: commandText,
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
          applyTokenCountEvent(chat, runId, event);
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
          applyTokenCountEvent(chat, runId, event);
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
  console.log(`github profile url: ${GITHUB_PROFILE_URL || "(not detected)"}`);
  console.log(`token required: ${APP_TOKEN ? "yes" : "no"}`);
  console.log(`chat store: ${STORE_PATH}`);
  console.log(`vscode mirror: ${VSCODE_MIRROR_ENABLED ? "on" : "off"}`);
  console.log(`codex-session mirror: ${CODEX_SESSION_MIRROR_ENABLED ? "on" : "off"}`);
  console.log(`app-server live threads: ${APP_SERVER_ENABLED ? "on" : "off"}`);
  console.log(`mirrored chats loaded: ${mirroredChats.size}`);
  if (VSCODE_MIRROR_ENABLED) {
    console.log(`vscode mirror roots: ${VSCODE_MIRROR_ROOTS.join(", ")}`);
  }
  if (CODEX_SESSION_MIRROR_ENABLED) {
    console.log(`codex session roots: ${CODEX_SESSION_ROOTS.join(", ")}`);
  }
  console.log(`browse roots: ${BROWSE_ROOTS.join(", ")}`);
});
