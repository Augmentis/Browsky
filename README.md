# Browsky

A Chrome extension that brings an AI chat sidebar to any webpage. Supports multi-session parallel conversations with Claude (via Claude Code CLI) or any locally running Ollama model.

## Features

- Persistent sidebar panel on any page, toggleable to a popup
- Multiple parallel chat sessions — start new sessions while keeping existing ones open
- Each session independently configured to use Claude CLI or a local Ollama model
- Streaming responses
- Claude-inspired UI

## How it works

Browsky has three parts:

**`extension/`** — the Chrome UI (sidebar, popup, session tabs). It can't talk to AI models directly because Chrome's sandbox blocks extensions from making arbitrary network calls or spawning processes. So it connects to a local server over WebSocket instead.

**`server/`** — a Node.js app running locally on your machine. This is the brain: it receives messages from the extension, either spawns `claude -p` as a subprocess (for Claude sessions) or calls Ollama's API (for local models), and streams responses back. It starts once and keeps running in the background.

**`native-host/`** — a tiny one-job script whose only purpose is to start the server. Because extensions can't spawn processes, Chrome has one exception: pre-registered scripts called native messaging hosts. On icon click, the extension asks Chrome to launch `launcher.js`, which checks if the server is already running and starts it if not, then exits. After that the extension talks directly to the server — the native host is never involved again.

```
Click icon
    → background.js calls chrome.runtime.connectNative()
    → Chrome launches native-host/launcher.js  (~1 second, then exits)
    → launcher.js spawns node server/index.js  (stays running)
    → background.js connects to ws://localhost:3457
    → sidebar opens, talks directly to server from here on
            ├── Claude sessions: server spawns claude -p per message
            └── Ollama sessions: server proxies http://localhost:11434
```

## Project Structure

```
Browsky/
├── extension/          # Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js   # service worker — manages WS connection + server launch
│   ├── sidebar.html    # main chat UI
│   ├── sidebar.js      # session management, message rendering
│   ├── popup.html      # compact popup view
│   ├── popup.js
│   └── styles.css      # Claude-inspired design tokens + layout
│
├── server/             # local Node.js WebSocket server
│   ├── index.js        # WS server, session routing
│   ├── claude.js       # spawns claude CLI, manages session IDs
│   ├── ollama.js       # proxies Ollama API, lists available models
│   └── package.json
│
├── native-host/        # minimal native messaging host (launch only)
│   ├── launcher.js     # starts server if not running, then exits
│   └── com.augmentis.browsky.json
│
├── install.sh          # registers native host, installs server deps
├── SPEC.md             # full technical specification
└── TODO.md             # implementation checklist
```

## Setup

### Prerequisites
- macOS
- [Claude Code CLI](https://claude.ai/code) installed and authenticated
- [Ollama](https://ollama.ai) installed (optional, for local models)
- Node.js 18+

### Install

```bash
git clone https://github.com/Augmentis/Browsky.git
cd Browsky
./install.sh
```

Then load the `extension/` folder as an unpacked extension in `chrome://extensions`.

## Usage

1. Click the Browsky icon in Chrome toolbar — server starts automatically
2. The sidebar opens on the right side of the page
3. Click **New Session** — choose Claude or a local Ollama model
4. Chat. Start more sessions anytime from the session panel.
5. Toggle between sidebar and popup using the layout switch in the header.
