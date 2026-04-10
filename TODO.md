# Browsky — Implementation Checklist

---

## Phase 1 — Project Setup
- [x] Initialize git repository
- [x] Write SPEC.md, README.md, TODO.md
- [x] Create GitHub repo under Augmentis org
- [x] Set up folder structure (extension/, server/, native-host/)

## Phase 2 — Local Server
- [x] `server/package.json`
- [x] `server/index.js` — WebSocket server, session routing
- [x] `server/claude.js` — spawn claude -p, stream-json, --resume
- [x] `server/ollama.js` — model list, streaming chat proxy

## Phase 3 — Native Launcher
- [x] `native-host/launcher.js`
- [x] `native-host/com.augmentis.browsky.json`
- [x] `install.sh`

## Phase 4 — Chrome Extension
- [x] `extension/manifest.json`
- [x] `extension/background.js` — icon click, sidePanel, WS singleton
- [x] `extension/styles.css`
- [x] `extension/sidebar.html` + `sidebar.js`
- [x] `extension/popup.html` (reuses sidebar.js)
- [x] Sidebar ↔ Popup toggle
- [x] New session modal — Claude vs Ollama, model picker
- [x] Streaming token rendering + cursor animation
- [x] Session tabs — switch, close, parallel sessions

## Phase 5 — Integration & Testing  ← YOU ARE HERE
- [ ] Run `./install.sh` — verify npm install + native host manifest written
- [ ] Load extension in chrome://extensions, copy Extension ID, re-run `./install.sh <ID>`
- [ ] Click icon → server starts → sidebar opens (no errors)
- [ ] Claude session: send a message, watch it stream, send a follow-up (tests --resume)
- [ ] Ollama session: model picker populates, message streams (requires Ollama running)
- [ ] Open two sessions simultaneously on different models
- [ ] Sidebar ↔ Popup toggle without losing session state

## Phase 6 — Polish
- [ ] Error states — server not running, Claude not authenticated, Ollama offline
- [ ] Session names — auto-named from first message, double-click to rename
- [ ] Keyboard shortcut to open sidebar
