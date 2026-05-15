const storageKey = "redis-memory-chatbot-config-v1";

const state = {
  config: {
    apiBaseUrl: "",
    storeId: "",
    apiKey: "",
    ownerId: "demo-user",
    actorId: "web-chat",
    namespace: "memory-chatbot",
    similarityThreshold: 0.7,
    limit: 8,
  },
  sessions: [],
  activeSessionId: "",
  messages: [],
  operations: [],
  selectedMemoryId: "",
  memoryResults: [],
  isSending: false,
};

const el = {
  apiBaseUrl: document.querySelector("#api-base-url"),
  storeId: document.querySelector("#store-id"),
  apiKey: document.querySelector("#api-key"),
  ownerId: document.querySelector("#owner-id"),
  actorId: document.querySelector("#actor-id"),
  namespace: document.querySelector("#namespace"),
  similarityThreshold: document.querySelector("#similarity-threshold"),
  memoryLimit: document.querySelector("#memory-limit"),
  refreshSessionsButton: document.querySelector("#refresh-sessions-button"),
  sessionSelect: document.querySelector("#session-select"),
  newSessionButton: document.querySelector("#new-session-button"),
  deleteSessionButton: document.querySelector("#delete-session-button"),
  composerForm: document.querySelector("#composer-form"),
  messageInput: document.querySelector("#message-input"),
  sendButton: document.querySelector("#send-button"),
  composerStatus: document.querySelector("#composer-status"),
  messages: document.querySelector("#messages"),
  activeSessionLabel: document.querySelector("#active-session-label"),
  memoryApiStatus: document.querySelector("#memory-api-status"),
  openAiStatus: document.querySelector("#openai-status"),
  memorySearchInput: document.querySelector("#memory-search-input"),
  memorySearchButton: document.querySelector("#memory-search-button"),
  memoryResults: document.querySelector("#memory-results"),
  memoryEditorTitle: document.querySelector("#memory-editor-title"),
  memoryIdInput: document.querySelector("#memory-id-input"),
  memoryTextInput: document.querySelector("#memory-text-input"),
  memoryTypeInput: document.querySelector("#memory-type-input"),
  memoryTopicsInput: document.querySelector("#memory-topics-input"),
  memoryCreateButton: document.querySelector("#memory-create-button"),
  memoryUpdateButton: document.querySelector("#memory-update-button"),
  memoryDeleteButton: document.querySelector("#memory-delete-button"),
  memoryResetButton: document.querySelector("#memory-reset-button"),
  operations: document.querySelector("#operations"),
  clearOperationsButton: document.querySelector("#clear-operations-button"),
  messageTemplate: document.querySelector("#message-template"),
  operationTemplate: document.querySelector("#operation-template"),
};

function nowLabel() {
  return new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
}

function createId(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function scrubSecrets(payload) {
  if (payload == null) return payload;
  if (Array.isArray(payload)) return payload.map(scrubSecrets);
  if (typeof payload === "object") {
    return Object.fromEntries(
      Object.entries(payload).map(([key, value]) => {
        if (["apiKey", "authorization"].includes(key)) return [key, "***"];
        return [key, scrubSecrets(value)];
      }),
    );
  }
  return payload;
}

function saveConfig() {
  const persistentConfig = { ...state.config, apiKey: "" };
  localStorage.setItem(storageKey, JSON.stringify(persistentConfig));
}

function loadSavedConfig() {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return;
    state.config = { ...state.config, ...JSON.parse(raw) };
  } catch {
    localStorage.removeItem(storageKey);
  }
}

function updateConfigFromInputs() {
  state.config = {
    apiBaseUrl: el.apiBaseUrl.value.trim(),
    storeId: el.storeId.value.trim(),
    apiKey: el.apiKey.value.trim(),
    ownerId: el.ownerId.value.trim(),
    actorId: el.actorId.value.trim(),
    namespace: el.namespace.value.trim(),
    similarityThreshold: Number(el.similarityThreshold.value || 0.7),
    limit: Number(el.memoryLimit.value || 8),
  };
  saveConfig();
  renderStatus();
}

function populateConfigInputs() {
  el.apiBaseUrl.value = state.config.apiBaseUrl || "";
  el.storeId.value = state.config.storeId || "";
  el.apiKey.value = state.config.apiKey || "";
  el.ownerId.value = state.config.ownerId || "";
  el.actorId.value = state.config.actorId || "";
  el.namespace.value = state.config.namespace || "";
  el.similarityThreshold.value = String(state.config.similarityThreshold ?? 0.7);
  el.memoryLimit.value = String(state.config.limit ?? 8);
}

