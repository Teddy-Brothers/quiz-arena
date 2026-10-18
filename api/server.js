// Quiz Arena API (zero dependencies).
//   GET  /api/health
//   POST /api/ai/generate          topic -> quiz questions (provider adapter: mock default, anthropic optional)
//   POST /api/rooms/:code/send     relay a message to everyone in a room        (network mode)
//   GET  /api/rooms/:code/events   Server-Sent Events stream for a room         (network mode)
// The relay is deliberately dumb: the host's browser stays authoritative for game state.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { config, runTask, SAFETY } = require('./ai');

try {
  fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split(/\r?\n/).forEach((l) => {
    const m = l.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && !(m[1] in process.env)) process.env[m[1]] = m[2];
  });
} catch (_) { /* no .env: fine */ }

const PORT = Number(process.env.PORT) || 3105;

// ---- AI task: generate questions ---------------------------------------------
// Input : { topic, count }   Output: { questions: [{ text, choices: [4 strings], correct: 0-3, explanation }] }
const generate = {
  system: `You write multiple-choice quiz questions. Return exactly the requested count. Each question has "text", exactly 4 "choices", "correct" (index 0-3) and a one-sentence "explanation". Only include facts you are confident are true; prefer well-established facts. JSON shape: {"questions": [{"text": string, "choices": [string,string,string,string], "correct": number, "explanation": string}]}. ${SAFETY}`,
  buildUser: (p) => `count: ${p.count || 5}\n<data>${String(p.topic || '').slice(0, 120)}</data>`,
  mock(p) {
    const topic = String(p.topic || 'this topic').slice(0, 60);
    const n = Math.min(Number(p.count) || 3, 5);
    return { questions: Array.from({ length: n }, (_, i) => ({
      text: `[Simulated] Placeholder question ${i + 1} about ${topic}. Which option is marked correct?`,
      choices: ['Option A', 'Option B (marked correct)', 'Option C', 'Option D'], correct: 1,
      explanation: 'This is simulated output. No model was called, so the content is not factual.',
    })) };
  },
  validate(r) {
    const qs = (Array.isArray(r.questions) ? r.questions : [])
      .filter((q) => q && typeof q.text === 'string' && Array.isArray(q.choices) && q.choices.length === 4 && Number.isInteger(q.correct) && q.correct >= 0 && q.correct <= 3)
      .map((q) => ({ text: q.text.slice(0, 240), choices: q.choices.map((c) => String(c).slice(0, 100)), correct: q.correct, explanation: String(q.explanation || '').slice(0, 240) }));
    if (!qs.length) throw new Error('AI returned no valid questions');
    return { questions: qs.slice(0, 10) };
  },
};
const TASKS = { generate };

// ---- room relay ------------------------------------------------------------------
const rooms = new Map(); // code -> Set<res>
const CODE = /^[A-Z0-9]{4,8}$/;

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
  res.end(JSON.stringify(body));
}
function readBody(req, cb) {
  let raw = '';
  req.on('data', (c) => { raw += c; if (raw.length > 1e5) req.destroy(); });
  req.on('end', () => cb(raw));
}

http.createServer((req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.url === '/api/health') { const c = config(); return send(res, 200, { ok: true, provider: c.provider, model: c.model, ready: c.ready, simulated: c.provider === 'mock', rooms: rooms.size }); }

  const ai = req.url.match(/^\/api\/ai\/(\w+)$/);
  if (req.method === 'POST' && ai && TASKS[ai[1]]) {
    return readBody(req, async (raw) => {
      try { send(res, 200, await runTask(TASKS[ai[1]], JSON.parse(raw || '{}'))); }
      catch (e) { send(res, e.status || 502, { message: e.message }); }
    });
  }

  const room = req.url.match(/^\/api\/rooms\/([A-Za-z0-9]+)\/(send|events)$/);
  if (room) {
    const code = room[1].toUpperCase();
    if (!CODE.test(code)) return send(res, 400, { message: 'Bad room code' });
    if (room[2] === 'events' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
      res.write(': connected\n\n');
      if (!rooms.has(code)) rooms.set(code, new Set());
      rooms.get(code).add(res);
      const ping = setInterval(() => res.write(': ping\n\n'), 25000);
      req.on('close', () => { clearInterval(ping); const s = rooms.get(code); if (s) { s.delete(res); if (!s.size) rooms.delete(code); } });
      return;
    }
    if (room[2] === 'send' && req.method === 'POST') {
      return readBody(req, (raw) => {
        const data = `data: ${JSON.stringify(JSON.parse(raw || 'null'))}\n\n`;
        (rooms.get(code) || new Set()).forEach((r) => r.write(data));
        send(res, 200, { ok: true, listeners: (rooms.get(code) || new Set()).size });
      });
    }
  }
  send(res, 404, { message: 'Not found' });
}).listen(PORT, () => { const c = config(); console.log(`Quiz Arena API on http://localhost:${PORT} (provider: ${c.provider}${c.provider === 'mock' ? ', simulated' : ''})`); });
