const WS_URL = 'ws://localhost:3457';
const NATIVE_HOST = 'com.augmentis.browsky';

let ws = null;
let launching = false;

// Cache viewMode so icon click handler has no async work before sidePanel.open()
let cachedViewMode = 'sidebar';
chrome.storage.local.get({ viewMode: 'sidebar' }).then(({ viewMode }) => {
  cachedViewMode = viewMode;
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.viewMode) cachedViewMode = changes.viewMode.newValue;
});

// ── Icon click ────────────────────────────────────────────────────────────────

chrome.action.onClicked.addListener((tab) => {
  // sidePanel.open() MUST be called synchronously in the click handler —
  // any await before it breaks the user gesture context.
  if (cachedViewMode === 'sidebar') {
    chrome.sidePanel.open({ windowId: tab.windowId });
  } else {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 440,
      height: 720,
      focused: true,
    });
  }

  // Start server in background — non-blocking
  ensureConnection();
});

// ── WebSocket management ──────────────────────────────────────────────────────

async function ensureConnection() {
  if (ws && ws.readyState === WebSocket.OPEN) return;

  // Try connecting — server may already be running from a previous session
  const connected = await tryConnect();
  if (connected) return;

  // Launch server via native messaging, then retry
  if (!launching) {
    launching = true;
    try {
      await launchServer();
    } finally {
      launching = false;
    }
  }

  await new Promise((r) => setTimeout(r, 300));
  await tryConnect();
}

function tryConnect() {
  return new Promise((resolve) => {
    const socket = new WebSocket(WS_URL);
    const timer = setTimeout(() => { socket.close(); resolve(false); }, 2000);

    socket.onopen = () => {
      clearTimeout(timer);
      attachSocket(socket);
      resolve(true);
    };
    socket.onerror = () => { clearTimeout(timer); resolve(false); };
  });
}

function attachSocket(socket) {
  ws = socket;

  socket.onmessage = (event) => {
    let data;
    try { data = JSON.parse(event.data); } catch { return; }
    // Forward to all open extension pages (sidebar / popup)
    chrome.runtime.sendMessage({ source: 'server', data }).catch(() => {});
  };

  socket.onclose = () => { ws = null; };
}

function launchServer() {
  return new Promise((resolve) => {
    let port;
    try {
      port = chrome.runtime.connectNative(NATIVE_HOST);
    } catch (err) {
      console.error('Native host not registered:', err);
      resolve({ status: 'error' });
      return;
    }

    port.postMessage({ action: 'start' });
    port.onMessage.addListener((msg) => { port.disconnect(); resolve(msg); });
    port.onDisconnect.addListener(() => resolve({ status: 'ok' }));
  });
}

// ── Message relay from sidebar / popup → server ───────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Sidebar loaded — connect if needed and notify it when ready
  if (msg.source === 'ui_ready') {
    ensureConnection().then(() => {
      const ok = ws && ws.readyState === WebSocket.OPEN;
      chrome.runtime.sendMessage({ source: 'server', data: { type: 'server_connected', ok } })
        .catch(() => {});
      sendResponse({ ok });
    });
    return true;
  }

  if (msg.source !== 'extension') return false;

  // Always ensure connection — service worker may have been killed and restarted
  ensureConnection().then(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg.data));
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: 'No server connection' });
    }
  });
  return true;
});
