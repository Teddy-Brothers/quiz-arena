import { API_BASE } from './ai';

export interface Question { text: string; choices: string[]; correct: number; explanation: string; }
export interface Pack { title: string; questions: Question[]; }

export type Phase = 'lobby' | 'question' | 'reveal' | 'podium';

export interface PlayerInfo { id: string; name: string; score: number; bot: boolean; delta: number; correct: boolean | null; }

/** Host -> everyone. The correct answer is only included from the reveal phase on. */
export interface StateMsg {
  t: 'state';
  phase: Phase;
  packTitle: string;
  qIndex: number;
  total: number;
  limitMs: number;
  remainingMs: number; // relative, so devices with different clocks stay in sync
  question: { text: string; choices: string[] } | null;
  reveal: { correct: number; explanation: string; counts: number[] } | null;
  players: PlayerInfo[];
}
export type PlayerMsg = { t: 'join'; id: string; name: string } | { t: 'answer'; id: string; q: number; choice: number } | { t: 'leave'; id: string };
export type Msg = StateMsg | PlayerMsg | { t: 'hello' };

// ---------------------------------------------------------------------------------
// Transports. LocalTransport links tabs of the same browser; NetworkTransport relays through the Node API.
export interface Transport { send(m: Msg): void; onMessage(cb: (m: Msg) => void): void; close(): void; }

interface Envelope { src: string; body: Msg; }
const uid = () => Math.random().toString(36).slice(2, 10);

export class LocalTransport implements Transport {
  private ch: BroadcastChannel; private src = uid();
  constructor(code: string) { this.ch = new BroadcastChannel(`quiz-arena-${code}`); }
  send(m: Msg) { this.ch.postMessage({ src: this.src, body: m } as Envelope); }
  onMessage(cb: (m: Msg) => void) { this.ch.onmessage = (e) => { const env = e.data as Envelope; if (env?.src !== this.src) cb(env.body); }; }
  close() { this.ch.close(); }
}

export class NetworkTransport implements Transport {
  private es: EventSource; private src = uid(); private code: string;
  constructor(code: string) {
    this.code = code;
    this.es = new EventSource(`${API_BASE}/api/rooms/${code}/events`);
  }
  send(m: Msg) {
    fetch(`${API_BASE}/api/rooms/${this.code}/send`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ src: this.src, body: m } as Envelope) }).catch(() => { /* host/relay offline */ });
  }
  onMessage(cb: (m: Msg) => void) { this.es.onmessage = (e) => { const env = JSON.parse(e.data) as Envelope; if (env?.src !== this.src) cb(env.body); }; }
  close() { this.es.close(); }
}

export async function apiReachable(): Promise<boolean> {
  try { return (await fetch(`${API_BASE}/api/health`)).ok; } catch { return false; }
}

export function makeTransport(mode: 'local' | 'network', code: string): Transport {
  return mode === 'network' ? new NetworkTransport(code) : new LocalTransport(code);
}

export function newCode(): string {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return Array.from({ length: 5 }, () => a[Math.floor(Math.random() * a.length)]).join('');
}

// ---------------------------------------------------------------------------------
// Scoring: 500-1000 for a correct answer depending on speed, plus a small streak bonus.
export function points(elapsedMs: number, limitMs: number, streakBefore: number): number {
  const speed = 1 - Math.min(1, Math.max(0, elapsedMs / limitMs)) / 2;
  return Math.round(1000 * speed) + Math.min(streakBefore, 5) * 50;
}

const BOT_NAMES = ['Pixel', 'Marlo', 'Juniper', 'Orbit', 'Tilly', 'Basil', 'Echo', 'Nova'];

interface HostPlayer { id: string; name: string; score: number; streak: number; bot: boolean; delta: number; correct: boolean | null; answer: { choice: number; at: number } | null; }

/** The host's browser is authoritative: it owns the questions, timer and scores. */
export class QuizHost {
  phase: Phase = 'lobby';
  qIndex = -1;
  limitMs = 15000;
  private players = new Map<string, HostPlayer>();
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private botTimers: ReturnType<typeof setTimeout>[] = [];
  private counts: number[] = [0, 0, 0, 0];

