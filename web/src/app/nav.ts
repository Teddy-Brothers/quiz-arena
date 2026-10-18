import { Component, Input } from '@angular/core';

interface Site { id: string; name: string; url: string; }

// Each POC is its own app/repo. URLs point at the local dev ports; replace
// with deployed URLs when hosting.
const SITES: Site[] = [
  { id: 'tour', name: 'Studio Tour', url: 'http://localhost:4204' },
  { id: 'quiz', name: 'Quiz Arena', url: 'http://localhost:4205' },
  { id: 'insight', name: 'Insight Lab', url: 'http://localhost:4201' },
  { id: 'openloop', name: 'OpenLoop', url: 'http://localhost:4202' },
  { id: 'speclens', name: 'SpecLens', url: 'http://localhost:4203' },
];

@Component({
  selector: 'app-nav',
  template: `
    <header class="bar">
      <div class="wrap inner">
        <span class="brand">Teddy Brother Studio</span>
        <nav aria-label="Projects" class="seg">
          @for (s of sites; track s.id) {
            <a [href]="s.url" [class.active]="s.id === current" [attr.aria-current]="s.id === current ? 'page' : null">{{ s.name }}</a>
          }
        </nav>
      </div>
    </header>
  `,
  styles: `
    .bar { position: sticky; top: 0; z-index: 10; background: var(--glass); border-bottom: 1px solid var(--line); }
    @supports (backdrop-filter: blur(1px)) {
      @media (prefers-reduced-transparency: no-preference) { .bar { backdrop-filter: saturate(180%) blur(20px); } }
    }
    .inner { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; padding-top: 8px; padding-bottom: 8px; }
    .brand { font-weight: 600; font-size: 0.9375rem; }
    .seg { display: flex; flex-wrap: wrap; gap: 2px; padding: 2px; border-radius: 10px; background: var(--fill); }
    .seg a { text-decoration: none; color: var(--ink); font-size: 0.8125rem; font-weight: 500; padding: 6px 14px; min-height: 32px; display: flex; align-items: center; border-radius: 8px; }
    @media (pointer: coarse) { .seg a { min-height: 44px; } }
    .seg a.active { background: var(--surface); font-weight: 600; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2); }
    @media (max-width: 520px) { .brand { display: none; } .seg { width: 100%; } .seg a { flex: 1; justify-content: center; padding: 6px 2px; font-size: 0.72rem; white-space: nowrap; } }
  `,
})
export class Nav {
  @Input() current = '';
  sites = SITES;
}
