// ── State ─────────────────────────────────────────────────────────────────────

const sessions = new Map(); // sessionId -> { label, model, modelType, messages, streaming }
let activeSessionId = null;
let availableModels = [];
let connected = false;
let pendingModelChoice = null; // 'claude' | 'ollama:<name>'

// ── DOM refs ──────────────────────────────────────────────────────────────────

const sessionTabsEl   = document.getElementById('session-tabs');
const newSessionBtn   = document.getElementById('new-session-btn');
const connectingEl    = document.getElementById('connecting');
const mainContentEl   = document.getElementById('main-content');
const noSessionEl     = document.getElementById('no-session');
const chatViewEl      = document.getElementById('chat-view');
const messagesEl      = document.getElementById('messages');
const chatInput       = document.getElementById('chat-input');
const sendBtn         = document.getElementById('send-btn');
const statusDot       = document.getElementById('status-dot');
const statusText      = document.getElementById('status-text');
const toggleViewBtn   = document.getElementById('toggle-view');

const modal           = document.getElementById('modal');
const chooseClaude    = document.getElementById('choose-claude');
const chooseOllama    = document.getElementById('choose-ollama');
const ollamaPicker    = document.getElementById('ollama-picker');
const modelSelect     = document.getElementById('model-select');
const modalCancel     = document.getElementById('modal-cancel');
const modalStart      = document.getElementById('modal-start');

// ── Server message handling ───────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.source !== 'server') return;
  handleServerMessage(msg.data);
});

function handleServerMessage(data) {
  switch (data.type) {
    case 'models':
      availableModels = data.models || [];
      break;

    case 'session_ready':
      onSessionReady(data.sessionId);
      break;

    case 'stream_chunk':
      appendChunk(data.sessionId, data.text);
      break;

    case 'stream_end':
      finaliseStream(data.sessionId);
      break;

    case 'error':
      showError(data.sessionId, data.message);
      break;
  }
}

// ── Connection bootstrap ──────────────────────────────────────────────────────

function setConnected(state) {
  connected = state;
  connectingEl.hidden = state;
  mainContentEl.style.display = state ? 'flex' : 'none';
  statusDot.className = 'status-dot' + (state ? ' connected' : '');
  statusText.textContent = state ? 'Connected' : 'Disconnected';

  if (state) {
    sendToServer({ type: 'get_models' });
  }
}

// Poll until background says we're connected
function waitForConnection() {
  chrome.runtime.sendMessage({ source: 'extension', data: { type: 'ping' } }, (res) => {
    if (chrome.runtime.lastError || !res?.ok) {
      setTimeout(waitForConnection, 600);
    } else {
      setConnected(true);
      refreshView();
    }
  });
}

// ── Send helper ───────────────────────────────────────────────────────────────

function sendToServer(data) {
  chrome.runtime.sendMessage({ source: 'extension', data });
}

// ── Session management ────────────────────────────────────────────────────────

function createSession(model) {
  const sessionId = crypto.randomUUID();
  const modelType = model === 'claude' ? 'claude' : 'ollama';
  const modelLabel = model === 'claude' ? 'Claude' : model.replace('ollama:', '');

  sessions.set(sessionId, {
    label: 'New chat',
    model,
    modelType,
    modelLabel,
    messages: [],
    streaming: false,
    streamingMsgId: null,
  });

  sendToServer({ type: 'new_session', sessionId, model });
  renderSessionTabs();
  switchSession(sessionId);
  return sessionId;
}

function switchSession(sessionId) {
  activeSessionId = sessionId;
  renderSessionTabs();
  renderMessages();
  updateInputState();
  statusText.textContent = activeSession()
    ? `${activeSession().modelLabel} · ${activeSession().label}`
    : 'Connected';
}

function closeSession(sessionId) {
  sendToServer({ type: 'close_session', sessionId });
  sessions.delete(sessionId);

  if (activeSessionId === sessionId) {
    activeSessionId = sessions.size > 0 ? [...sessions.keys()].at(-1) : null;
  }

  renderSessionTabs();
  refreshView();
}

function activeSession() {
  return activeSessionId ? sessions.get(activeSessionId) : null;
}

// ── Session ready (server confirmed) ─────────────────────────────────────────

function onSessionReady(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (activeSessionId === sessionId) updateInputState();
}

// ── Messaging ─────────────────────────────────────────────────────────────────

