const OLLAMA = 'http://localhost:11434';

// sessionId -> [{ role, content }]
const history = new Map();

async function getModels() {
  const res = await fetch(`${OLLAMA}/api/tags`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error('Ollama unavailable');
  const data = await res.json();
  return (data.models || []).map((m) => m.name);
}

async function chat(session, sessionId, content, onChunk) {
  if (!history.has(sessionId)) history.set(sessionId, []);
  const msgs = history.get(sessionId);
  msgs.push({ role: 'user', content });

  const modelName = session.model.replace(/^ollama:/, '');

  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName, messages: msgs, stream: true }),
  });

  if (!res.ok) throw new Error(`Ollama: ${res.status} ${res.statusText}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let assistantText = '';
  let partial = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    partial += decoder.decode(value, { stream: true });
    const lines = partial.split('\n');
    partial = lines.pop();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        const chunk = obj.message?.content;
        if (chunk) {
          onChunk(chunk);
          assistantText += chunk;
        }
      } catch { /* skip malformed */ }
    }
  }

  msgs.push({ role: 'assistant', content: assistantText });
}

function closeSession(sessionId) {
  history.delete(sessionId);
}

module.exports = { getModels, chat, closeSession };
