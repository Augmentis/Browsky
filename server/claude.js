const { spawn } = require('child_process');
const os = require('os');

// Extend PATH with common Claude install locations so the subprocess finds it
const EXTENDED_PATH = [
  `${os.homedir()}/.local/bin`,
  `${os.homedir()}/.npm-global/bin`,
  '/usr/local/bin',
  '/opt/homebrew/bin',
  process.env.PATH,
].join(':');

// sessionId -> { claudeSessionId: string | null }
const state = new Map();

function chat(session, sessionId, content, onChunk) {
  return new Promise((resolve, reject) => {
    if (!state.has(sessionId)) state.set(sessionId, { claudeSessionId: null });
    const s = state.get(sessionId);

    const args = ['-p', '--output-format', 'stream-json', '--verbose'];
    if (s.claudeSessionId) args.push('--resume', s.claudeSessionId);
    args.push(content);

    const proc = spawn('claude', args, { env: { ...process.env, PATH: EXTENDED_PATH }, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';

    proc.stdout.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // hold incomplete line

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          processEvent(obj, s, onChunk);
        } catch {
          // Non-JSON — check for auth error surfaced as plain text
          if (line.includes('not logged in') || line.includes('Please run /login')) {
            reject(new Error('Not authenticated — run `claude` in your terminal to log in, then restart the server.'));
          }
        }
      }
    });

    let stderrOutput = '';
    proc.stderr.on('data', (data) => {
      const text = data.toString().trim();
      stderrOutput += text;
      console.error('[claude]', text);
    });

    proc.on('close', (code) => {
      if (buffer.trim()) {
        try { processEvent(JSON.parse(buffer), s, onChunk); } catch { }
      }
      if (code === 0) {
        resolve();
      } else {
        // Surface auth errors as readable messages
        if (stderrOutput.includes('not logged in') || stderrOutput.includes('login') || stderrOutput.includes('401')) {
          reject(new Error('Not authenticated — run `claude` in your terminal to log in, then restart the server.'));
        } else {
          reject(new Error(stderrOutput || `claude exited with code ${code}`));
        }
      }
    });

    proc.on('error', (err) => {
      if (err.code === 'ENOENT') {
        reject(new Error('claude CLI not found — install it from https://claude.ai/code'));
      } else {
        reject(new Error(`Failed to start claude: ${err.message}`));
      }
    });
  });
}

function processEvent(obj, s, onChunk) {
  // Session ID comes in the result object
  if (obj.type === 'result' && obj.session_id) {
    s.claudeSessionId = obj.session_id;
    return;
  }

  // Complete assistant turn
  if (obj.type === 'assistant' && Array.isArray(obj.message?.content)) {
    for (const block of obj.message.content) {
      if (block.type === 'text' && block.text) onChunk(block.text);
    }
    return;
  }

  // Streaming partial — wrapped in stream_event
  if (obj.type === 'stream_event') {
    const ev = obj.event || obj;
    if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
      onChunk(ev.delta.text);
    }
    return;
  }

  // Streaming partial — direct top-level
  if (obj.type === 'content_block_delta' && obj.delta?.type === 'text_delta') {
    onChunk(obj.delta.text);
  }
}

function closeSession(sessionId) {
  state.delete(sessionId);
}

module.exports = { chat, closeSession };