function sendMessage() {
  const text = chatInput.value.trim();
  if (!text || !activeSessionId) return;

  const session = sessions.get(activeSessionId);
  if (!session || session.streaming) return;

  chatInput.value = '';
  resizeInput();

  // Update session label from first message
  if (session.messages.length === 0) {
    session.label = text.slice(0, 32) + (text.length > 32 ? '…' : '');
    renderSessionTabs();
  }

  appendMessage(activeSessionId, 'user', text);
  session.streaming = true;
  updateInputState();

  // Add empty assistant bubble for streaming into
  const msgId = appendMessage(activeSessionId, 'assistant', '');
  session.streamingMsgId = msgId;

  sendToServer({ type: 'chat', sessionId: activeSessionId, content: text });
}

// ── Message rendering ─────────────────────────────────────────────────────────

function appendMessage(sessionId, role, text) {
  const session = sessions.get(sessionId);
  if (!session) return null;

  const msgId = crypto.randomUUID();
  session.messages.push({ id: msgId, role, text });

  if (sessionId === activeSessionId) {
    renderMessage({ id: msgId, role, text }, true);
  }

  return msgId;
}

function appendChunk(sessionId, text) {
  const session = sessions.get(sessionId);
  if (!session || !session.streamingMsgId) return;

  const msg = session.messages.find((m) => m.id === session.streamingMsgId);
  if (msg) msg.text += text;

  if (sessionId === activeSessionId) {
    const el = document.getElementById(`msg-${session.streamingMsgId}`);
    if (el) {
      // Remove cursor, append text, re-add cursor
      const cursor = el.querySelector('.cursor');
      if (cursor) cursor.remove();
      el.appendChild(document.createTextNode(text));
      el.appendChild(makeCursor());
      scrollToBottom();
    }
  }
}

function finaliseStream(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;

  session.streaming = false;

  if (sessionId === activeSessionId) {
    const msgId = session.streamingMsgId;
    if (msgId) {
      const el = document.getElementById(`msg-${msgId}`);
      el?.querySelector('.cursor')?.remove();
    }
    updateInputState();
    scrollToBottom();
  }

  session.streamingMsgId = null;
}

function showError(sessionId, message) {
  finaliseStream(sessionId);
  const session = sessions.get(sessionId);
  if (!session) return;

  // Replace the empty streaming bubble with an error note
  if (session.streamingMsgId) {
    const msg = session.messages.find((m) => m.id === session.streamingMsgId);
    if (msg) msg.text = `⚠ ${message}`;
    if (sessionId === activeSessionId) {
      const el = document.getElementById(`msg-${session.streamingMsgId}`);
      if (el) {
        el.querySelector('.cursor')?.remove();
        el.textContent = `⚠ ${message}`;
        el.style.color = '#ef4444';
      }
    }
  }
}

function renderMessage(msg, append = false) {
  const row = document.createElement('div');
  row.className = `message ${msg.role}`;

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.id = `msg-${msg.id}`;

  if (msg.role === 'assistant' && !msg.text) {
    bubble.appendChild(makeCursor());
  } else {
    bubble.appendChild(document.createTextNode(msg.text));
    if (msg.role === 'assistant') {
      // Basic code block rendering
      bubble.innerHTML = formatMessage(msg.text);
    }
  }

  row.appendChild(bubble);

  if (append) {
    messagesEl.appendChild(row);
    scrollToBottom();
  } else {
    messagesEl.appendChild(row);
  }
}

function formatMessage(text) {
  // Escape HTML, then render code fences
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  return escaped
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

function makeCursor() {
  const c = document.createElement('span');
  c.className = 'cursor';
  return c;
}

function renderMessages() {
  messagesEl.innerHTML = '';
  const session = activeSession();
  if (!session) return;

  for (const msg of session.messages) {
    renderMessage(msg);
  }

  // Re-add cursor to streaming message if applicable
  if (session.streaming && session.streamingMsgId) {
    const el = document.getElementById(`msg-${session.streamingMsgId}`);
    if (el && !el.querySelector('.cursor')) el.appendChild(makeCursor());
  }

  scrollToBottom();
}

function scrollToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

// ── Session tabs rendering ────────────────────────────────────────────────────

function renderSessionTabs() {
  // Remove all existing tab elements (keep the + button)
  Array.from(sessionTabsEl.querySelectorAll('.session-tab')).forEach((el) => el.remove());

  for (const [id, session] of sessions) {
    const tab = document.createElement('div');
    tab.className = 'session-tab' + (id === activeSessionId ? ' active' : '');
    tab.dataset.sessionId = id;

    const label = document.createElement('span');
    label.className = 'session-tab-label';
    label.textContent = session.label;

    const model = document.createElement('span');
    model.className = 'session-tab-model';
    model.textContent = session.modelLabel;

    const close = document.createElement('button');
    close.className = 'session-tab-close';
    close.textContent = '×';
    close.title = 'Close session';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      closeSession(id);
    });

    tab.appendChild(label);
    tab.appendChild(model);
    tab.appendChild(close);
    tab.addEventListener('click', () => switchSession(id));

    // Insert before the + button
    sessionTabsEl.insertBefore(tab, newSessionBtn);
  }
}