function currentConfig() {
  return {
    apiBaseUrl: el.apiBaseUrl.value.trim(),
    storeId: el.storeId.value.trim(),
    apiKey: el.apiKey.value.trim(),
    ownerId: el.ownerId.value.trim(),
    actorId: el.actorId.value.trim(),
    namespace: el.namespace.value.trim(),
    similarityThreshold: Number(el.similarityThreshold.value || 0.7),
    limit: Number(el.memoryLimit.value || 8),
  };
}

function isConfigReady() {
  const config = currentConfig();
  return Boolean(config.apiBaseUrl && config.storeId && (config.apiKey || state.serverConfig?.memoryApiConfigured));
}

function addOperation(operation) {
  state.operations.unshift(operation);
  renderOperations();
}

function startOperation({ label, service, method, url, requestBody }) {
  const operation = {
    id: createId("op"),
    label,
    service,
    method,
    url,
    requestBody: scrubSecrets(requestBody),
    responseBody: null,
    startedAtLabel: nowLabel(),
    durationMs: null,
    statusCode: null,
    status: "running",
  };
  addOperation(operation);
  return operation.id;
}

function completeOperation(id, patch) {
  const operation = state.operations.find((item) => item.id === id);
  if (!operation) return;
  Object.assign(operation, {
    responseBody: scrubSecrets(patch.responseBody ?? operation.responseBody),
    durationMs: patch.durationMs ?? operation.durationMs,
    statusCode: patch.statusCode ?? operation.statusCode,
    status: patch.status ?? operation.status,
  });
  renderOperations();
}

function upsertStreamOperation(operation) {
  const existing = state.operations.find((item) => item.id === operation.id);
  if (existing) {
    Object.assign(existing, {
      ...operation,
      requestBody: scrubSecrets(operation.requestBody),
      responseBody: scrubSecrets(operation.responseBody),
    });
    renderOperations();
    return;
  }

  addOperation({
    ...operation,
    startedAtLabel: nowLabel(),
    requestBody: scrubSecrets(operation.requestBody),
    responseBody: scrubSecrets(operation.responseBody),
  });
}

function renderStatus() {
  el.activeSessionLabel.textContent = state.activeSessionId || "Not started";
  el.sendButton.disabled = state.isSending;
  el.messageInput.disabled = state.isSending;
  el.composerStatus.textContent = state.isSending ? "Streaming response and logging API activity…" : "Ready.";
}

