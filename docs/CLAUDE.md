# CLAUDE.md — Plugin Dev Instructions

This file tells Claude how to work in this plugin repo. Copy it into any new
plugin folder and start a Claude session — Claude will read this automatically
and know exactly what to do.

---

## What this repo is

A Chrome extension plugin. Structure:

```
<PluginName>/
├── CLAUDE.md               ← this file — copy to every new plugin
├── DEVELOPER.md            ← human-facing dev workflow guide
├── SPEC.md                 ← architecture and technical decisions
├── TODO.md                 ← implementation checklist, keep updated
├── README.md               ← project overview and setup
├── dev.config.json         ← config for the error feedback loop
├── dev/
│   ├── dev.sh              ← launch Chrome + error loop
│   ├── error-loop.js       ← CDP watcher + Claude auto-fix
│   └── HOW-IT-WORKS.md     ← explains the error loop in detail
├── extension/              ← Chrome extension (Manifest V3)
│   ├── manifest.json
│   ├── background.js
│   ├── sidebar.html + sidebar.js
│   ├── popup.html + popup.js
│   └── styles.css
├── server/                 ← local Node.js backend (if needed)
│   ├── index.js
│   └── package.json
├── native-host/            ← native messaging launcher (if needed)
│   ├── launcher.js
│   └── com.augmentis.<name>.json
└── install.sh
```

---

## Starting a new plugin from scratch

When this CLAUDE.md is dropped into an empty folder and a Claude session is
started, do the following without waiting to be asked:

1. Ask the user: "What should this plugin do?" — one round of clarification
2. Write `SPEC.md` — architecture, components, data flow, out-of-scope for v1
3. Write `TODO.md` — phased implementation checklist (setup → server → extension → test → polish)
4. Write `README.md` — overview, setup steps
5. Fill `dev.config.json`:
   ```json
   {
     "name": "PluginName",
     "description": "One line description",
     "sourceDirs": ["extension", "server"],
     "cdpPort": 9222
   }
   ```
   Use port 9222 unless user says another plugin is already running on it.
6. Copy `dev/error-loop.js`, `dev/dev.sh`, `dev/HOW-IT-WORKS.md` from an
   existing plugin (e.g. Browsky) — these files need no changes.
7. Create the GitHub repo under the `Augmentis` org
8. Make an initial commit with all docs, then start implementing TODO phases

---

## Working on an existing plugin

1. Read `dev.config.json` — understand the plugin name and source dirs
2. Read `SPEC.md` — understand the architecture
3. Read `TODO.md` — find the first unchecked item and pick up from there
4. Mark tasks in `TODO.md` as completed as you go

---

## Dev workflow — error feedback loop

Every plugin has a self-contained dev mode:

```bash
./dev/dev.sh
```

- Launches a sandboxed Chrome instance with CDP on the port in `dev.config.json`
- Watches extension pages for `console.error` and uncaught exceptions
- On any error: sends the error + surrounding source lines to `claude -p`
  with `Read/Edit/Write` tools — fix is applied automatically
- Opens a new Terminal window per fix so the user can watch live
- Claude session ID is persisted in `dev/.claude-session-id` so the same
  session is reused across fixes — Claude accumulates project context

---

## Conventions

- Chrome only, Manifest V3
- Dark UI — Claude-inspired design (see Browsky/extension/styles.css as reference)
- Local backends use WebSocket on localhost, starting at port 3457
- Native messaging host pattern to start the local server on icon click
- GitHub org: Augmentis
- No "made with Claude" in commit messages