  constructor(public code: string, public pack: Pack, private transport: Transport, private changed: (s: StateMsg) => void) {
    transport.onMessage((m) => this.receive(m));
  }

  get playerCount() { return this.players.size; }
  get questionCount() { return this.pack.questions.length; }

  private receive(m: Msg) {
    if (m.t === 'hello') this.broadcast();
    else if (m.t === 'join') {
      if (!this.players.has(m.id)) this.players.set(m.id, { id: m.id, name: m.name.slice(0, 16), score: 0, streak: 0, bot: false, delta: 0, correct: null, answer: null });
      this.broadcast();
    } else if (m.t === 'leave') { this.players.delete(m.id); this.broadcast(); }
    else if (m.t === 'answer') this.recordAnswer(m.id, m.q, m.choice);
  }

  addBots(n: number) {
    const free = BOT_NAMES.filter((b) => ![...this.players.values()].some((p) => p.name === b));
    free.slice(0, n).forEach((name) => { const id = 'bot-' + name; this.players.set(id, { id, name, score: 0, streak: 0, bot: true, delta: 0, correct: null, answer: null }); });
    this.broadcast();
  }

  start() { if (this.phase === 'lobby' && this.players.size) this.ask(0); }

  next() {
    if (this.phase === 'reveal') {
      if (this.qIndex + 1 < this.pack.questions.length) this.ask(this.qIndex + 1);
      else { this.phase = 'podium'; this.broadcast(); }
    }
  }

  skipToReveal() { if (this.phase === 'question') this.reveal(); }

  private ask(i: number) {
    this.qIndex = i; this.phase = 'question'; this.startedAt = Date.now();
    this.counts = [0, 0, 0, 0];
    this.players.forEach((p) => { p.answer = null; p.delta = 0; p.correct = null; });
    this.clearTimers();
    this.timer = setTimeout(() => this.reveal(), this.limitMs);
    const q = this.pack.questions[i];
    this.players.forEach((p) => {
      if (!p.bot) return;
      this.botTimers.push(setTimeout(() => {
        const right = Math.random() < 0.62;
        const choice = right ? q.correct : (q.correct + 1 + Math.floor(Math.random() * 3)) % 4;
        this.recordAnswer(p.id, i, choice);
      }, 1800 + Math.random() * 8000));
    });
    this.broadcast();
  }

  private recordAnswer(id: string, q: number, choice: number) {
    const p = this.players.get(id);
    if (!p || this.phase !== 'question' || q !== this.qIndex || p.answer || choice < 0 || choice > 3) return;
    p.answer = { choice, at: Date.now() };
    if ([...this.players.values()].every((x) => x.answer)) this.reveal();
    else this.broadcast();
  }

  private reveal() {
    if (this.phase !== 'question') return;
    this.clearTimers();
    const q = this.pack.questions[this.qIndex];
    this.counts = [0, 0, 0, 0];
    this.players.forEach((p) => {
      if (p.answer) this.counts[p.answer.choice]++;
      const ok = !!p.answer && p.answer.choice === q.correct;
      p.correct = p.answer ? ok : null;
      p.delta = ok ? points(p.answer!.at - this.startedAt, this.limitMs, p.streak) : 0;
      p.streak = ok ? p.streak + 1 : 0;
      p.score += p.delta;
    });
    this.phase = 'reveal';
    this.broadcast();
  }

  private clearTimers() {
    if (this.timer) clearTimeout(this.timer);
    this.botTimers.forEach(clearTimeout); this.botTimers = [];
  }

