import { Component, HostListener, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Store } from '../core/store';
import { Api } from '../core/api';
import { Application, CheckResult } from '../core/models';

// Home screen — homarr-inspired tile board. Each tile is an application:
// drag it to reposition (position persisted in the YAML `tile` block),
// see its heartbeat, and run it with live output. Absorbs the old
// Dashboard (checks + run modal + SSE). Data model stays a flat list; the
// grid is just presentation.

const COLS = 4;

interface Placed { app: Application; x: number; y: number; icon: string; color: string; }

@Component({
  selector: 'page-board',
  standalone: true,
  imports: [FormsModule, RouterLink],
  template: `
  @if (!store.loaded()) {
    <section class="card empty">
      <p class="muted">Aucune configuration chargée.</p>
      <a routerLink="/load"><button>Aller à Configuration</button></a>
    </section>
  } @else {
    <section class="card">
      <div class="head">
        <h2>{{ store.platformName() }}</h2>
        <div>
          <button (click)="checkNow()" [disabled]="busy()">↻ Vérifier</button>
          <label class="auto"><input type="checkbox" [(ngModel)]="autoCheck" (change)="toggleAuto()" /> auto</label>
        </div>
      </div>
      <p class="hint muted">Glissez une tuile pour la repositionner. La disposition est sauvegardée à l'export.</p>

      <div class="board" [style.gridTemplateColumns]="'repeat(' + cols + ', 1fr)'" [style.gridTemplateRows]="'repeat(' + rows() + ', 132px)'">
        @for (c of cells(); track c.k) {
          <div class="cell" [class.over]="overCell() === c.x + ',' + c.y"
               [attr.data-x]="c.x" [attr.data-y]="c.y"
               [style.gridColumn]="c.x + 1" [style.gridRow]="c.y + 1"></div>
        }
        @for (t of tiles(); track t.app.name) {
          <div class="tile" [class.off]="!t.app.enabled" [class.dragging]="dragging() === t.app.name"
               [attr.data-x]="t.x" [attr.data-y]="t.y"
               [style.gridColumn]="t.x + 1" [style.gridRow]="t.y + 1"
               [style.borderLeft]="'3px solid ' + colorVar(t.color)"
               (pointerdown)="startDrag($event, t.app.name)">
            <div class="trow">
              <span class="ico">{{ t.icon }}</span>
              <span class="state" [attr.data-state]="state(t.app.name)?.state ?? '—'">
                <span class="dot"></span>{{ state(t.app.name)?.state ?? '—' }}
              </span>
            </div>
            <p class="name">{{ t.app.name }}</p>
            <p class="cmd">{{ t.app.command }}</p>
            <div class="trow foot">
              <span class="node">⛁ {{ t.app.node }}</span>
              @if (t.app.enabled) {
                <button class="run" (click)="openRun(t.app)">▶ run</button>
              }
            </div>
          </div>
        }
      </div>
    </section>

    @if (runApp(); as a) {
      <section class="card modal">
        <div class="head"><h3>Lancer {{ a.name }}</h3><button (click)="closeRun()">✕</button></div>
        <p class="muted"><code>{{ a.command }}</code> @ {{ a.node }}</p>
        @for (f of textFields(a); track f.env) {
          <div class="frow"><label>{{ f.label || f.env }}</label>
            <input [(ngModel)]="fieldValues[f.env]" [placeholder]="f.default || ''" /></div>
        }
        @for (f of secretFields(a); track f.env) {
          <div class="frow"><label>{{ f.label || f.env }}</label>
            <input value="•••••• (secret {{ f.secretRef }})" disabled /></div>
        }
        <button (click)="launch(a)" [disabled]="running() || !store.hasKey()">
          {{ running() ? 'En cours…' : (store.hasKey() ? 'Exécuter' : 'clé age requise') }}
        </button>
        <pre class="output">{{ output() }}</pre>
      </section>
    }
  }
  `,
  styles: [`
    .head { display:flex; justify-content:space-between; align-items:center; }
    .auto { margin-left:.5rem; font-size:.85rem; color:var(--muted); }
    .hint { font-size:.8rem; margin:.25rem 0 1rem; }
    .board { display:grid; gap:12px; }
    .cell { border:1px dashed transparent; border-radius:12px; }
    .cell.over { border-color:var(--accent); background:rgba(76,141,255,.08); }
    .tile { background:var(--bg); border:1px solid var(--line); border-radius:12px; padding:12px; cursor:grab; display:flex; flex-direction:column; touch-action:none; user-select:none; }
    .tile:active { cursor:grabbing; }
    .tile.off { opacity:.5; }
    .tile.dragging { opacity:.35; pointer-events:none; }
    .trow { display:flex; align-items:center; justify-content:space-between; }
    .ico { font-size:22px; line-height:1; }
    .name { margin:.4rem 0 0; font-weight:600; font-size:.95rem; }
    .cmd { margin:.15rem 0 0; font-family:monospace; font-size:.72rem; color:var(--muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .foot { margin-top:auto; padding-top:.6rem; }
    .node { font-size:.72rem; color:var(--muted); }
    .run { padding:.2rem .6rem; font-size:.78rem; }
    .state { display:inline-flex; align-items:center; gap:.3rem; font-size:.72rem; color:var(--muted); }
    .state .dot { width:8px; height:8px; border-radius:50%; background:#555; }
    .state[data-state=up] { color:#46c26a; } .state[data-state=up] .dot { background:#46c26a; }
    .state[data-state=down] { color:#e5484d; } .state[data-state=down] .dot { background:#e5484d; }
    .state[data-state=error] { color:#e5a04d; } .state[data-state=error] .dot { background:#e5a04d; }
    .empty { text-align:center; padding:2.5rem; } .empty .muted { margin:.5rem 0 1rem; }
    .modal { border:1px solid var(--accent); }
    .frow { display:flex; gap:.5rem; align-items:center; margin:.4rem 0; }
    .frow label { width:180px; color:var(--muted); }
    .output { background:#0b0d10; padding:.75rem; border-radius:6px; min-height:120px; max-height:340px; overflow:auto; font-size:.8rem; white-space:pre-wrap; }
  `],
})
export class BoardPage implements OnDestroy {
  store = inject(Store);
  private api = inject(Api);
  readonly cols = COLS;

