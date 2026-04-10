# Browsky — Implementation Checklist

Track progress here. Check items off as they are completed.

---

## Phase 1 — Project Setup
- [x] Initialize git repository
- [x] Write SPEC.md
- [x] Write README.md
- [x] Write TODO.md
- [ ] Create GitHub repo under Augmentis org and push initial commit
- [ ] Set up folder structure (extension/, server/, native-host/)

---

## Phase 2 — Local Server

- [ ] `server/package.json` — dependencies: `ws`, `uuid`
- [ ] `server/index.js` — WebSocket server on port 3457, session routing
- [ ] `server/claude.js` — spawn `claude -p`, stream stdout, track session IDs
- [ ] `server/ollama.js` — fetch model list from Ollama, proxy streaming chat
- [ ] Server: handle `new_session`, `chat`, `close_session` message types
- [ ] Server: broadcast `stream_chunk`, `stream_end`, `error`, `models`, `session_ready`
- [ ] Server: graceful shutdown on SIGTERM

---

## Phase 3 — Native Launcher

- [ ] `native-host/launcher.js` — check port 3457, spawn server if not running, respond and exit
- [ ] `native-host/com.augmentis.browsky.json` — native messaging manifest template
- [ ] install.sh — npm install, chmod, patch paths, copy manifest, print instructions

---

## Phase 4 — Chrome Extension

- [ ] `extension/manifest.json` — MV3, sidePanel + nativeMessaging + storage permissions
- [ ] `extension/background.js` — icon click handler, native launch, WebSocket singleton
- [ ] `extension/styles.css` — design tokens, layout, Claude-like theme
- [ ] `extension/sidebar.html` — sidebar shell (session panel + chat area + input)
- [ ] `extension/sidebar.js` — session list, new session modal, model picker, message rendering
- [ ] `extension/popup.html` + `popup.js` — compact popup view (reuse sidebar logic)
- [ ] Sidebar ↔ Popup toggle — persisted in chrome.storage.local
- [ ] New session modal — Claude vs Local Model choice, Ollama model dropdown
- [ ] Streaming token rendering — append in place, cursor animation, auto-scroll
- [ ] Session panel — list active sessions, switch between them, close a session

---

## Phase 5 — Integration & Testing

- [ ] End-to-end: extension icon click → server starts → sidebar opens
- [ ] End-to-end: Claude session — send message, stream response, follow-up with --resume
- [ ] End-to-end: Ollama session — model picker populates, message streams
- [ ] Parallel sessions — two simultaneous sessions on different models
- [ ] Sidebar ↔ Popup toggle works without losing session state
- [ ] install.sh tested on clean macOS setup

---

## Phase 6 — Polish

- [ ] Error states — server not running, Claude not authenticated, Ollama not running
- [ ] Loading states — spinner while server starts, connecting indicator
- [ ] Empty state UI for new sessions
- [ ] Keyboard shortcut to open sidebar (chrome commands API)
- [ ] Session names — auto-generated from first message, editable on double-click
