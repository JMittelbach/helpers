const connectionDot = document.getElementById("connectionDot");
const connectionText = document.getElementById("connectionText");
const githubAccountLink = document.getElementById("githubAccountLink");
const mainHeader = document.getElementById("mainHeader");
const chatsCard = document.getElementById("chatsCard");
const chatDetailTop = document.getElementById("chatDetailTop");
const backToChatsBtn = document.getElementById("backToChatsBtn");
const chatDetailCaption = document.getElementById("chatDetailCaption");
const tokenQuickLine = document.getElementById("tokenQuickLine");
const tokenSourceLine = document.getElementById("tokenSourceLine");
const tokenTotalValue = document.getElementById("tokenTotalValue");
const tokenLastValue = document.getElementById("tokenLastValue");
const tokenContextValue = document.getElementById("tokenContextValue");
const tokenContextPercentValue = document.getElementById("tokenContextPercentValue");
const tokenBreakdownLine = document.getElementById("tokenBreakdownLine");
const tokenQuotaLine = document.getElementById("tokenQuotaLine");
const chatTitleInput = document.getElementById("chatTitleInput");
const createChatBtn = document.getElementById("createChatBtn");
const refreshMirrorBtn = document.getElementById("refreshMirrorBtn");
const chatSearchInput = document.getElementById("chatSearchInput");
const chatSourceFilter = document.getElementById("chatSourceFilter");
const chatStats = document.getElementById("chatStats");
const chatList = document.getElementById("chatList");
const selectedChatName = document.getElementById("selectedChatName");
const selectedChatSource = document.getElementById("selectedChatSource");
const readOnlyHint = document.getElementById("readOnlyHint");
const cloneToLocalBtn = document.getElementById("cloneToLocalBtn");
const activateLiveBtn = document.getElementById("activateLiveBtn");
const cwdInput = document.getElementById("cwdInput");
const modeSelect = document.getElementById("modeSelect");
const promptInput = document.getElementById("promptInput");
const runBtn = document.getElementById("runBtn");
const cancelBtn = document.getElementById("cancelBtn");
const advancedRun = document.getElementById("advancedRun");
const approvalPanel = document.getElementById("approvalPanel");
const approvalList = document.getElementById("approvalList");
const messagesPanel = document.getElementById("messagesPanel");
const logPanel = document.getElementById("logPanel");
const finalPanel = document.getElementById("finalPanel");
const presetsWrap = document.getElementById("presets");
const fileRootSelect = document.getElementById("fileRootSelect");
const fileUpBtn = document.getElementById("fileUpBtn");
const fileRefreshBtn = document.getElementById("fileRefreshBtn");
const fileQuickPaths = document.getElementById("fileQuickPaths");
const fileJumpInput = document.getElementById("fileJumpInput");
const fileJumpBtn = document.getElementById("fileJumpBtn");
const filePathDisplay = document.getElementById("filePathDisplay");
const fileList = document.getElementById("fileList");
const filePreview = document.getElementById("filePreview");
const TOKEN_STORAGE_KEY = "codex_mobile_bridge_token";

const presets = [
  {
    label: "Repo Audit",
    prompt:
      "Analyze this repository and return: architecture summary, top 3 risks, and the next 5 concrete actions."
  },
  {
    label: "Fix Tests",
    prompt: "Run the test suite, fix failures, and summarize every change made."
  },
  {
    label: "Code Review",
    prompt:
      "Perform a code review focused on bugs and regressions. List findings by severity and file."
  },
  {
    label: "Plan",
    prompt: "Create an implementation plan for this feature with risks and effort estimate."
  }
];

let ws;
let requiresToken = false;
let authed = false;
let selectedChatId = null;
let appServerEnabled = false;
let appServerReady = false;
let pendingAuthToken = "";
let queuedLiveActivationChatId = "";
let chatFocusMode = false;

const chats = new Map();
const details = new Map();
const streamCache = new Map();
const approvalsByChat = new Map();
const MIRROR_AUTO_REFRESH_MS = 5000;
const DETAIL_AUTO_REFRESH_MS = 3500;
const QUICK_PATH_LIMIT = 14;
const fileState = {
  roots: [],
  currentPath: "",
  parentPath: ""
};

function statusLabel(status) {
  if (status === "running") {
    return "running";
  }
  if (status === "failed") {
    return "failed";
  }
  return "idle";
}

function sourceLabel(chat) {
  if (!chat) {
    return "-";
  }
  if (chat.source === "app-server-thread") {
    return "Codex live thread (full control)";
  }
  if (chat.source === "vscode-mirror") {
    return "VS Code mirror (read-only)";
  }
  if (chat.source === "codex-session-mirror") {
    return "Codex session mirror (continuable)";
  }
  return "Web app (runnable)";
}

function sourceKey(chat) {
  if (!chat) {
    return "web";
  }
  if (chat.source === "app-server-thread") {
    return "live";
  }
  if (chat.source === "vscode-mirror") {
    return "vscode";
  }
  if (chat.source === "codex-session-mirror") {
    return "codex";
  }
  return "web";
}

function canContinueMirroredChat(chat) {
  return Boolean(chat && chat.readOnly && sourceKey(chat) === "codex");
}

function linkedLiveChatId(chat) {
  if (!chat || typeof chat.linkedLiveChatId !== "string") {
    return "";
  }
  return chat.linkedLiveChatId;
}

function canRunChat(chat) {
  if (!chat) {
    return false;
  }
  if (!chat.readOnly) {
    return true;
  }
  return canContinueMirroredChat(chat);
}

function readOnlyHintText(chat) {
  if (!chat || !chat.readOnly) {
    return "";
  }
  const liveTwin = linkedLiveChatId(chat);
  if (liveTwin) {
    return "Read-only mirror selected. A linked live thread is available: tap 'Open As Live Thread' to continue there.";
  }
  if (sourceKey(chat) === "codex") {
    return "This mirrored Codex chat can continue from mobile. Workspace and sandbox are inherited from the original session.";
  }
  if (sourceKey(chat) === "vscode") {
    return "VS Code mirrored chats are view-only here.";
  }
  return "This chat is mirrored and read-only in this web app.";
}

function setStatus(text, online) {
  connectionText.textContent = text;
  connectionDot.classList.toggle("online", online);
  connectionDot.classList.toggle("offline", !online);
}

function setChatFocusMode(enabled) {
  chatFocusMode = Boolean(enabled);
  document.body.classList.toggle("chat-focus", chatFocusMode);
  if (!chatDetailCaption) {
    return;
  }
  if (!chatFocusMode) {
    chatDetailCaption.textContent = "Chat view";
    return;
  }
  const selected = getChatSummary(selectedChatId);
  chatDetailCaption.textContent = selected ? sourceLabel(selected) : "Chat view";
}

function applyGithubProfileUrl(rawUrl) {
  if (!githubAccountLink) {
    return;
  }
  const href = typeof rawUrl === "string" ? rawUrl.trim() : "";
  if (!href) {
    githubAccountLink.classList.add("hidden");
    githubAccountLink.removeAttribute("href");
    githubAccountLink.textContent = "GitHub";
    return;
  }
  try {
    const parsed = new URL(href);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new Error("unsupported protocol");
    }
    const path = parsed.pathname.replace(/^\/+|\/+$/g, "");
    const label = path ? `GitHub: ${path.split("/")[0]}` : "GitHub";
    githubAccountLink.href = parsed.toString();
    githubAccountLink.textContent = label;
    githubAccountLink.classList.remove("hidden");
  } catch {
    githubAccountLink.classList.add("hidden");
  }
}