  apps = computed<Application[]>(() => this.store.config()?.applications ?? []);
  results = signal<Record<string, CheckResult>>({});
  busy = signal(false);
  autoCheck = false;
  private timer: any = null;
  dragging = signal<string | null>(null);
  overCell = signal<string>('');

  runApp = signal<Application | null>(null);
  fieldValues: Record<string, string> = {};
  output = signal('');
  running = signal(false);

  // Pure layout: explicit tiles keep their x/y; the rest fill free cells
  // row-major. No mutation here — dragging materializes a tile.
  private layout = computed<Placed[]>(() => {
    const apps = this.apps();
    const occupied = new Set<string>();
    apps.forEach(a => { if (a.tile) occupied.add(a.tile.x + ',' + a.tile.y); });
    let cursor = 0;
    const nextFree = () => {
      for (;;) {
        const x = cursor % COLS, y = Math.floor(cursor / COLS);
        cursor++;
        if (!occupied.has(x + ',' + y)) { occupied.add(x + ',' + y); return { x, y }; }
      }
    };
    return apps.map(a => {
      const pos = a.tile ? { x: a.tile.x, y: a.tile.y } : nextFree();
      return { app: a, x: pos.x, y: pos.y, icon: a.tile?.icon || defaultIcon(a), color: a.tile?.color || 'accent' };
    });
  });

  tiles = computed(() => this.layout());
  rows = computed(() => Math.max(2, ...this.layout().map(p => p.y + 1)) + 1);
  cells = computed(() => {
    const out: { x: number; y: number; k: string }[] = [];
    for (let y = 0; y < this.rows(); y++)
      for (let x = 0; x < COLS; x++) out.push({ x, y, k: x + '-' + y });
    return out;
  });

  colorVar(c: string) {
    const map: Record<string, string> = { accent: 'var(--accent)', blue: '#4c8dff', green: '#46c26a', amber: '#e5a04d', red: '#e5484d', purple: '#8a5cf6' };
    return map[c] ?? 'var(--accent)';
  }

  state(name: string) { return this.results()[name]; }
  textFields(a: Application) { return (a.fields ?? []).filter(f => f.type === 'text'); }
  secretFields(a: Application) { return (a.fields ?? []).filter(f => f.type === 'secret'); }