function formatJson(value) {
  if (value == null) return "None";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

function renderMessages() {
  el.messages.innerHTML = "";

  if (!state.messages.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Start a new session or pick an existing one to load its session memory.";
    el.messages.append(empty);
    return;
  }

  for (const message of state.messages) {
    const fragment = el.messageTemplate.content.cloneNode(true);
    const article = fragment.querySelector(".message");
    const meta = fragment.querySelector(".message-meta");
    const bubble = fragment.querySelector(".message-bubble");
    article.classList.add(message.role);
    meta.textContent = `${message.role === "user" ? "User" : "Assistant"} • ${message.timeLabel}`;
    bubble.textContent = message.content || (message.role === "assistant" ? "Working…" : "");
    el.messages.append(fragment);
  }

  el.messages.scrollTop = el.messages.scrollHeight;
}

function renderSessionOptions() {
  el.sessionSelect.innerHTML = "";

  const draft = document.createElement("option");
  draft.value = "";
  draft.textContent = "Select a stored session";
  el.sessionSelect.append(draft);

  for (const sessionId of state.sessions) {
    const option = document.createElement("option");
    option.value = sessionId;
    option.textContent = sessionId;
    option.selected = sessionId === state.activeSessionId;
    el.sessionSelect.append(option);
  }
}

function renderMemoryResults() {
  el.memoryResults.innerHTML = "";
  if (!state.memoryResults.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Search results will appear here.";
    el.memoryResults.append(empty);
    return;
  }

  for (const memory of state.memoryResults) {
    const card = document.createElement("article");
    card.className = "memory-result";

    const topics = Array.isArray(memory.topics) ? memory.topics.join(", ") : "";

    card.innerHTML = `
      <div class="memory-result-head">
        <span class="memory-result-id">${memory.id || "memory"}</span>
        <span class="memory-result-type">${memory.memoryType || "memory"}</span>
      </div>
      <p class="memory-result-text">${memory.text || ""}</p>
      <div class="memory-result-meta">
        <span class="memory-result-topics">${topics || "No topics"}</span>
        <button class="secondary-button" type="button">Open</button>
      </div>
    `;

    card.querySelector("button").addEventListener("click", () => {
      void openMemory(memory.id);
    });

    el.memoryResults.append(card);
  }
}

function renderOperations() {
  el.operations.innerHTML = "";

  if (!state.operations.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Operations will stream here as the app talks to Redis memory and OpenAI.";
    el.operations.append(empty);
    return;
  }

  for (const operation of state.operations) {
    const fragment = el.operationTemplate.content.cloneNode(true);
    fragment.querySelector(".operation-service").textContent = operation.service;
    fragment.querySelector(".operation-label").textContent = operation.label;
    fragment.querySelector(".operation-route").textContent = `${operation.method} ${operation.url}`;
    const status = fragment.querySelector(".operation-status");
    status.textContent = operation.statusCode ? `${operation.status} • ${operation.statusCode}` : operation.status;
    status.className = `operation-status ${operation.status}`;
    fragment.querySelector(".operation-duration").textContent = operation.durationMs ? `${operation.durationMs}ms` : operation.startedAtLabel;
    fragment.querySelector(".operation-request").textContent = formatJson(operation.requestBody);
    fragment.querySelector(".operation-response").textContent = formatJson(operation.responseBody);
    el.operations.append(fragment);
  }
}

function buildProxyUrl(path) {
  const config = currentConfig();
  return `${config.apiBaseUrl.replace(/\/$/, "")}${path.replace("{storeId}", config.storeId)}`;
}

async function postJson(path, body, operationMeta) {
  const opId = startOperation({
    ...operationMeta,
    requestBody: body,
  });
  const started = performance.now();
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = response.status === 204 ? null : await response.json();
    const durationMs = Math.round(performance.now() - started);
    completeOperation(opId, {
      responseBody: data,
      durationMs,
      statusCode: response.status,
      status: response.ok ? "success" : "error",
    });
    if (!response.ok) {
      throw new Error(data?.detail ? formatJson(data.detail) : `Request failed with ${response.status}`);
    }
    return data;
  } catch (error) {
    const durationMs = Math.round(performance.now() - started);
    completeOperation(opId, {
      responseBody: { error: error.message },
      durationMs,
      statusCode: 500,
      status: "error",
    });
    throw error;
  }
}

function setMessagesFromSession(events) {
  state.messages = events.map((event) => ({
    id: event.eventId || createId("msg"),
    role: String(event.role || "ASSISTANT").toLowerCase() === "user" ? "user" : "assistant",
    content: event.text || "",
    timeLabel: event.createdAt ? new Date(event.createdAt).toLocaleString() : nowLabel(),
  }));
  renderMessages();
}

async function refreshSessions() {
  updateConfigFromInputs();
  if (!currentConfig().apiBaseUrl || !currentConfig().storeId) {
    state.sessions = [];
    renderSessionOptions();
    return;
  }

  const data = await postJson(
    "/api/sessions/list",
    { config: currentConfig() },
    {
      label: "List sessions",
      service: "Redis Memory",
      method: "GET",
      url: buildProxyUrl("/v1/stores/{storeId}/session-memory"),
    },
  );
  state.sessions = data.sessions || [];
  if (!state.activeSessionId && state.sessions.length) {
    state.activeSessionId = state.sessions[0];
    await loadSession(state.activeSessionId);
  }
  renderSessionOptions();
  renderStatus();
}

async function loadSession(sessionId) {
  if (!sessionId) return;
  state.activeSessionId = sessionId;
  renderStatus();
  const data = await postJson(
    "/api/sessions/get",
    { config: currentConfig(), sessionId },
    {
      label: "Load session memory",
      service: "Redis Memory",
      method: "GET",
      url: buildProxyUrl(`/v1/stores/{storeId}/session-memory/${sessionId}`),
    },
  );
  setMessagesFromSession(data.events || []);
  renderSessionOptions();
}

function resetMemoryEditor() {
  state.selectedMemoryId = "";
  el.memoryEditorTitle.textContent = "Create memory";
  el.memoryIdInput.value = "";
  el.memoryTextInput.value = "";
  el.memoryTypeInput.value = "semantic";
  el.memoryTopicsInput.value = "";
}

async function searchMemories(query) {
  const text = (query || el.memorySearchInput.value).trim();
  if (!text) return;
  const data = await postJson(
    "/api/memories/search",
    { config: currentConfig(), text },
    {
      label: "Search long-term memory",
      service: "Redis Memory",
      method: "POST",
      url: buildProxyUrl("/v1/stores/{storeId}/long-term-memory/search"),
    },
  );
  state.memoryResults = data.items || data.memories || [];
  renderMemoryResults();
}

