const WS_URL = 'ws://localhost:3457';
const NATIVE_HOST = 'com.augmentis.browsky';

let ws = null;
let launching = false;

// ── Icon click ────────────────────────────────────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  await ensureConnection();

  const { viewMode } = await chrome.storage.local.get({ viewMode: 'sidebar' });
  if (viewMode === 'sidebar') {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } else {
    chrome.windows.create({
      url: chrome.runtime.getURL('popup.html'),
      type: 'popup',
      width: 440,
      height: 720,
      focused: true,
    });
  }
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
  if (msg.source !== 'extension') return false;

  ensureConnection().then(() => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg.data));
      sendResponse({ ok: true });
    } else {
      sendResponse({ ok: false, error: 'No server connection' });
    }
  });

  return true; // async response
});