  // Pointer-based dragging — reliable, testable, and works on touch
  // (native HTML5 draggable does none of these). pointerdown starts;
  // window pointermove/up (below) track and drop.
  startDrag(e: PointerEvent, name: string) {
    if ((e.target as HTMLElement).closest('button')) return; // let Run click through
    e.preventDefault();
    this.dragging.set(name);
  }

  @HostListener('window:pointermove', ['$event'])
  onPointerMove(e: PointerEvent) {
    if (!this.dragging()) return;
    const host = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-x]');
    if (host) this.overCell.set(host.getAttribute('data-x') + ',' + host.getAttribute('data-y'));
  }

  @HostListener('window:pointerup', ['$event'])
  onPointerUp(e: PointerEvent) {
    const name = this.dragging();
    if (!name) return;
    const host = document.elementFromPoint(e.clientX, e.clientY)?.closest('[data-x]');
    if (host) this.placeAt(name, +host.getAttribute('data-x')!, +host.getAttribute('data-y')!);
    this.dragging.set(null);
    this.overCell.set('');
  }

  // placeAt moves the dragged app to (x,y), swapping with whatever tile is
  // already there. The new position lives in the config -> exported YAML.
  // Builds a NEW applications array + new app objects so the computed
  // chain (apps -> layout) recomputes and the board updates live — an
  // in-place mutation + {...cfg} keeps the same array ref and is memoized
  // away by the signal graph.
  placeAt(name: string, x: number, y: number) {
    const cfg = this.store.config()!;
    const lay = this.layout();
    const src = lay.find(p => p.app.name === name);
    if (!src || (src.x === x && src.y === y)) return;
    const dst = lay.find(p => p.x === x && p.y === y && p.app !== src.app);
    const apps = cfg.applications.map(a => {
      if (a === src.app) return { ...a, tile: { ...(a.tile ?? {}), x, y } };
      if (dst && a === dst.app) return { ...a, tile: { ...(a.tile ?? {}), x: src.x, y: src.y } };
      return a;
    });
    this.store.config.set({ ...cfg, applications: apps });
  }

  async checkNow() {
    this.busy.set(true);
    try {
      const enabled = this.apps().filter(a => a.enabled).map(a => a.name);
      this.results.set(await this.api.check(this.store.configText(), this.store.ageKey(), enabled));
    } catch { /* no result */ }
    finally { this.busy.set(false); }
  }

  toggleAuto() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.autoCheck) {
      const periods = this.apps().filter(a => a.check?.enabled).map(a => a.check.periodSeconds ?? 60);
      const min = periods.length ? Math.min(...periods) : 60;
      this.timer = setInterval(() => this.checkNow(), Math.max(min, 5) * 1000);
      this.checkNow();
    }
  }

  openRun(a: Application) {
    this.runApp.set(a);
    this.fieldValues = {};
    for (const f of this.textFields(a)) this.fieldValues[f.env] = f.default ?? '';
    this.output.set('');
  }
  closeRun() { this.runApp.set(null); }

  async launch(a: Application) {
    this.running.set(true);
    this.output.set('');
    try {
      await this.api.run(
        { config: this.store.configText(), ageKey: this.store.ageKey(), app: a.name, fields: this.fieldValues },
        (event, data) => {
          if (event === 'output') this.output.update(o => o + data + '\n');
          else if (event === 'error') this.output.update(o => o + '⚠ ' + data + '\n');
          else if (event === 'exit') this.output.update(o => o + `\n— exit ${data} —\n`);
        },
      );
    } catch (e: any) {
      this.output.update(o => o + '⚠ ' + String(e.message ?? e) + '\n');
    } finally { this.running.set(false); }
  }

  ngOnDestroy() { if (this.timer) clearInterval(this.timer); }
}

// Emoji chosen from the command so tiles have a glyph without any icon
// webfont (keeps the app self-contained / offline). tile.icon overrides.
function defaultIcon(a: Application): string {
  const c = (a.command || '').toLowerCase();
  if (c.includes('terraform')) return '🌍';
  if (c.includes('ansible')) return '⚙️';
  if (c.includes('docker') || c.includes('kubectl')) return '📦';
  if (c.includes('backup') || c.includes('dump')) return '💾';
  if (c.includes('deploy')) return '🚀';
  if (c.includes('restart') || c.includes('systemctl')) return '🔄';
  return '⌨️';
}