async function openMemory(memoryId) {
  if (!memoryId) return;
  const data = await postJson(
    "/api/memories/get",
    { config: currentConfig(), memoryId },
    {
      label: "Get long-term memory",
      service: "Redis Memory",
      method: "GET",
      url: buildProxyUrl(`/v1/stores/{storeId}/long-term-memory/${memoryId}`),
    },
  );

  state.selectedMemoryId = data.id;
  el.memoryEditorTitle.textContent = `Editing ${data.id}`;
  el.memoryIdInput.value = data.id || "";
  el.memoryTextInput.value = data.text || "";
  el.memoryTypeInput.value = data.memoryType || "semantic";
  el.memoryTopicsInput.value = Array.isArray(data.topics) ? data.topics.join(", ") : "";
}

function parsedTopics() {
  return el.memoryTopicsInput.value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function createMemory() {
  const text = el.memoryTextInput.value.trim();
  if (!text) return;

  const memory = {
    id: el.memoryIdInput.value.trim() || undefined,
    text,
    memoryType: el.memoryTypeInput.value,
    ownerId: currentConfig().ownerId,
    sessionId: state.activeSessionId || undefined,
    namespace: currentConfig().namespace,
    topics: parsedTopics(),
  };

  const data = await postJson(
    "/api/memories/create",
    { config: currentConfig(), memories: [memory] },
    {
      label: "Create long-term memory",
      service: "Redis Memory",
      method: "POST",
      url: buildProxyUrl("/v1/stores/{storeId}/long-term-memory"),
    },
  );

  const createdId = data.created?.[0];
  if (createdId) {
    state.selectedMemoryId = createdId;
    el.memoryIdInput.value = createdId;
  }
  await searchMemories(memory.text);
}

async function updateMemory() {
  const memoryId = state.selectedMemoryId || el.memoryIdInput.value.trim();
  if (!memoryId) return;

  await postJson(
    "/api/memories/update",
    {
      config: currentConfig(),
      memoryId,
      text: el.memoryTextInput.value.trim(),
      topics: parsedTopics(),
      namespace: currentConfig().namespace,
    },
    {
      label: "Update long-term memory",
      service: "Redis Memory",
      method: "PATCH",
      url: buildProxyUrl(`/v1/stores/{storeId}/long-term-memory/${memoryId}`),
    },
  );

  await openMemory(memoryId);
  await searchMemories(el.memoryTextInput.value.trim());
}

async function deleteMemory() {
  const memoryId = state.selectedMemoryId || el.memoryIdInput.value.trim();
  if (!memoryId) return;

  await postJson(
    "/api/memories/delete",
    { config: currentConfig(), memoryIds: [memoryId] },
    {
      label: "Delete long-term memory",
      service: "Redis Memory",
      method: "DELETE",
      url: buildProxyUrl("/v1/stores/{storeId}/long-term-memory"),
    },
  );

  state.memoryResults = state.memoryResults.filter((item) => item.id !== memoryId);
  renderMemoryResults();
  resetMemoryEditor();
}

function createSession() {
  state.activeSessionId = crypto.randomUUID();
  state.messages = [];
  renderMessages();
  renderSessionOptions();
  renderStatus();
}

async function deleteCurrentSession() {
  if (!state.activeSessionId) return;
  await postJson(
    "/api/sessions/delete",
    { config: currentConfig(), sessionId: state.activeSessionId },
    {
      label: "Delete session memory",
      service: "Redis Memory",
      method: "DELETE",
      url: buildProxyUrl(`/v1/stores/{storeId}/session-memory/${state.activeSessionId}`),
    },
  );

  state.sessions = state.sessions.filter((item) => item !== state.activeSessionId);
  createSession();
  renderSessionOptions();
}

function appendMessage(role, content = "") {
  const message = {
    id: createId(role),
    role,
    content,
    timeLabel: nowLabel(),
  };
  state.messages.push(message);
  renderMessages();
  return message.id;
}

function updateMessage(messageId, patch) {
  const message = state.messages.find((item) => item.id === messageId);
  if (!message) return;
  Object.assign(message, patch);
  renderMessages();
}

async function sendMessage(text) {
  if (!text.trim() || state.isSending) return;
  updateConfigFromInputs();
  if (!isConfigReady()) {
    alert("Set the Redis memory API base URL, store ID, and API key before sending a message.");
    return;
  }

  if (!state.activeSessionId) {
    createSession();
  }

  state.isSending = true;
  renderStatus();

  const userMessage = text.trim();
  el.messageInput.value = "";
  appendMessage("user", userMessage);
  const assistantId = appendMessage("assistant", "");

  const chatOperationId = startOperation({
    label: "Chat stream",
    service: "App API",
    method: "POST",
    url: "/api/chat/stream",
    requestBody: {
      sessionId: state.activeSessionId,
      message: userMessage,
      config: currentConfig(),
    },
  });
  const started = performance.now();

  try {
    const response = await fetch("/api/chat/stream", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: state.activeSessionId,
        message: userMessage,
        config: currentConfig(),
        metadata: { source: "browser-ui" },
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Chat stream failed with ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";

      for (const part of parts) {
        if (!part.startsWith("data: ")) continue;
        const event = JSON.parse(part.slice(6));

        switch (event.type) {
          case "operation-start":
          case "operation-complete":
            upsertStreamOperation(event.operation);
            break;
          case "text-delta":
            updateMessage(assistantId, {
              content: `${state.messages.find((item) => item.id === assistantId)?.content || ""}${event.delta || ""}`,
            });
            break;
          case "error":
            updateMessage(assistantId, { content: event.message || "Request failed." });
            break;
          case "done":
            state.activeSessionId = event.sessionId || state.activeSessionId;
            break;
          default:
            break;
        }
      }
    }

    completeOperation(chatOperationId, {
      responseBody: { sessionId: state.activeSessionId },
      durationMs: Math.round(performance.now() - started),
      statusCode: 200,
      status: "success",
    });
  } catch (error) {
    updateMessage(assistantId, { content: `Error: ${error.message}` });
    completeOperation(chatOperationId, {
      responseBody: { error: error.message },
      durationMs: Math.round(performance.now() - started),
      statusCode: 500,
      status: "error",
    });
  } finally {
    state.isSending = false;
    renderStatus();
    await refreshSessions();
  }
}

async function bootstrap() {
  loadSavedConfig();
  populateConfigInputs();

  const configResponse = await fetch("/api/config");
  const configPayload = await configResponse.json();
  state.serverConfig = configPayload.status;

  state.config = {
    ...state.config,
    ...configPayload.defaults,
    apiKey: "",
  };
  populateConfigInputs();
  renderStatus();

  el.memoryApiStatus.textContent = configPayload.status.memoryApiConfigured ? "Configured from env" : "Needs base URL, store ID, and key";
  el.openAiStatus.textContent = configPayload.status.openAiConfigured ? `Configured (${configPayload.status.model})` : "Missing OPENAI_API_KEY";

  if (currentConfig().apiBaseUrl && currentConfig().storeId) {
    try {
      await refreshSessions();
    } catch (error) {
      addOperation({
        id: createId("op"),
        label: "Initial session refresh",
        service: "App API",
        method: "POST",
        url: "/api/sessions/list",
        requestBody: { config: currentConfig() },
        responseBody: { error: error.message },
        startedAtLabel: nowLabel(),
        durationMs: null,
        statusCode: 500,
        status: "error",
      });
    }
  } else {
    createSession();
  }
}

el.refreshSessionsButton.addEventListener("click", () => {
  void refreshSessions();
});

for (const input of [
  el.apiBaseUrl,
  el.storeId,
  el.apiKey,
  el.ownerId,
  el.actorId,
  el.namespace,
  el.similarityThreshold,
  el.memoryLimit,
]) {
  input.addEventListener("change", updateConfigFromInputs);
}

el.sessionSelect.addEventListener("change", () => {
  if (el.sessionSelect.value) {
    void loadSession(el.sessionSelect.value);
  }
});

el.newSessionButton.addEventListener("click", createSession);
el.deleteSessionButton.addEventListener("click", () => {
  void deleteCurrentSession();
});

el.composerForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void sendMessage(el.messageInput.value);
});

el.messageInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    void sendMessage(el.messageInput.value);
  }
});

el.memorySearchButton.addEventListener("click", () => {
  void searchMemories(el.memorySearchInput.value);
});

el.memoryCreateButton.addEventListener("click", () => {
  void createMemory();
});

el.memoryUpdateButton.addEventListener("click", () => {
  void updateMemory();
});

el.memoryDeleteButton.addEventListener("click", () => {
  void deleteMemory();
});

el.memoryResetButton.addEventListener("click", resetMemoryEditor);

el.clearOperationsButton.addEventListener("click", () => {
  state.operations = [];
  renderOperations();
});

resetMemoryEditor();
renderMessages();
renderMemoryResults();
renderOperations();
bootstrap();
