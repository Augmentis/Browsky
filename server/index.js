const { WebSocketServer } = require('ws');
const claude = require('./claude');
const ollama = require('./ollama');

const PORT = 3457;

// sessionId -> { type: 'claude'|'ollama', model: string, ws: WebSocket }
const sessions = new Map();

const wss = new WebSocketServer({ port: PORT });
console.log(`Browsky server on ws://localhost:${PORT}`);

// Fetch Ollama models on startup (non-fatal)
ollama.getModels()
  .then(models => console.log(`Ollama models: ${models.join(', ') || 'none'}`))
  .catch(() => console.log('Ollama not reachable on startup'));

wss.on('connection', (ws) => {
  console.log('Extension connected');

  // Send current model list immediately on connect
  ollama.getModels()
    .then(models => send(ws, { type: 'models', models }))
    .catch(() => send(ws, { type: 'models', models: [] }));

  ws.on('message', async (data) => {
    let msg;
    try { msg = JSON.parse(data.toString()); }
    catch { return; }
    console.log(`→ ${msg.type}`, msg.sessionId || '');

    switch (msg.type) {
      case 'new_session': {
        const { sessionId, model } = msg;
        const type = model === 'claude' ? 'claude' : 'ollama';
        sessions.set(sessionId, { type, model, ws });
        send(ws, { type: 'session_ready', sessionId });
        break;
      }

      case 'chat': {
        const { sessionId, content } = msg;
        const session = sessions.get(sessionId);
        if (!session) {
          send(ws, { type: 'error', sessionId, message: 'Session not found' });
          return;
        }
        try {
          const handler = session.type === 'claude' ? claude : ollama;
          await handler.chat(session, sessionId, content, (text) => {
            if (ws.readyState === ws.OPEN)
              send(ws, { type: 'stream_chunk', sessionId, text });
          });
          if (ws.readyState === ws.OPEN)
            send(ws, { type: 'stream_end', sessionId });
        } catch (err) {
          if (ws.readyState === ws.OPEN)
            send(ws, { type: 'error', sessionId, message: err.message });
        }
        break;
      }

      case 'close_session': {
        const { sessionId } = msg;
        if (sessions.get(sessionId)?.type === 'claude') claude.closeSession(sessionId);
        else ollama.closeSession(sessionId);
        sessions.delete(sessionId);
        break;
      }

      case 'get_models': {
        ollama.getModels()
          .then(models => send(ws, { type: 'models', models }))
          .catch(() => send(ws, { type: 'models', models: [] }));
        break;
      }
    }
  });

  ws.on('close', () => {
    console.log('Extension disconnected');
    for (const [id, session] of sessions) {
      if (session.ws === ws) {
        if (session.type === 'claude') claude.closeSession(id);
        else ollama.closeSession(id);
        sessions.delete(id);
      }
    }
  });
});

function send(ws, obj) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj));
}

process.on('SIGTERM', () => wss.close(() => process.exit(0)));
