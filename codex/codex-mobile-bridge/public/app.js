const connectionDot = document.getElementById("connectionDot");
const connectionText = document.getElementById("connectionText");
const authCard = document.getElementById("authCard");
const tokenInput = document.getElementById("tokenInput");
const authBtn = document.getElementById("authBtn");
const chatTitleInput = document.getElementById("chatTitleInput");
const createChatBtn = document.getElementById("createChatBtn");
const refreshMirrorBtn = document.getElementById("refreshMirrorBtn");
const chatList = document.getElementById("chatList");
const selectedChatName = document.getElementById("selectedChatName");
const selectedChatSource = document.getElementById("selectedChatSource");
const readOnlyHint = document.getElementById("readOnlyHint");
const cwdInput = document.getElementById("cwdInput");
const modeSelect = document.getElementById("modeSelect");
const promptInput = document.getElementById("promptInput");
const runBtn = document.getElementById("runBtn");
const cancelBtn = document.getElementById("cancelBtn");
const messagesPanel = document.getElementById("messagesPanel");
const logPanel = document.getElementById("logPanel");
const finalPanel = document.getElementById("finalPanel");
const presetsWrap = document.getElementById("presets");

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

const chats = new Map();
const details = new Map();
const streamCache = new Map();

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
  if (chat.source === "vscode-mirror") {
    return "VS Code mirror (read-only)";
  }
  return "Web app (runnable)";
}

function setStatus(text, online) {
  connectionText.textContent = text;
  connectionDot.classList.toggle("online", online);
  connectionDot.classList.toggle("offline", !online);
}

function showTokenCard(show) {
  authCard.classList.toggle("hidden", !show);
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

function toChatArray() {
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

function setActionState() {
  const chat = getChatSummary(selectedChatId);
  const isRunning = chat && chat.status === "running";
  const isReadOnly = Boolean(chat && chat.readOnly);
  runBtn.disabled = !authed || !selectedChatId || Boolean(isRunning) || isReadOnly;
  cancelBtn.disabled = !authed || !selectedChatId || !isRunning || isReadOnly;
  createChatBtn.disabled = !authed;
  refreshMirrorBtn.disabled = !authed;

  cwdInput.disabled = isReadOnly;
  modeSelect.disabled = isReadOnly;
  promptInput.disabled = isReadOnly;
  if (isReadOnly) {
    promptInput.placeholder = "Mirrored VS Code chat (read-only)";
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
  chats.set(summary.id, {
    ...prev,
    ...summary
  });
}

function renderChatList() {
  chatList.innerHTML = "";

  const sorted = toChatArray();
  if (sorted.length === 0) {
    const empty = document.createElement("p");
    empty.className = "chat-empty";
    empty.textContent = "No chats yet.";
    chatList.appendChild(empty);
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
    source.className = "chat-source";
    source.textContent = chat.source === "vscode-mirror" ? "vscode" : "web";

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
      selectChat(chat.id, true);
    });

    chatList.appendChild(btn);
  });
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

function selectChat(chatId, requestDetail) {
  selectedChatId = chatId;
  const chat = getChatSummary(chatId);

  selectedChatName.textContent = chat ? chat.title : "None";
  selectedChatSource.textContent = sourceLabel(chat);
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
  setActionState();

  if (requestDetail && chatId) {
    send({ type: "get_chat", chatId });
  }
}

function applyDetail(detail) {
  details.set(detail.id, {
    ...detail,
    logs: Array.isArray(detail.logs) ? detail.logs.slice() : [],
    messages: Array.isArray(detail.messages) ? detail.messages.slice() : [],
    runs: Array.isArray(detail.runs) ? detail.runs.slice() : []
  });
  mergeSummary(detail);
}

function eventSummary(event) {
  const eventType = event.type || event.method || "unknown";

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
    showTokenCard(requiresToken);
    setStatus(requiresToken ? "Connected (token required)" : "Connected", true);
    setActionState();
    return;
  }

  if (data.type === "auth/ok") {
    authed = true;
    showTokenCard(false);
    setStatus("Authenticated", true);
    setActionState();
    return;
  }

  if (data.type === "auth/error") {
    authed = false;
    showTokenCard(true);
    setStatus("Auth failed", true);
    addLogLine(selectedChatId || "global", `Auth error: ${data.error || "unknown"}`);
    setActionState();
    return;
  }

  if (data.type === "server/error") {
    if (selectedChatId) {
      addLogLine(selectedChatId, `server error: ${data.error || "unknown"}`);
    }
    return;
  }

  if (data.type === "mirror/refreshed") {
    if (selectedChatId) {
      addLogLine(selectedChatId, `mirror refreshed (${data.count || 0} mirrored chats)`);
    }
    return;
  }

  if (data.type === "chats/snapshot") {
    chats.clear();

    const list = Array.isArray(data.chats) ? data.chats : [];
    list.forEach((chat) => {
      mergeSummary(chat);
      ensureChatDetail(chat.id);
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
    renderChatList();

    if (!selectedChatId) {
      selectChat(data.chat.id, true);
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
      readOnlyHint.classList.toggle("hidden", !data.chat.readOnly);
      setActionState();
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
      readOnlyHint.classList.toggle("hidden", !data.chat.readOnly);
      if (data.chat.cwd) {
        cwdInput.value = data.chat.cwd;
      }
      modeSelect.value = data.chat.mode === "workspace-write" ? "workspace-write" : "read-only";
      renderMessages();
      renderLogs();
      renderFinal();
      setActionState();
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
    addLogLine(data.chatId, `start error: ${data.error || "unknown"}`);

    const summary = getChatSummary(data.chatId);
    if (summary) {
      summary.status = "failed";
      summary.currentRunId = null;
      summary.lastError = data.error || "unknown";
      summary.updatedAt = new Date().toISOString();
      chats.set(data.chatId, summary);
    }

    if (selectedChatId === data.chatId) {
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
    showTokenCard(requiresToken);
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
  if (selected && selected.readOnly) {
    addLogLine(selectedChatId, "this is a mirrored VS Code chat (read-only here)");
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
    summary.cwd = cwd;
    summary.mode = mode;
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
  if (selected && selected.readOnly) {
    addLogLine(selectedChatId, "mirrored chats cannot be cancelled from this app");
    return;
  }
  send({ type: "cancel", chatId: selectedChatId });
  addLogLine(selectedChatId, "stop requested...");
});

authBtn.addEventListener("click", () => {
  send({ type: "auth", token: tokenInput.value });
});

createChatBtn.addEventListener("click", () => {
  if (!authed) {
    return;
  }
  send({
    type: "create_chat",
    title: chatTitleInput.value.trim()
  });
  chatTitleInput.value = "";
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

connect();
setInterval(() => {
  send({ type: "ping" });
}, 20000);
