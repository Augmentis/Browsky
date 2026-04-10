# Developer Guide

How to start, develop, and test a plugin in this workspace.

---

## Starting a brand new plugin

1. Create a folder for the new plugin:
   ```bash
   mkdir ~/work/Plugins/NewPluginName
   cd ~/work/Plugins/NewPluginName
   ```

2. Copy `CLAUDE.md` from an existing plugin (e.g. Browsky):
   ```bash
   cp ~/work/Plugins/Browsky/CLAUDE.md .
   ```

3. Start a Claude session in that folder:
   ```bash
   claude
   ```

   Claude reads `CLAUDE.md` automatically and will ask what the plugin should
   do, then scaffold everything — spec, todo, folder structure, GitHub repo,
   and initial code — without you having to explain the setup.

---

## Setting up an existing plugin (first time on a machine)

1. Clone the plugin repo:
   ```bash
   cd ~/work/Plugins
   git clone https://github.com/Augmentis/<PluginName>.git
   cd <PluginName>
   ```

2. Run the installer:
   ```bash
   ./install.sh
   ```
   This installs server dependencies and prints instructions for loading
   the extension.

3. Load the extension in Chrome:
   - Open `chrome://extensions`
   - Enable **Developer Mode** (top-right toggle)
   - Click **Load unpacked** → select the `extension/` folder
   - Copy the Extension ID shown under the plugin name

4. Re-run install with your Extension ID:
   ```bash
   ./install.sh <EXTENSION_ID>
   ```
   This writes the native messaging host manifest so Chrome can launch the
   local server on icon click.

5. Click the plugin icon in the Chrome toolbar to test.

---

## Daily dev workflow

### Starting dev mode

```bash
cd ~/work/Plugins/<PluginName>
./dev/dev.sh
```

This opens a sandboxed Chrome window with remote debugging enabled.
Load the extension there if not already loaded (same steps as above).

### Making changes

Edit files in `extension/`, `server/`, or `native-host/` as needed.

For extension changes: go to `chrome://extensions` and click the refresh
icon on the plugin card, then reload any open extension pages.

For server changes: kill and restart the server (`Ctrl+C` in the terminal
where it's running, then `node server/index.js`).

### Automatic error fixing

With `./dev/dev.sh` running, any `console.error` or uncaught exception in
the extension is automatically sent to Claude, which applies a fix and opens
a new Terminal window so you can watch the output live.

See `dev/HOW-IT-WORKS.md` for a full explanation of how this works.

### After Claude applies a fix

1. Reload the extension in `chrome://extensions`
2. Test the fix in the browser
3. If it looks good, commit:
   ```bash
   git add -p   # review changes before staging
   git commit -m "your message"
   git push
   ```

---

## Continuing work with Claude

To pick up where you left off in a previous Claude session:

```bash
cd ~/work/Plugins/<PluginName>
claude --continue
```

Claude re-reads `CLAUDE.md`, `SPEC.md`, and `TODO.md` and resumes from the
last unchecked item.

---

## Useful commands

| Command | What it does |
|---|---|
| `./install.sh` | Install deps, register native host |
| `./install.sh <ID>` | Re-register with a specific Extension ID |
| `./dev/dev.sh` | Launch sandboxed Chrome + error loop |
| `node server/index.js` | Start the local server manually |
| `claude --continue` | Resume last Claude session in this folder |
| `claude` | Start fresh Claude session |
