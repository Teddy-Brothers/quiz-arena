import { Component, ElementRef, OnDestroy, ViewChild, computed, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { Nav } from './nav';
import { aiLabel, callAi } from './ai';
import { Pack, Phase, QuizHost, QuizPlayer, SAMPLE_PACK, StateMsg, apiReachable, makeTransport, newCode } from './engine';
import { PodiumScene } from './podium';

type View = 'home' | 'setup' | 'host' | 'join' | 'player' | 'solo';
type Mode = 'local' | 'network';

@Component({
  selector: 'app-root',
  imports: [Nav, NgTemplateOutlet],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App implements OnDestroy {
  protected view = signal<View>('home');
  protected mode = signal<Mode>('local');
  protected error = signal('');
  protected busy = signal(false);

  // pack + AI generation
  protected pack = signal<Pack>(SAMPLE_PACK);
  protected packLabel = signal('Built-in sample pack, written for this demo');
  protected topic = signal('');
  protected genBusy = signal(false);
  protected genError = signal('');

  // host side
  private host: QuizHost | null = null;
  protected hostState = signal<StateMsg | null>(null);
  protected hostCode = signal('');
  private hostStateAt = 0;

  // player side (also used by the solo demo)
  private player: QuizPlayer | null = null;
  protected playerState = signal<StateMsg | null>(null);
  protected playerName = signal('');
  protected joinCode = signal('');
  protected myChoice = signal<number | null>(null);
  protected myQ = -1;
  private playerStateAt = 0;

  protected now = signal(performance.now());
  private ticker = setInterval(() => this.now.set(performance.now()), 200);

  protected readonly shapes = ['▲', '◆', '●', '■'];
  protected readonly letters = ['A', 'B', 'C', 'D'];

  // podium (3D)
  private podium: PodiumScene | null = null;
  private podiumEl: ElementRef<HTMLCanvasElement> | null = null;
  @ViewChild('podiumCanvas') set podiumRef(el: ElementRef<HTMLCanvasElement> | undefined) {
    this.podiumEl = el ?? null;
    if (!el) { this.podium?.dispose(); this.podium = null; return; }
    if (!this.podium) this.buildPodium();
  }
  protected webglOk = signal(true);

  protected readonly hostRemaining = computed(() => this.remaining(this.hostState(), this.hostStateAt));
  protected readonly playerRemaining = computed(() => this.remaining(this.playerState(), this.playerStateAt));
  protected readonly myInfo = computed(() => this.playerState()?.players.find((p) => p.id === this.player?.id) ?? null);
  protected readonly myRank = computed(() => { const s = this.playerState(); return s ? s.players.findIndex((p) => p.id === this.player?.id) + 1 : 0; });
  protected readonly hostAnswered = computed(() => { this.hostState(); return this.host?.answeredCount() ?? 0; });

  private remaining(s: StateMsg | null, at: number): number {
    if (!s || s.phase !== 'question') return 0;
    return Math.max(0, s.remainingMs - (this.now() - at));
  }
  protected pct(ms: number, limit: number) { return limit ? Math.max(0, Math.min(100, (ms / limit) * 100)) : 0; }
  protected secs(ms: number) { return Math.ceil(ms / 1000); }
  protected barPct(n: number, counts: number[]) { const m = Math.max(1, ...counts); return (n / m) * 100; }
  protected phaseOf(s: StateMsg | null): Phase | null { return s ? s.phase : null; }

  ngOnDestroy() { clearInterval(this.ticker); this.leave(); }

  // ---- navigation -----------------------------------------------------------------
  protected go(v: View) { this.error.set(''); this.view.set(v); }
  protected setMode(m: Mode) { this.mode.set(m); this.error.set(''); }
  protected setTopic(ev: Event) { this.topic.set((ev.target as HTMLInputElement).value); }
  protected setName(ev: Event) { this.playerName.set((ev.target as HTMLInputElement).value); }
  protected setJoin(ev: Event) { this.joinCode.set((ev.target as HTMLInputElement).value.toUpperCase()); }

  protected leave() {
    this.host?.close(); this.host = null; this.hostState.set(null);
    this.player?.close(); this.player = null; this.playerState.set(null);
    this.myChoice.set(null); this.myQ = -1;
    this.view.set('home');
  }

  // ---- AI question generation (optional) ---------------------------------------------
  protected async generate() {
    const topic = this.topic().trim();
    if (!topic) return;
    this.genBusy.set(true); this.genError.set('');
    const out = await callAi<{ questions: Pack['questions'] }>('generate', { topic, count: 5 });
    this.genBusy.set(false);
    if (!out.ok) { this.genError.set(out.error); return; }
    this.pack.set({ title: `${topic} (generated)`, questions: out.result.questions });
    this.packLabel.set(`Questions from ${aiLabel(out.meta)}. Review before playing.`);
  }
  protected useSample() { this.pack.set(SAMPLE_PACK); this.packLabel.set('Built-in sample pack, written for this demo'); }

  // ---- host ---------------------------------------------------------------------------
  protected async createRoom(solo = false) {
    this.error.set(''); this.busy.set(true);
    if (this.mode() === 'network' && !(await apiReachable())) {
      this.busy.set(false); this.error.set('Network mode needs the Node API. Start it with "npm start" in the api folder, or use "This browser".');
      return;
    }
    const code = newCode();
    this.hostCode.set(code);
    this.host = new QuizHost(code, this.pack(), makeTransport(this.mode(), code), (s) => { this.hostStateAt = performance.now(); this.hostState.set(s); });
    this.host.broadcast();
    if (solo) {
      this.joinAs(code, 'You');
      this.host.addBots(3);
      this.view.set('solo');
    } else this.view.set('host');
    this.busy.set(false);
  }
  protected addBots() { this.host?.addBots(3); }
  protected start() { this.host?.start(); }
  protected next() { this.host?.next(); }
  protected skip() { this.host?.skipToReveal(); }

  // ---- player -------------------------------------------------------------------------
  private joinAs(code: string, name: string) {
    this.player = new QuizPlayer(name, makeTransport(this.mode(), code), (s) => {
      this.playerStateAt = performance.now();
      if (s.qIndex !== this.myQ) { this.myQ = s.qIndex; this.myChoice.set(null); }
      this.playerState.set(s);
    });
  }

  protected async join() {
    const code = this.joinCode().trim(), name = this.playerName().trim();
    if (code.length < 4 || !name) { this.error.set('Enter the room code and a nickname.'); return; }
    if (this.mode() === 'network' && !(await apiReachable())) { this.error.set('Network mode needs the Node API to be running.'); return; }
    this.error.set('');
    this.joinAs(code.toUpperCase(), name);
    this.view.set('player');
  }

  protected choose(i: number) {
    const s = this.playerState();
    if (!s || s.phase !== 'question' || this.myChoice() !== null) return;
    this.myChoice.set(i);
    this.player?.answer(s.qIndex, i);
  }

  // ---- podium -------------------------------------------------------------------------
  private buildPodium() {
    const s = this.hostState() ?? this.playerState();
    if (!this.podiumEl || !s) return;
    try {
      const style = getComputedStyle(document.documentElement);
      this.podium = new PodiumScene(this.podiumEl.nativeElement, s.players.slice(0, 3).map((p) => ({ name: p.name, score: p.score })),
        style.getPropertyValue('--accent').trim() || '#b4236c', matchMedia('(prefers-color-scheme: dark)').matches);
    } catch { this.webglOk.set(false); }
  }
}