  state(): StateMsg {
    const q = this.qIndex >= 0 ? this.pack.questions[this.qIndex] : null;
    const players = [...this.players.values()].map<PlayerInfo>((p) => ({ id: p.id, name: p.name, score: p.score, bot: p.bot, delta: p.delta, correct: p.correct }))
      .sort((a, b) => b.score - a.score);
    return {
      t: 'state', phase: this.phase, packTitle: this.pack.title, qIndex: this.qIndex, total: this.pack.questions.length, limitMs: this.limitMs,
      remainingMs: this.phase === 'question' ? Math.max(0, this.limitMs - (Date.now() - this.startedAt)) : 0,
      question: q && this.phase !== 'lobby' && this.phase !== 'podium' ? { text: q.text, choices: q.choices } : null,
      reveal: q && this.phase === 'reveal' ? { correct: q.correct, explanation: q.explanation, counts: this.counts } : null,
      players,
    };
  }

  broadcast() { const s = this.state(); this.transport.send(s); this.changed(s); }
  answeredCount() { return [...this.players.values()].filter((p) => p.answer).length; }
  close() { this.clearTimers(); this.transport.close(); }
}

/** A player's client. Holds no answers; it only sends a choice and renders what the host says. */
export class QuizPlayer {
  readonly id = 'p-' + uid();
  constructor(public name: string, private transport: Transport, private changed: (s: StateMsg) => void) {
    transport.onMessage((m) => { if (m.t === 'state') this.changed(m); });
    transport.send({ t: 'join', id: this.id, name });
    transport.send({ t: 'hello' });
  }
  answer(q: number, choice: number) { this.transport.send({ t: 'answer', id: this.id, q, choice }); }
  close() { this.transport.send({ t: 'leave', id: this.id }); this.transport.close(); }
}

export const SAMPLE_PACK: Pack = {
  title: 'Design and Web Basics (sample)',
  questions: [
    { text: 'Which three colors do screens mix to produce all their other colors?', choices: ['Red, yellow, blue', 'Cyan, magenta, yellow', 'Red, green, blue', 'Black, white, grey'], correct: 2, explanation: 'Screens add light in red, green and blue (RGB). Printers use cyan, magenta, yellow and black.' },
    { text: 'What does "UX" stand for?', choices: ['User Experience', 'Unified Export', 'Ultra Extension', 'Usable Execution'], correct: 0, explanation: 'UX means User Experience: how a product feels to use.' },
    { text: 'The Helvetica typeface was first designed in which country?', choices: ['Italy', 'Switzerland', 'United States', 'Japan'], correct: 1, explanation: 'Helvetica was designed in Switzerland in 1957.' },
    { text: 'In CSS, which property sets the color of text?', choices: ['font-color', 'text-color', 'foreground', 'color'], correct: 3, explanation: 'The property is simply "color".' },
    { text: 'Which of these image formats is a vector format?', choices: ['JPEG', 'SVG', 'PNG', 'GIF'], correct: 1, explanation: 'SVG describes shapes with math, so it scales without losing sharpness.' },
    { text: 'Who painted "The Starry Night"?', choices: ['Claude Monet', 'Pablo Picasso', 'Vincent van Gogh', 'Salvador Dali'], correct: 2, explanation: 'Vincent van Gogh painted it in 1889.' },
    { text: 'What does HTML stand for?', choices: ['HyperText Markup Language', 'High Tech Modern Layout', 'Home Tool Markup Level', 'Hyperlink Text Machine Language'], correct: 0, explanation: 'HTML is HyperText Markup Language, the structure of web pages.' },
    { text: 'What does "responsive design" mean?', choices: ['A site that loads instantly', 'A layout that adapts to the screen size', 'A site with live chat', 'A design that answers emails'], correct: 1, explanation: 'Responsive layouts adjust to phones, tablets and desktops.' },
    { text: 'Which JavaScript library is widely used for 3D graphics in the browser?', choices: ['Lodash', 'Express', 'Three.js', 'Jest'], correct: 2, explanation: 'Three.js wraps WebGL to make 3D scenes approachable.' },
    { text: 'The "rule of thirds" is a guideline mainly for what?', choices: ['Composition', 'File compression', 'Color printing', 'Font licensing'], correct: 0, explanation: 'It helps place subjects off-center for balanced compositions.' },
  ],
};
