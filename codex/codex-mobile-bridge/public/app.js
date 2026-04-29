const connectionDot = document.getElementById("connectionDot");
const connectionText = document.getElementById("connectionText");
const authCard = document.getElementById("authCard");
const tokenInput = document.getElementById("tokenInput");
const authBtn = document.getElementById("authBtn");
const cwdInput = document.getElementById("cwdInput");
const modeSelect = document.getElementById("modeSelect");
const promptInput = document.getElementById("promptInput");
const runBtn = document.getElementById("runBtn");
const cancelBtn = document.getElementById("cancelBtn");
const logPanel = document.getElementById("logPanel");
const finalPanel = document.getElementById("finalPanel");
const presetsWrap = document.getElementById("presets");

const presets = [
  {
    label: "Repo-Check",
    prompt:
      "Analysiere dieses Repo und gib mir: 1) Architektur, 2) 3 Risiken, 3) konkrete naechste 5 Schritte."
  },
  {
    label: "Fix Tests",
    prompt: "Fuehre Tests aus, behebe Fehler und fasse alle Aenderungen zusammen."
  },
  {
    label: "Review",
    prompt:
      "Mache ein Code-Review mit Fokus auf Bugs und Regressionen. Nenne Findings nach Schweregrad."
  },
  {
    label: "Plan",
    prompt: "Erstelle einen Umsetzungsplan fuer dieses Feature mit Risiken und Aufwandsschaetzung."
  }
];

let ws;
let requiresToken = false;
let authed = false;
let running = false;
let liveAnswer = "";
let lastRunId = null;

function setStatus(text, online) {
  connectionText.textContent = text;
  connectionDot.classList.toggle("online", online);
  connectionDot.classList.toggle("offline", !online);
}

function log(line) {
  const stamp = new Date().toLocaleTimeString();
  logPanel.textContent += `[${stamp}] ${line}\n`;
  logPanel.scrollTop = logPanel.scrollHeight;
}

function setRunState(active) {
  running = active;
  runBtn.disabled = active || !authed;
  cancelBtn.disabled = !active;
}

function showTokenCard(show) {
  authCard.classList.toggle("hidden", !show);
}

function send(msg) {
  if (!ws || ws.readyState !== 1) {
    log("Keine aktive Verbindung zum Server.");
    return;
  }
  ws.send(JSON.stringify(msg));
}

function extractEventSummary(event) {
  const eType = event.type || event.method || "unknown";

  if (eType === "item/agentMessage/delta") {
    const delta = event.params?.delta || "";
    liveAnswer += delta;
    finalPanel.textContent = liveAnswer;
    return `assistant(delta): ${delta}`;
  }

  if (eType === "item.completed") {
    const item = event.item;
    if (item?.type === "agent_message" && typeof item.text === "string") {
      liveAnswer = item.text;
      finalPanel.textContent = liveAnswer;
      return "assistant: complete message";
    }
    if (item?.type === "command_execution") {
      return `cmd: ${item.command || "(command)"}`;
    }
  }

  if (eType === "item/completed") {
    const item = event.params?.item;
    if (item?.type === "agentMessage" && typeof item.text === "string") {
      liveAnswer = item.text;
      finalPanel.textContent = liveAnswer;
      return "assistant: complete message";
    }
    if (item?.type === "commandExecution") {
      return `cmd: ${item.command || "(command)"}`;
    }
  }

  if (eType === "turn.completed" || eType === "turn/completed") {
    return "turn completed";
  }

  if (eType === "turn.failed" || eType === "turn/failed") {
    return "turn failed";
  }

  return eType;
}

function handleServerMessage(data) {
  if (data.type === "hello") {
    requiresToken = Boolean(data.requiresToken);
    authed = !requiresToken;
    cwdInput.value = data.defaultCwd || "";
    showTokenCard(requiresToken);
    setRunState(false);
    setStatus(requiresToken ? "Verbunden (Token noetig)" : "Verbunden", true);
    log("Server verbunden.");
    return;
  }

  if (data.type === "auth/ok") {
    authed = true;
    setRunState(false);
    showTokenCard(false);
    setStatus("Authentifiziert", true);
    log("Token akzeptiert.");
    return;
  }

  if (data.type === "auth/error") {
    authed = false;
    setRunState(false);
    showTokenCard(true);
    setStatus("Token fehlgeschlagen", true);
    log(`Auth-Fehler: ${data.error || "unbekannt"}`);
    return;
  }

  if (data.type === "server/error") {
    log(`Server-Fehler: ${data.error || "unbekannt"}`);
    return;
  }

  if (data.type === "run/accepted") {
    lastRunId = data.runId || null;
    liveAnswer = "";
    finalPanel.textContent = "";
    setRunState(true);
    log(`Run gestartet (${data.mode}) in ${data.cwd}`);
    log(`$ ${data.command}`);
    return;
  }

  if (data.type === "run/event") {
    const summary = extractEventSummary(data.event || {});
    log(summary);
    return;
  }

  if (data.type === "run/raw") {
    log(`raw: ${data.line || ""}`);
    return;
  }

  if (data.type === "run/stderr") {
    log(`stderr: ${data.line || ""}`);
    return;
  }

  if (data.type === "run/completed") {
    setRunState(false);
    if (!liveAnswer && data.finalText) {
      finalPanel.textContent = data.finalText;
    }
    log(`Run beendet (exit ${data.exitCode}).`);
    return;
  }

  if (data.type === "run/failed") {
    setRunState(false);
    if (!liveAnswer && data.finalText) {
      finalPanel.textContent = data.finalText;
    }
    log(`Run fehlgeschlagen (exit ${data.exitCode}, signal ${data.signal || "none"}).`);
    return;
  }

  if (data.type === "run/error") {
    setRunState(false);
    log(`Startfehler: ${data.error || "unknown"}`);
    return;
  }

  if (data.type === "pong") {
    return;
  }

  log(`Unbekannte Nachricht: ${JSON.stringify(data)}`);
}

function connect() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${protocol}://${window.location.host}/ws`);

  ws.addEventListener("open", () => {
    setStatus("Verbunden", true);
    log("Socket offen.");
  });

  ws.addEventListener("message", (evt) => {
    try {
      const data = JSON.parse(evt.data);
      handleServerMessage(data);
    } catch {
      log(`Ungueltige Serverantwort: ${evt.data}`);
    }
  });

  ws.addEventListener("close", () => {
    setStatus("Verbindung getrennt", false);
    setRunState(false);
    authed = false;
    showTokenCard(requiresToken);
    log("Socket geschlossen. Reconnect in 2s...");
    setTimeout(connect, 2000);
  });

  ws.addEventListener("error", () => {
    setStatus("Verbindungsfehler", false);
  });
}

runBtn.addEventListener("click", () => {
  const prompt = promptInput.value.trim();
  const cwd = cwdInput.value.trim();
  const mode = modeSelect.value;

  if (!prompt) {
    log("Bitte Prompt eingeben.");
    return;
  }

  if (!authed) {
    log("Nicht authentifiziert.");
    return;
  }

  send({ type: "run", prompt, cwd, mode });
});

cancelBtn.addEventListener("click", () => {
  if (!running) {
    return;
  }
  send({ type: "cancel", runId: lastRunId });
  log("Stop angefordert...");
});

authBtn.addEventListener("click", () => {
  const token = tokenInput.value;
  send({ type: "auth", token });
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