// ── View state ────────────────────────────────────────────────────────────────

function refreshView() {
  if (!activeSessionId || !sessions.has(activeSessionId)) {
    noSessionEl.style.display = 'flex';
    chatViewEl.hidden = true;
  } else {
    noSessionEl.style.display = 'none';
    chatViewEl.hidden = false;
    chatViewEl.style.display = 'flex';
    renderMessages();
    updateInputState();
  }
}

function updateInputState() {
  const session = activeSession();
  const ready = !!session && !session.streaming && connected;
  sendBtn.disabled = !ready;
  chatInput.disabled = !ready;
  chatInput.placeholder = session?.streaming ? 'Waiting for response…' : 'Message…';
  if (ready) chatInput.focus();
}

// ── Modal ─────────────────────────────────────────────────────────────────────

function openModal() {
  pendingModelChoice = null;
  chooseClaude.classList.remove('selected');
  chooseOllama.classList.remove('selected');
  ollamaPicker.hidden = true;
  modalStart.disabled = true;
  modal.hidden = false;

  // Refresh model list
  populateModelSelect();
}

function populateModelSelect() {
  modelSelect.innerHTML = '';
  if (availableModels.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = 'No models found — is Ollama running?';
    modelSelect.appendChild(opt);
    return;
  }
  for (const name of availableModels) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    modelSelect.appendChild(opt);
  }
}

chooseClaude.addEventListener('click', () => {
  pendingModelChoice = 'claude';
  chooseClaude.classList.add('selected');
  chooseOllama.classList.remove('selected');
  ollamaPicker.hidden = true;
  modalStart.disabled = false;
});

chooseOllama.addEventListener('click', () => {
  chooseOllama.classList.add('selected');
  chooseClaude.classList.remove('selected');
  ollamaPicker.hidden = false;
  const selected = modelSelect.value;
  pendingModelChoice = selected ? `ollama:${selected}` : null;
  modalStart.disabled = !selected;
});

modelSelect.addEventListener('change', () => {
  pendingModelChoice = modelSelect.value ? `ollama:${modelSelect.value}` : null;
  modalStart.disabled = !modelSelect.value;
});

modalCancel.addEventListener('click', () => { modal.hidden = true; });
modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

modalStart.addEventListener('click', () => {
  if (!pendingModelChoice) return;
  modal.hidden = true;
  createSession(pendingModelChoice);
  refreshView();
});

// ── Input handling ────────────────────────────────────────────────────────────

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

chatInput.addEventListener('input', resizeInput);

function resizeInput() {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 140) + 'px';
}

sendBtn.addEventListener('click', sendMessage);
newSessionBtn.addEventListener('click', openModal);

// ── View toggle (sidebar ↔ popup) ─────────────────────────────────────────────

toggleViewBtn.addEventListener('click', async () => {
  const { viewMode } = await chrome.storage.local.get({ viewMode: 'sidebar' });
  const next = viewMode === 'sidebar' ? 'popup' : 'sidebar';
  await chrome.storage.local.set({ viewMode: next });
  toggleViewBtn.title = next === 'sidebar' ? 'Switch to popup' : 'Switch to sidebar';
});

// ── Init ──────────────────────────────────────────────────────────────────────

(async () => {
  const { viewMode } = await chrome.storage.local.get({ viewMode: 'sidebar' });
  toggleViewBtn.title = viewMode === 'sidebar' ? 'Switch to popup' : 'Switch to sidebar';

  setConnected(false);
  waitForConnection();
})();