function toNumberOrNull(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  return n;
}

function toIntOrNull(value) {
  const n = toNumberOrNull(value);
  if (n === null) {
    return null;
  }
  return Math.max(0, Math.round(n));
}

function normalizeUsage(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const inputTokens = toIntOrNull(raw.inputTokens ?? raw.input_tokens) || 0;
  const cachedInputTokens = toIntOrNull(raw.cachedInputTokens ?? raw.cached_input_tokens) || 0;
  const outputTokens = toIntOrNull(raw.outputTokens ?? raw.output_tokens) || 0;
  const reasoningOutputTokens = toIntOrNull(raw.reasoningOutputTokens ?? raw.reasoning_output_tokens) || 0;
  const explicitTotal = toIntOrNull(raw.totalTokens ?? raw.total_tokens);
  const totalTokens =
    explicitTotal !== null ? explicitTotal : inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens;
  if (totalTokens <= 0 && inputTokens <= 0 && cachedInputTokens <= 0 && outputTokens <= 0 && reasoningOutputTokens <= 0) {
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

function normalizeRateLimits(raw) {
  if (!raw || typeof raw !== "object") {
    return {};
  }
  const pickBucket = (value) => {
    if (!value || typeof value !== "object") {
      return null;
    }
    const usedPercent = toNumberOrNull(value.usedPercent ?? value.used_percent);
    const windowMinutes = toIntOrNull(value.windowMinutes ?? value.window_minutes);
    const resetsAt = toIntOrNull(value.resetsAt ?? value.resets_at);
    if (usedPercent === null && windowMinutes === null && resetsAt === null) {
      return null;
    }
    return {
      usedPercent: usedPercent === null ? null : Math.max(0, Math.min(100, Math.round(usedPercent * 10) / 10)),
      windowMinutes,
      resetsAt
    };
  };

  const creditsRaw = raw.credits || {};
  const hasCredits = typeof creditsRaw.hasCredits === "boolean" ? creditsRaw.hasCredits : creditsRaw.has_credits;
  const unlimited = typeof creditsRaw.unlimited === "boolean" ? creditsRaw.unlimited : null;
  const balance = creditsRaw.balance === undefined || creditsRaw.balance === null ? null : String(creditsRaw.balance);
  const credits =
    typeof hasCredits === "boolean" || typeof unlimited === "boolean" || balance !== null
      ? {
          hasCredits: typeof hasCredits === "boolean" ? hasCredits : null,
          unlimited: typeof unlimited === "boolean" ? unlimited : null,
          balance
        }
      : null;

  const normalized = {};
  const primary = pickBucket(raw.primary);
  const secondary = pickBucket(raw.secondary);
  if (primary) {
    normalized.primary = primary;
  }
  if (secondary) {
    normalized.secondary = secondary;
  }
  if (credits) {
    normalized.credits = credits;
  }
  return normalized;
}

function normalizeTokenStats(raw) {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const total = normalizeUsage(raw.total || raw.totalUsage);
  const last = normalizeUsage(raw.last || raw.lastUsage);
  const modelContextWindow = toIntOrNull(raw.modelContextWindow ?? raw.model_context_window);
  const rateLimits = normalizeRateLimits(raw.rateLimits || raw.rate_limits || {});
  const updatedAt =
    typeof raw.updatedAt === "string" && raw.updatedAt
      ? raw.updatedAt
      : typeof raw.timestamp === "string" && raw.timestamp
        ? raw.timestamp
        : null;
  if (!total && !last && modelContextWindow === null && Object.keys(rateLimits).length === 0) {
    return null;
  }
  return {
    source: typeof raw.source === "string" && raw.source ? raw.source : "token_count",
    updatedAt,
    total,
    last,
    modelContextWindow,
    rateLimits
  };
}

function parseTokenStatsFromEvent(event) {
  if (!event || typeof event !== "object") {
    return null;
  }
  if (event.type !== "event_msg" || !event.payload || event.payload.type !== "token_count") {
    return null;
  }
  const payload = event.payload;
  const info = payload.info && typeof payload.info === "object" ? payload.info : {};
  return normalizeTokenStats({
    source: "token_count",
    updatedAt: typeof event.timestamp === "string" ? event.timestamp : new Date().toISOString(),
    total: info.total_token_usage ?? info.totalTokenUsage,
    last: info.last_token_usage ?? info.lastTokenUsage,
    modelContextWindow: info.model_context_window ?? info.modelContextWindow,
    rateLimits: payload.rate_limits ?? payload.rateLimits
  });
}

function formatInt(value) {
  const n = toIntOrNull(value);
  if (n === null) {
    return "-";
  }
  return n.toLocaleString("en-US");
}

function formatPercent(value) {
  const n = toNumberOrNull(value);
  if (n === null) {
    return "-";
  }
  return `${Math.round(n * 10) / 10}%`;
}

function formatResetTs(seconds) {
  const n = toIntOrNull(seconds);
  if (n === null) {
    return "-";
  }
  const d = new Date(n * 1000);
  if (Number.isNaN(d.getTime())) {
    return "-";
  }
  return d.toLocaleString("en-US", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function setTokenPanelEmpty(message) {
  if (!tokenSourceLine || !tokenTotalValue || !tokenLastValue || !tokenContextValue || !tokenContextPercentValue || !tokenBreakdownLine || !tokenQuotaLine) {
    return;
  }
  if (tokenQuickLine) {
    tokenQuickLine.textContent = message;
  }
  tokenSourceLine.textContent = message;
  tokenTotalValue.textContent = "-";
  tokenLastValue.textContent = "-";
  tokenContextValue.textContent = "-";
  tokenContextPercentValue.textContent = "-";
  tokenBreakdownLine.textContent = "Input/Output breakdown appears with token_count events.";
  tokenQuotaLine.textContent = "Quota: waiting for rate-limit data.";
}

function mergeTokenStats(baseStats, incomingStats) {
  const base = normalizeTokenStats(baseStats || {});
  const incoming = normalizeTokenStats(incomingStats || {});
  if (!base) {
    return incoming;
  }
  if (!incoming) {
    return base;
  }
  return {
    source: incoming.source || base.source,
    updatedAt: incoming.updatedAt || base.updatedAt,
    total: incoming.total || base.total || null,
    last: incoming.last || base.last || null,
    modelContextWindow: incoming.modelContextWindow || base.modelContextWindow || null,
    rateLimits: {
      ...(base.rateLimits || {}),
      ...(incoming.rateLimits || {})
    }
  };
}

function applyTokenStatsToChat(chatId, incomingStats) {
  if (!chatId) {
    return;
  }
  const normalized = normalizeTokenStats(incomingStats);
  if (!normalized) {
    return;
  }
  const summary = chats.get(chatId);
  if (summary) {
    summary.tokenStats = mergeTokenStats(summary.tokenStats, normalized);
    chats.set(chatId, summary);
  }

  const detail = details.get(chatId);
  if (detail) {
    detail.tokenStats = mergeTokenStats(detail.tokenStats, normalized);
    details.set(chatId, detail);
  }
}

function renderTokenPanel() {
  if (!tokenSourceLine || !tokenTotalValue || !tokenLastValue || !tokenContextValue || !tokenContextPercentValue || !tokenBreakdownLine || !tokenQuotaLine) {
    return;
  }
  const chat = getChatSummary(selectedChatId);
  if (!chat) {
    setTokenPanelEmpty("Select a chat to see token usage and quota.");
    return;
  }

  const detail = details.get(chat.id);
  const tokenStats = normalizeTokenStats((detail && detail.tokenStats) || chat.tokenStats);
  if (!tokenStats) {
    setTokenPanelEmpty("No token telemetry yet for this chat.");
    return;
  }

  const total = tokenStats.total || null;
  const last = tokenStats.last || null;
  const context = toIntOrNull(tokenStats.modelContextWindow);
  const contextTotal = total ? toIntOrNull(total.totalTokens) : null;
  const contextPct =
    context && context > 0 && contextTotal !== null ? Math.min(100, Math.max(0, (contextTotal / context) * 100)) : null;

  const source = sourceLabel(chat);
  const updated = tokenStats.updatedAt ? formatShortTime(tokenStats.updatedAt) : "-";
  tokenSourceLine.textContent = `${source} • updated ${updated}`;
  tokenTotalValue.textContent = total ? formatInt(total.totalTokens) : "-";
  tokenLastValue.textContent = last ? formatInt(last.totalTokens) : "-";
  tokenContextValue.textContent = context ? formatInt(context) : "-";
  tokenContextPercentValue.textContent = contextPct === null ? "-" : formatPercent(contextPct);
  if (tokenQuickLine) {
    tokenQuickLine.textContent = [
      `Total ${total ? formatInt(total.totalTokens) : "-"}`,
      `Last ${last ? formatInt(last.totalTokens) : "-"}`,
      `Context ${contextPct === null ? "-" : formatPercent(contextPct)}`
    ].join(" • ");
  }

  if (total) {
    tokenBreakdownLine.textContent =
      `Total: in ${formatInt(total.inputTokens)} • cached ${formatInt(total.cachedInputTokens)} • out ${formatInt(
        total.outputTokens
      )} • reasoning ${formatInt(total.reasoningOutputTokens)}`;
  } else if (last) {
    tokenBreakdownLine.textContent =
      `Last: in ${formatInt(last.inputTokens)} • cached ${formatInt(last.cachedInputTokens)} • out ${formatInt(
        last.outputTokens
      )} • reasoning ${formatInt(last.reasoningOutputTokens)}`;
  } else {
    tokenBreakdownLine.textContent = "Input/Output breakdown appears with token_count events.";
  }

  const rate = tokenStats.rateLimits || {};
  const primary = rate.primary || null;
  const secondary = rate.secondary || null;
  const credits = rate.credits || null;
  const quotaParts = [];

  if (primary) {
    quotaParts.push(`Primary ${formatPercent(primary.usedPercent)} (reset ${formatResetTs(primary.resetsAt)})`);
  }
  if (secondary) {
    quotaParts.push(`Secondary ${formatPercent(secondary.usedPercent)} (reset ${formatResetTs(secondary.resetsAt)})`);
  }
  if (credits) {
    const balance = credits.balance || "-";
    const creditLabel =
      credits.unlimited === true ? "unlimited" : credits.hasCredits === true ? "credits-on" : "credits-off";
    quotaParts.push(`Credits ${creditLabel} (${balance})`);
  }

  tokenQuotaLine.textContent =
    quotaParts.length > 0
      ? `Quota: ${quotaParts.join(" • ")}`
      : "Quota: API total balance is not exposed here, only token/rate-limit telemetry.";
}

function getStoredToken() {
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function storeToken(token) {
  const value = (token || "").trim();
  if (!value) {
    return;
  }
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, value);
  } catch {
    // ignore storage failures
  }
}

function clearStoredToken() {
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

function requestTokenFromUser(reason) {
  const suffix = reason ? ` (${reason})` : "";
  const entered = window.prompt(`Enter APP_TOKEN once${suffix}:`, "");
  if (typeof entered !== "string") {
    return "";
  }
  return entered.trim();
}

function tryAuthenticateWithToken(token) {
  const value = (token || "").trim();
  if (!value) {
    return false;
  }
  pendingAuthToken = value;
  send({ type: "auth", token: value });
  const liveState = appServerEnabled ? (appServerReady ? "live-on" : "live-starting") : "live-off";
  setStatus(`Authenticating (${liveState})`, true);
  return true;
}

function stamp() {
  return new Date().toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}

function send(msg) {
  if (!ws || ws.readyState !== 1) {
    return;
  }
  ws.send(JSON.stringify(msg));
}

function getChatSummary(chatId) {
  return chatId ? chats.get(chatId) || null : null;
}

function ensureChatDetail(chatId) {
  if (!details.has(chatId)) {
    details.set(chatId, {
      id: chatId,
      logs: [],
      messages: [],
      runs: []
    });
  }
  return details.get(chatId);
}

function clip(text, size) {
  if (!text) {
    return "";
  }
  if (text.length <= size) {
    return text;
  }
  return `${text.slice(0, size)}...`;
}

function toChatArrayUnfiltered() {
  return Array.from(chats.values()).sort((a, b) => {
    const aa = a.updatedAt || "";
    const bb = b.updatedAt || "";
    if (aa < bb) {
      return 1;
    }
    if (aa > bb) {
      return -1;
    }
    return 0;
  });
}

function toChatArray() {
  const search = (chatSearchInput.value || "").trim().toLowerCase();
  const filter = chatSourceFilter.value || "all";

  return toChatArrayUnfiltered().filter((chat) => {
    const key = sourceKey(chat);
    if (filter !== "all" && key !== filter) {
      return false;
    }

    if (!search) {
      return true;
    }
    const hay = `${chat.title || ""}\n${chat.lastUserMessage || ""}\n${chat.lastAssistantMessage || ""}`.toLowerCase();
    return hay.includes(search);
  });
}

function renderChatStats() {
  const all = toChatArrayUnfiltered();
  const visible = toChatArray();
  const running = all.filter((c) => c.status === "running").length;
  chatStats.textContent = `${visible.length}/${all.length} chats shown • ${running} running`;
}

function setActionState() {
  const chat = getChatSummary(selectedChatId);
  const hasSelection = Boolean(chat);
  const isRunning = chat && chat.status === "running";
  const isReadOnly = Boolean(chat && chat.readOnly);
  const isMirrorSource = sourceKey(chat) === "vscode" || sourceKey(chat) === "codex";
  const liveTwinId = linkedLiveChatId(chat);
  const isLiveChat = sourceKey(chat) === "live";
  const liveUnavailable = isLiveChat && !appServerReady;
  const canContinueMirror = canContinueMirroredChat(chat);
  const canRun = canRunChat(chat);
  const disableRunControls = !authed || !hasSelection || Boolean(isRunning) || !canRun || liveUnavailable;
  runBtn.disabled = disableRunControls;
  runBtn.textContent = canContinueMirror ? "Continue" : "Run";
  cancelBtn.disabled = !authed || !hasSelection || !isRunning || !canRun || liveUnavailable;
  cloneToLocalBtn.disabled = !authed || !hasSelection;
  cloneToLocalBtn.classList.toggle("hidden", !hasSelection || canRun || !isReadOnly);
  activateLiveBtn.disabled = !authed || !hasSelection || !isReadOnly || !isMirrorSource || !appServerEnabled || Boolean(isRunning);
  activateLiveBtn.classList.toggle(
    "hidden",
    !hasSelection || !isReadOnly || !isMirrorSource || !appServerEnabled
  );
  if (liveTwinId) {
    activateLiveBtn.textContent = "Open Linked Live Thread";
  } else if (!appServerReady) {
    activateLiveBtn.textContent = "Open As Live Thread (starting...)";
  } else {
    activateLiveBtn.textContent = "Open As Live Thread";
  }
  createChatBtn.disabled = !authed;
  refreshMirrorBtn.disabled = !authed;
  fileRootSelect.disabled = !authed || fileState.roots.length === 0;
  fileUpBtn.disabled = !authed;
  fileRefreshBtn.disabled = !authed;
  fileJumpInput.disabled = !authed;
  fileJumpBtn.disabled = !authed;

  const disableWorkspaceFields = !hasSelection || isReadOnly;
  const disablePromptField = !hasSelection || (isReadOnly && !canContinueMirror);
  cwdInput.disabled = disableWorkspaceFields;
  modeSelect.disabled = disableWorkspaceFields;
  promptInput.disabled = disablePromptField;
  if (!hasSelection) {
    promptInput.placeholder = "Select a chat first...";
  } else if (isReadOnly && canContinueMirror) {
    promptInput.placeholder = "Continue this mirrored Codex chat...";
  } else if (isReadOnly) {
    promptInput.placeholder = "Mirrored chat (read-only)";
  } else {
    promptInput.placeholder = "Ask Codex what to do...";
  }
}

function addLogLine(chatId, line) {
  const detail = ensureChatDetail(chatId);
  detail.logs.push(`[${stamp()}] ${line}`);
  if (detail.logs.length > 900) {
    detail.logs.splice(0, detail.logs.length - 900);
  }
  if (selectedChatId === chatId) {
    renderLogs();
  }
}

function appendMessage(chatId, role, text, runId) {
  const detail = ensureChatDetail(chatId);
  detail.messages.push({
    id: `msg_local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    role,
    text,
    runId: runId || null,
    createdAt: new Date().toISOString()
  });
  if (detail.messages.length > 220) {
    detail.messages.splice(0, detail.messages.length - 220);
  }
}

function mergeSummary(summary) {
  const prev = chats.get(summary.id) || {};
  const mergedTokenStats = mergeTokenStats(prev.tokenStats, summary.tokenStats);
  chats.set(summary.id, {
    ...prev,
    ...summary,
    tokenStats: mergedTokenStats
  });
}

function renderChatList() {
  chatList.innerHTML = "";

  const sorted = toChatArray();
  renderChatStats();
  if (sorted.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "No chats match this filter.";
    chatList.appendChild(empty);
    renderTokenPanel();
    refreshFileQuickPaths();
    return;
  }

  sorted.forEach((chat) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `chat-item${chat.id === selectedChatId ? " selected" : ""}`;

    const top = document.createElement("div");
    top.className = "chat-item-top";

    const title = document.createElement("span");
    title.className = "chat-title";
    title.textContent = chat.title || "Untitled";

    const badge = document.createElement("span");
    badge.className = `chat-badge status-${chat.status || "idle"}`;
    badge.textContent = statusLabel(chat.status);

    const source = document.createElement("span");
    const srcKey = sourceKey(chat);
    source.className = `chat-source source-${srcKey}`;
    source.textContent = srcKey;

    const preview = document.createElement("p");
    preview.className = "chat-preview";
    const hint =
      chat.lastAssistantMessage || chat.lastUserMessage || (chat.status === "running" ? "Running..." : "No messages yet.");
    preview.textContent = clip(hint, 92);

    top.appendChild(title);
    top.appendChild(source);
    top.appendChild(badge);
    btn.appendChild(top);
    btn.appendChild(preview);

    btn.addEventListener("click", () => {
      selectChat(chat.id, true, { focusComposer: true, openChatView: true });
    });

    chatList.appendChild(btn);
  });
  renderTokenPanel();
  refreshFileQuickPaths();
}

function renderLogs() {
  const detail = selectedChatId ? details.get(selectedChatId) : null;
  if (!detail || !Array.isArray(detail.logs) || detail.logs.length === 0) {
    logPanel.textContent = "No logs yet for this chat.";
    return;
  }
  logPanel.textContent = detail.logs.join("\n");
  logPanel.scrollTop = logPanel.scrollHeight;
}

function roleLabel(role) {
  if (role === "assistant") {
    return "Assistant";
  }
  return "You";
}

function formatShortTime(iso) {
  if (!iso) {
    return "";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit"
  });
}

function renderMessages() {
  messagesPanel.innerHTML = "";

  const detail = selectedChatId ? details.get(selectedChatId) : null;
  if (!detail || !Array.isArray(detail.messages) || detail.messages.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "No messages yet in this chat.";
    messagesPanel.appendChild(empty);
    return;
  }

  detail.messages.forEach((msg) => {
    const box = document.createElement("article");
    box.className = `message message-${msg.role || "user"}`;

    const meta = document.createElement("div");
    meta.className = "message-meta";
    meta.textContent = `${roleLabel(msg.role)} ${formatShortTime(msg.createdAt)}`;

    const body = document.createElement("div");
    body.className = "message-body";
    body.textContent = msg.text || "";

    box.appendChild(meta);
    box.appendChild(body);
    messagesPanel.appendChild(box);
  });
  requestAnimationFrame(() => {
    messagesPanel.scrollTop = messagesPanel.scrollHeight;
  });
}

function renderFinal() {
  const detail = selectedChatId ? details.get(selectedChatId) : null;
  if (!detail || !Array.isArray(detail.messages)) {
    finalPanel.textContent = "";
    return;
  }

  let lastAssistant = "";
  for (let i = detail.messages.length - 1; i >= 0; i -= 1) {
    if (detail.messages[i].role === "assistant") {
      lastAssistant = detail.messages[i].text || "";
      break;
    }
  }

  if (!lastAssistant) {
    const summary = getChatSummary(selectedChatId);
    lastAssistant = (summary && summary.lastAssistantMessage) || "";
  }

  finalPanel.textContent = lastAssistant;
}

function normalizeApprovalList(raw) {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((entry) => ({
      requestId: String(entry.requestId || ""),
      method: entry.method || "approval",
      createdAt: entry.createdAt || "",
      params: entry.params || {}
    }))
    .filter((entry) => entry.requestId);
}

function approvalHint(approval) {
  const method = approval.method || "";
  const params = approval.params || {};
  if (typeof params.reason === "string" && params.reason.trim()) {
    return params.reason.trim();
  }
  if (typeof params.command === "string" && params.command.trim()) {
    return params.command.trim();
  }
  return method;
}

function renderApprovals() {
  const chat = getChatSummary(selectedChatId);
  const src = sourceKey(chat);
  const list = normalizeApprovalList(approvalsByChat.get(selectedChatId) || []);

  const show = Boolean(chat && src === "live" && list.length > 0);
  approvalPanel.classList.toggle("hidden", !show);
  approvalList.innerHTML = "";
  if (show && advancedRun && !advancedRun.open) {
    advancedRun.open = true;
  }
  if (!show) {
    return;
  }

  list.forEach((approval) => {
    const box = document.createElement("article");
    box.className = "approval-item";

    const text = document.createElement("p");
    text.className = "approval-text";
    text.textContent = approvalHint(approval);
    box.appendChild(text);

    const actions = document.createElement("div");
    actions.className = "approval-actions";

    const approveBtn = document.createElement("button");
    approveBtn.type = "button";
    approveBtn.className = "btn secondary";
    approveBtn.textContent = "Approve";
    approveBtn.addEventListener("click", () => {
      send({ type: "approval/respond", requestId: approval.requestId, action: "approve" });
      addLogLine(selectedChatId, `approval sent: approve (${approval.requestId})`);
    });

    const approveSessionBtn = document.createElement("button");
    approveSessionBtn.type = "button";
    approveSessionBtn.className = "btn secondary";
    approveSessionBtn.textContent = "Approve Session";
    approveSessionBtn.addEventListener("click", () => {
      send({ type: "approval/respond", requestId: approval.requestId, action: "approve_session" });
      addLogLine(selectedChatId, `approval sent: approve_session (${approval.requestId})`);
    });

    const denyBtn = document.createElement("button");
    denyBtn.type = "button";
    denyBtn.className = "btn ghost";
    denyBtn.textContent = "Deny";
    denyBtn.addEventListener("click", () => {
      send({ type: "approval/respond", requestId: approval.requestId, action: "deny" });
      addLogLine(selectedChatId, `approval sent: deny (${approval.requestId})`);
    });

    actions.appendChild(approveBtn);
    actions.appendChild(approveSessionBtn);
    actions.appendChild(denyBtn);
    box.appendChild(actions);
    approvalList.appendChild(box);
  });
}

function setFileRoots(roots) {
  fileState.roots = Array.isArray(roots) ? roots.slice() : [];
  fileRootSelect.innerHTML = "";

  if (fileState.roots.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "No roots";
    fileRootSelect.appendChild(opt);
    fileRootSelect.disabled = true;
    return;
  }

  fileRootSelect.disabled = false;
  fileState.roots.forEach((rootPath) => {
    const opt = document.createElement("option");
    opt.value = rootPath;
    opt.textContent = rootPath;
    fileRootSelect.appendChild(opt);
  });
  refreshFileQuickPaths();
}

function isLikelyAbsolutePath(input) {
  return typeof input === "string" && input.startsWith("/");
}

function pushUniquePath(target, seen, rawPath) {
  const value = typeof rawPath === "string" ? rawPath.trim().replace(/\/+$/g, "") : "";
  if (!isLikelyAbsolutePath(value)) {
    return;
  }
  if (seen.has(value)) {
    return;
  }
  seen.add(value);
  target.push(value);
}

function shortPathLabel(fullPath) {
  const clean = String(fullPath || "").trim();
  if (!clean) {
    return "-";
  }
  const parts = clean.split("/").filter(Boolean);
  if (parts.length <= 2) {
    return clean;
  }
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

function refreshFileQuickPaths() {
  if (!fileQuickPaths) {
    return;
  }
  fileQuickPaths.innerHTML = "";
  const seen = new Set();
  const candidates = [];

  pushUniquePath(candidates, seen, fileState.currentPath);
  pushUniquePath(candidates, seen, fileState.parentPath);
  pushUniquePath(candidates, seen, fileRootSelect.value);
  fileState.roots.forEach((root) => pushUniquePath(candidates, seen, root));

  const selected = getChatSummary(selectedChatId);
  pushUniquePath(candidates, seen, selected && selected.cwd ? selected.cwd : "");

  toChatArrayUnfiltered()
    .slice(0, 24)
    .forEach((chat) => {
      pushUniquePath(candidates, seen, chat.cwd || "");
    });

  const visible = candidates.slice(0, QUICK_PATH_LIMIT);
  if (visible.length === 0) {
    return;
  }

  visible.forEach((fullPath) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "quick-path-btn";
    btn.title = fullPath;
    btn.textContent = shortPathLabel(fullPath);
    btn.addEventListener("click", () => {
      fileJumpInput.value = fullPath;
      requestFileList(fullPath);
    });
    fileQuickPaths.appendChild(btn);
  });
}

function requestFileList(targetPath) {
  send({ type: "fs/list", path: targetPath || fileState.currentPath || fileRootSelect.value });
}

function requestFileRead(targetPath) {
  send({ type: "fs/read", path: targetPath });
}

function renderFileEntries(entries) {
  fileList.innerHTML = "";

  if (!Array.isArray(entries) || entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "file-empty";
    empty.textContent = "Empty directory.";
    fileList.appendChild(empty);
    return;
  }

  entries.forEach((entry) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "file-item";

    const kind = document.createElement("span");
    kind.className = "file-kind";
    kind.textContent = entry.kind === "dir" ? "dir" : "file";

    const label = document.createElement("span");
    label.textContent = entry.name;

    btn.appendChild(kind);
    btn.appendChild(label);

    btn.addEventListener("click", () => {
      if (entry.kind === "dir") {
        requestFileList(entry.path);
      } else {
        requestFileRead(entry.path);
      }
    });

    fileList.appendChild(btn);
  });
}

function focusComposer() {
  if (!promptInput) {
    return;
  }
  const runCard = promptInput.closest(".card");
  if (runCard) {
    runCard.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }
  requestAnimationFrame(() => {
    try {
      promptInput.focus({ preventScroll: true });
    } catch {
      promptInput.focus();
    }
  });
}

function selectChat(chatId, requestDetail, options = {}) {
  const focusOnComposer = Boolean(options.focusComposer);
  const openChatView = Boolean(options.openChatView);
  selectedChatId = chatId;
  const chat = getChatSummary(chatId);

  selectedChatName.textContent = chat ? chat.title : "None";
  selectedChatSource.textContent = sourceLabel(chat);
  if (chatDetailCaption) {
    chatDetailCaption.textContent = chat ? sourceLabel(chat) : "Chat view";
  }
  readOnlyHint.textContent = readOnlyHintText(chat);
  readOnlyHint.classList.toggle("hidden", !chat || !chat.readOnly);
  if (chat) {
    if (chat.cwd) {
      cwdInput.value = chat.cwd;
    }
    modeSelect.value = chat.mode === "workspace-write" ? "workspace-write" : "read-only";
  }

  renderChatList();
  renderMessages();
  renderLogs();
  renderFinal();
  renderTokenPanel();
  refreshFileQuickPaths();
  setActionState();
  renderApprovals();

  if (requestDetail && chatId) {
    send({ type: "get_chat", chatId });
  }
  if (openChatView) {
    setChatFocusMode(true);
  }
  if (focusOnComposer && chat) {
    focusComposer();
  }
}

function applyDetail(detail) {
  approvalsByChat.set(detail.id, normalizeApprovalList(detail.approvals || []));
  const prevDetail = details.get(detail.id) || {};
  const mergedTokenStats = mergeTokenStats(prevDetail.tokenStats, detail.tokenStats);
  details.set(detail.id, {
    ...detail,
    logs: Array.isArray(detail.logs) ? detail.logs.slice() : [],
    messages: Array.isArray(detail.messages) ? detail.messages.slice() : [],
    runs: Array.isArray(detail.runs) ? detail.runs.slice() : [],
    tokenStats: mergedTokenStats
  });
  mergeSummary(detail);
}

function eventSummary(event) {
  const eventType = event.type || event.method || "unknown";

  if (eventType === "event_msg" && event.payload && event.payload.type === "token_count") {
    const info = event.payload.info || {};
    const total = info.total_token_usage || {};
    const totalTokens = total.total_tokens;
    if (typeof totalTokens === "number") {
      return `token_count total=${totalTokens}`;
    }
    return "token_count";
  }

  if (eventType === "item/agentMessage/delta") {
    const delta = event.params?.delta || "";
    return `assistant(delta): ${delta}`;
  }

  if (eventType === "item.completed") {
    const item = event.item || {};
    if (item.type === "command_execution") {
      return `cmd: ${item.command || "(command)"}`;
    }
    if (item.type === "agent_message" && typeof item.text === "string") {
      return "assistant: full message";
    }
  }

  if (eventType === "item/completed") {
    const item = event.params?.item || {};
    if (item.type === "commandExecution") {
      return `cmd: ${item.command || "(command)"}`;
    }
    if (item.type === "agentMessage" && typeof item.text === "string") {
      return "assistant: full message";
    }
  }

  return eventType;
}

function applyRunEvent(chatId, runId, event) {
  const detail = ensureChatDetail(chatId);
  const eventType = event.type || event.method || "unknown";
  const tokenStats = parseTokenStatsFromEvent(event);
  if (tokenStats) {
    applyTokenStatsToChat(chatId, tokenStats);
    if (selectedChatId === chatId) {
      renderTokenPanel();
    }
  }

  if (eventType === "item/agentMessage/delta") {
    const key = `${chatId}:${runId}`;
    const prev = streamCache.get(key) || "";
    const delta = event.params?.delta || "";
    streamCache.set(key, prev + delta);

    if (selectedChatId === chatId) {
      finalPanel.textContent = streamCache.get(key);
    }
  }

  if (eventType === "item.completed") {
    const item = event.item || {};
    if (item.type === "agent_message" && typeof item.text === "string") {
      const key = `${chatId}:${runId}`;
      streamCache.set(key, item.text);
      if (selectedChatId === chatId) {
        finalPanel.textContent = item.text;
      }
    }
  }

  if (eventType === "item/completed") {
    const item = event.params?.item || {};
    if (item.type === "agentMessage" && typeof item.text === "string") {
      const key = `${chatId}:${runId}`;
      streamCache.set(key, item.text);
      if (selectedChatId === chatId) {
        finalPanel.textContent = item.text;
      }
    }
  }

  const summary = eventSummary(event);
  addLogLine(chatId, summary);

  if (!Array.isArray(detail.logs)) {
    detail.logs = [];
  }
}

function handleServerMessage(data) {
  if (data.type === "hello") {
    requiresToken = Boolean(data.requiresToken);
    authed = !requiresToken;
    appServerEnabled = Boolean(data.appServer && data.appServer.enabled);
    appServerReady = Boolean(data.appServer && data.appServer.ready);
    applyGithubProfileUrl(data.githubProfileUrl || "");
    const storedToken = getStoredToken();
    if (!fileJumpInput.value && typeof data.defaultCwd === "string" && data.defaultCwd) {
      fileJumpInput.value = data.defaultCwd;
    }
    const liveState = appServerEnabled ? (appServerReady ? "live-on" : "live-starting") : "live-off";
    setStatus(requiresToken ? `Connected (token required, ${liveState})` : `Connected (${liveState})`, true);
    setFileRoots(data.browseRoots || []);
    if (requiresToken && !authed) {
      const firstToken = storedToken || requestTokenFromUser("");
      if (tryAuthenticateWithToken(firstToken)) {
        setActionState();
        return;
      }
      setStatus(`Token required (${liveState})`, true);
      setActionState();
      return;
    }
    if (authed && (data.browseRoots || []).length > 0) {
      fileRootSelect.value = data.browseRoots[0];
      requestFileList(data.browseRoots[0]);
    }
    setActionState();
    return;
  }

  if (data.type === "auth/ok") {
    authed = true;
    storeToken(pendingAuthToken);
    pendingAuthToken = "";
    setStatus(appServerEnabled ? (appServerReady ? "Authenticated (live-on)" : "Authenticated (live-starting)") : "Authenticated", true);
    if (fileRootSelect.value) {
      requestFileList(fileRootSelect.value);
    }
    refreshFileQuickPaths();
    setActionState();
    return;
  }

  if (data.type === "auth/error") {
    authed = false;
    setStatus("Auth failed", true);
    filePreview.textContent = "Authenticate to use file browser.";
    addLogLine(selectedChatId || "global", `Auth error: ${data.error || "unknown"}`);
    const errText = (data.error || "").toLowerCase();
    if (errText.includes("token")) {
      clearStoredToken();
      pendingAuthToken = "";
    }
    if (requiresToken) {
      const retryToken = requestTokenFromUser("auth failed");
      if (tryAuthenticateWithToken(retryToken)) {
        setActionState();
        return;
      }
    }
    setActionState();
    return;
  }

  if (data.type === "appserver/status") {
    appServerEnabled = Boolean(data.enabled);
    appServerReady = Boolean(data.ready);
    if (authed) {
      setStatus(appServerEnabled ? (appServerReady ? "Authenticated (live-on)" : "Authenticated (live-starting)") : "Authenticated", true);
    }
    if (appServerReady && queuedLiveActivationChatId) {
      send({
        type: "activate_live_chat",
        sourceChatId: queuedLiveActivationChatId
      });
      queuedLiveActivationChatId = "";
    }
    setActionState();
    return;
  }

  if (data.type === "server/error") {
    const errorText = data.error || "unknown";
    if (selectedChatId) {
      addLogLine(selectedChatId, `server error: ${errorText}`);
      appendMessage(selectedChatId, "assistant", `Error: ${errorText}`, null);
      renderMessages();
      renderFinal();
    } else {
      setStatus(`Server error: ${errorText}`, true);
    }
    return;
  }

  if (data.type === "fs/error") {
    filePreview.textContent = `File browser error: ${data.error || "unknown"}`;
    return;
  }

  if (data.type === "fs/list") {
    fileState.currentPath = data.path || "";
    fileState.parentPath = data.parent || "";
    filePathDisplay.textContent = data.path || "-";

    if (fileState.roots.some((root) => fileState.currentPath === root || fileState.currentPath.startsWith(`${root}/`))) {
      const matchedRoot = fileState.roots.find(
        (root) => fileState.currentPath === root || fileState.currentPath.startsWith(`${root}/`)
      );
      if (matchedRoot) {
        fileRootSelect.value = matchedRoot;
      }
    }

    renderFileEntries(data.entries || []);
    refreshFileQuickPaths();
    if (data.truncated) {
      filePreview.textContent = `Directory too large, showing first entries only.\nPath: ${data.path}`;
    }
    return;
  }

  if (data.type === "fs/read") {
    filePathDisplay.textContent = data.path || fileState.currentPath || "-";
    filePreview.textContent = data.text || "";
    if (data.truncated) {
      filePreview.textContent += "\n\n[truncated preview]";
    }
    return;
  }

  if (data.type === "mirror/refreshed") {
    if (selectedChatId) {
      addLogLine(selectedChatId, `mirror refreshed (${data.count || 0} mirrored chats)`);
    }
    return;
  }

  if (data.type === "approval/request") {
    const chatId = data.chatId;
    if (!chatId || !data.approval) {
      return;
    }
    const list = normalizeApprovalList(approvalsByChat.get(chatId) || []);
    list.push({
      requestId: String(data.approval.requestId || ""),
      method: data.approval.method || "approval",
      createdAt: data.approval.createdAt || new Date().toISOString(),
      params: data.approval.params || {}
    });
    approvalsByChat.set(chatId, list);
    if (selectedChatId === chatId) {
      addLogLine(chatId, `approval requested: ${data.approval.method || "approval"}`);
      renderApprovals();
    }
    return;
  }

  if (data.type === "approval/resolved") {
    const chatId = data.chatId;
    const requestId = String(data.requestId || "");
    if (!chatId || !requestId) {
      return;
    }
    const list = normalizeApprovalList(approvalsByChat.get(chatId) || []);
    approvalsByChat.set(
      chatId,
      list.filter((entry) => entry.requestId !== requestId)
    );
    if (selectedChatId === chatId) {
      renderApprovals();
    }
    return;
  }

  if (data.type === "approval/ack") {
    if (selectedChatId) {
      addLogLine(selectedChatId, `approval ack: ${data.action || "sent"} (${data.requestId || "?"})`);
    }
    return;
  }

  if (data.type === "chats/snapshot") {
    const previousApprovals = new Map(approvalsByChat);
    chats.clear();
    approvalsByChat.clear();

    const list = Array.isArray(data.chats) ? data.chats : [];
    list.forEach((chat) => {
      mergeSummary(chat);
      ensureChatDetail(chat.id);
      approvalsByChat.set(chat.id, normalizeApprovalList(previousApprovals.get(chat.id) || []));
    });

    renderChatList();

    if (!selectedChatId || !chats.has(selectedChatId)) {
      const first = toChatArray()[0];
      if (first) {
        selectChat(first.id, true);
      }
    } else {
      selectChat(selectedChatId, true);
    }

    return;
  }

  if (data.type === "chat/created") {
    if (!data.chat || !data.chat.id) {
      return;
    }
    mergeSummary(data.chat);
    ensureChatDetail(data.chat.id);
    approvalsByChat.set(data.chat.id, approvalsByChat.get(data.chat.id) || []);
    renderChatList();

    selectChat(data.chat.id, true, { focusComposer: true, openChatView: true });
    return;
  }

  if (data.type === "chat/cloned") {
    if (data.chatId) {
      selectChat(data.chatId, true, { focusComposer: true, openChatView: true });
    }
    return;
  }

  if (data.type === "chat/activated_live") {
    const nextChatId = typeof data.chatId === "string" ? data.chatId : "";
    if (nextChatId) {
      addLogLine(nextChatId, "live thread activated");
      selectChat(nextChatId, true, { focusComposer: true, openChatView: true });
    }
    return;
  }

  if (data.type === "chat/updated") {
    if (!data.chat || !data.chat.id) {
      return;
    }
    mergeSummary(data.chat);
    renderChatList();

    if (selectedChatId === data.chat.id) {
      selectedChatName.textContent = data.chat.title || "Untitled";
      selectedChatSource.textContent = sourceLabel(data.chat);
      readOnlyHint.textContent = readOnlyHintText(data.chat);
      readOnlyHint.classList.toggle("hidden", !data.chat.readOnly);
      renderTokenPanel();
      setActionState();
      renderApprovals();
    }
    return;
  }

  if (data.type === "chat/detail") {
    if (!data.chat || !data.chat.id) {
      return;
    }

    applyDetail(data.chat);
    renderChatList();

    if (selectedChatId === data.chat.id) {
      selectedChatName.textContent = data.chat.title || "Untitled";
      selectedChatSource.textContent = sourceLabel(data.chat);
      readOnlyHint.textContent = readOnlyHintText(data.chat);
      readOnlyHint.classList.toggle("hidden", !data.chat.readOnly);
      if (data.chat.cwd) {
        cwdInput.value = data.chat.cwd;
      }
      modeSelect.value = data.chat.mode === "workspace-write" ? "workspace-write" : "read-only";
      renderMessages();
      renderLogs();
      renderFinal();
      renderTokenPanel();
      setActionState();
      renderApprovals();
    }
    return;
  }

  if (data.type === "run/accepted") {
    const { chatId, runId } = data;
    const detail = ensureChatDetail(chatId);

    addLogLine(chatId, `run started (${data.mode}) in ${data.cwd}`);
    addLogLine(chatId, `$ ${data.command}`);

    if (!Array.isArray(detail.messages)) {
      detail.messages = [];
    }

    const summary = getChatSummary(chatId);
    if (summary) {
      summary.status = "running";
      summary.currentRunId = runId;
      summary.updatedAt = new Date().toISOString();
      chats.set(chatId, summary);
    }

    renderChatList();
    if (selectedChatId === chatId) {
      setActionState();
    }
    return;
  }

  if (data.type === "run/event") {
    applyRunEvent(data.chatId, data.runId, data.event || {});
    return;
  }

  if (data.type === "run/raw") {
    addLogLine(data.chatId, `raw: ${data.line || ""}`);
    return;
  }

  if (data.type === "run/stderr") {
    addLogLine(data.chatId, `stderr: ${data.line || ""}`);
    return;
  }

  if (data.type === "run/completed" || data.type === "run/failed") {
    const chatId = data.chatId;
    const runId = data.runId;
    const status = data.type === "run/completed" ? "completed" : "failed";

    addLogLine(chatId, `run ${status} (exit ${String(data.exitCode)})`);

    if (data.finalText) {
      appendMessage(chatId, "assistant", data.finalText, runId);
    }

    const summary = getChatSummary(chatId);
    if (summary) {
      summary.status = data.type === "run/completed" ? "idle" : "failed";
      summary.currentRunId = null;
      summary.updatedAt = new Date().toISOString();
      if (data.finalText) {
        summary.lastAssistantMessage = data.finalText;
      }
      chats.set(chatId, summary);
    }

    if (selectedChatId === chatId) {
      renderMessages();
      renderFinal();
      setActionState();
      send({ type: "get_chat", chatId });
    }

    renderChatList();
    return;
  }

  if (data.type === "run/error") {
    const errorText = data.error || "unknown";
    addLogLine(data.chatId, `start error: ${errorText}`);
    appendMessage(data.chatId, "assistant", `Run failed: ${errorText}`, data.runId || null);

    const summary = getChatSummary(data.chatId);
    if (summary) {
      summary.status = "failed";
      summary.currentRunId = null;
      summary.lastError = errorText;
      summary.lastAssistantMessage = `Run failed: ${errorText}`;
      summary.updatedAt = new Date().toISOString();
      chats.set(data.chatId, summary);
    }

    if (selectedChatId === data.chatId) {
      renderMessages();
      renderFinal();
      setActionState();
      send({ type: "get_chat", chatId: data.chatId });
    }

    renderChatList();
    return;
  }
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

  ws.addEventListener("open", () => {
    setStatus("Connected", true);
  });

  ws.addEventListener("message", (evt) => {
    try {
      handleServerMessage(JSON.parse(evt.data));
    } catch {
      if (selectedChatId) {
        addLogLine(selectedChatId, `invalid server payload: ${evt.data}`);
      }
    }
  });

  ws.addEventListener("close", () => {
    authed = false;
    setStatus("Disconnected", false);
    filePreview.textContent = "Disconnected.";
    setActionState();
    setTimeout(connect, 2000);
  });

  ws.addEventListener("error", () => {
    setStatus("Connection error", false);
  });
}

runBtn.addEventListener("click", () => {
  if (!selectedChatId) {
    return;
  }

  const selected = getChatSummary(selectedChatId);
  if (selected && !canRunChat(selected)) {
    const linked = linkedLiveChatId(selected);
    const key = sourceKey(selected);
    if (linked) {
      selectChat(linked, true, { focusComposer: true, openChatView: true });
      return;
    }
    if ((key === "vscode" || key === "codex") && appServerEnabled && appServerReady) {
      send({
        type: "activate_live_chat",
        sourceChatId: selected.id
      });
      addLogLine(selectedChatId, "activating live thread...");
      return;
    }
    addLogLine(selectedChatId, "this mirrored chat is read-only in the web app");
    return;
  }

  const prompt = promptInput.value.trim();
  const cwd = cwdInput.value.trim();
  const mode = modeSelect.value;

  if (!prompt) {
    addLogLine(selectedChatId, "prompt is empty");
    return;
  }

  if (!authed) {
    addLogLine(selectedChatId, "not authenticated");
    return;
  }

  appendMessage(selectedChatId, "user", prompt, null);
  renderMessages();

  const summary = getChatSummary(selectedChatId);
  if (summary) {
    summary.lastUserMessage = prompt;
    summary.status = "running";
    if (!summary.readOnly) {
      summary.cwd = cwd;
      summary.mode = mode;
    } else if (canContinueMirroredChat(summary)) {
      summary.mode = "resume";
    }
    summary.updatedAt = new Date().toISOString();
    chats.set(selectedChatId, summary);
  }

  renderChatList();
  setActionState();

  send({
    type: "run",
    chatId: selectedChatId,
    prompt,
    cwd,
    mode
  });
});

cancelBtn.addEventListener("click", () => {
  if (!selectedChatId) {
    return;
  }
  const selected = getChatSummary(selectedChatId);
  if (selected && !canRunChat(selected)) {
    addLogLine(selectedChatId, "mirrored chats cannot be cancelled from this app");
    return;
  }
  send({ type: "cancel", chatId: selectedChatId });
  addLogLine(selectedChatId, "stop requested...");
});

if (backToChatsBtn) {
  backToChatsBtn.addEventListener("click", () => {
    setChatFocusMode(false);
    if (chatsCard) {
      chatsCard.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    } else if (mainHeader) {
      mainHeader.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }
  });
}

createChatBtn.addEventListener("click", () => {
  if (!authed) {
    return;
  }
  const useLiveCreate = appServerEnabled && appServerReady;
  const payload =
    useLiveCreate
      ? {
          type: "create_live_chat",
          title: chatTitleInput.value.trim(),
          cwd: cwdInput.value.trim(),
          mode: modeSelect.value
        }
      : {
          type: "create_chat",
          title: chatTitleInput.value.trim()
        };
  send(payload);
  if (!useLiveCreate && appServerEnabled && !appServerReady && selectedChatId) {
    addLogLine(selectedChatId, "live is still starting; created local web chat instead");
  }
  chatTitleInput.value = "";
});

cloneToLocalBtn.addEventListener("click", () => {
  if (!authed || !selectedChatId) {
    return;
  }
  const selected = getChatSummary(selectedChatId);
  if (!selected) {
    return;
  }
  send({
    type: "clone_chat",
    sourceChatId: selected.id
  });
});

activateLiveBtn.addEventListener("click", () => {
  if (!authed || !selectedChatId) {
    return;
  }
  if (!appServerReady) {
    queuedLiveActivationChatId = selectedChatId;
    addLogLine(selectedChatId, "live engine is still starting; activation will retry automatically...");
    send({ type: "refresh_mirror" });
    return;
  }
  send({
    type: "activate_live_chat",
    sourceChatId: selectedChatId
  });
});

refreshMirrorBtn.addEventListener("click", () => {
  if (!authed) {
    return;
  }
  send({ type: "refresh_mirror" });
});

chatTitleInput.addEventListener("keydown", (evt) => {
  if (evt.key === "Enter") {
    evt.preventDefault();
    createChatBtn.click();
  }
});

chatSearchInput.addEventListener("input", () => {
  renderChatList();
});

chatSourceFilter.addEventListener("change", () => {
  renderChatList();
});

fileRootSelect.addEventListener("change", () => {
  if (!fileRootSelect.value) {
    return;
  }
  requestFileList(fileRootSelect.value);
});

fileUpBtn.addEventListener("click", () => {
  if (fileState.parentPath) {
    requestFileList(fileState.parentPath);
    return;
  }
  if (fileRootSelect.value) {
    requestFileList(fileRootSelect.value);
  }
});

fileRefreshBtn.addEventListener("click", () => {
  requestFileList(fileState.currentPath || fileRootSelect.value);
});

fileJumpBtn.addEventListener("click", () => {
  const targetPath = (fileJumpInput.value || "").trim();
  if (!targetPath) {
    return;
  }
  requestFileList(targetPath);
});

fileJumpInput.addEventListener("keydown", (evt) => {
  if (evt.key !== "Enter") {
    return;
  }
  evt.preventDefault();
  fileJumpBtn.click();
});

presets.forEach((preset) => {
  const btn = document.createElement("button");
  btn.className = "preset";
  btn.type = "button";
  btn.textContent = preset.label;
  btn.addEventListener("click", () => {
    promptInput.value = preset.prompt;
    promptInput.focus();
  });
  presetsWrap.appendChild(btn);
});

renderTokenPanel();
connect();
setInterval(() => {
  send({ type: "ping" });
}, 20000);
setInterval(() => {
  if (!authed || !ws || ws.readyState !== 1) {
    return;
  }
  send({ type: "refresh_mirror" });
}, MIRROR_AUTO_REFRESH_MS);
setInterval(() => {
  if (!authed || !selectedChatId || !ws || ws.readyState !== 1) {
    return;
  }
  send({ type: "get_chat", chatId: selectedChatId });
}, DETAIL_AUTO_REFRESH_MS);
