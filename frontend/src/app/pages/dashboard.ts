import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../core/store';
import { Api } from '../core/api';
import { Application, CheckResult } from '../core/models';

// Screen 3 — dashboard: state / heartbeat per app, run with field prompts,
// live output. Checks run on a front-side timer while the tab is open.
@Component({
  selector: 'page-dashboard',
  standalone: true,
  imports: [FormsModule],
  template: `
  @if (!store.loaded()) {
    <p class="muted">Chargez d'abord une configuration.</p>
  } @else {
    <section class="card">
      <div class="head">
        <h2>{{ store.platformName() }}</h2>
        <div>
          <button (click)="checkNow()" [disabled]="busy()">↻ Vérifier maintenant</button>
          <label><input type="checkbox" [(ngModel)]="autoCheck" (change)="toggleAuto()" /> auto</label>
        </div>
      </div>
      <table>
        <thead><tr><th>Application</th><th>Node</th><th>Activée</th><th>État</th><th>Détail</th><th></th></tr></thead>
        <tbody>
          @for (a of apps(); track a.name) {
            <tr>
              <td><strong>{{ a.name }}</strong></td>
              <td>{{ a.node }}</td>
              <td><span class="dot" [class.on]="a.enabled"></span></td>
              <td><span class="badge" [attr.data-state]="state(a.name)?.state ?? '—'">{{ state(a.name)?.state ?? '—' }}</span></td>
              <td class="detail">{{ state(a.name)?.detail ?? '' }}</td>
              <td><button (click)="openRun(a)" [disabled]="!a.enabled">▶ Run</button></td>
            </tr>
          }
        </tbody>
      </table>
    </section>

    @if (runApp(); as a) {
      <section class="card modal">
        <div class="head"><h3>Lancer {{ a.name }}</h3><button (click)="closeRun()">✕</button></div>
        <p class="muted"><code>{{ a.command }}</code> @ {{ a.node }}</p>
        @for (f of textFields(a); track f.env) {
          <div class="app-row"><label>{{ f.label || f.env }}</label>
            <input [(ngModel)]="fieldValues[f.env]" [placeholder]="f.default || ''" /></div>
        }
        @for (f of secretFields(a); track f.env) {
          <div class="app-row"><label>{{ f.label || f.env }}</label>
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
    table { width:100%; border-collapse:collapse; margin-top:.75rem; }
    th, td { text-align:left; padding:.5rem; border-bottom:1px solid var(--line); font-size:.9rem; }
    .detail { color:var(--muted); font-family:monospace; font-size:.8rem; }
    .dot { display:inline-block; width:10px; height:10px; border-radius:50%; background:#555; }
    .dot.on { background:#46c26a; }
    .badge { padding:.1rem .5rem; border-radius:10px; background:#333; font-size:.75rem; }
    .badge[data-state=up] { background:#173e26; color:#46c26a; }
    .badge[data-state=down] { background:#3a1618; color:#e5484d; }
    .badge[data-state=error] { background:#3a2c14; color:#e5a04d; }
    .modal { border:1px solid var(--accent); }
    .app-row { display:flex; gap:.5rem; align-items:center; margin:.4rem 0; }
    .app-row label { width:180px; color:var(--muted); }
    .output { background:#0b0d10; padding:.75rem; border-radius:6px; min-height:120px; max-height:340px; overflow:auto; font-size:.8rem; white-space:pre-wrap; }
  `],
})
export class DashboardPage implements OnDestroy {
  store = inject(Store);
  private api = inject(Api);

  apps = computed<Application[]>(() => this.store.config()?.applications ?? []);
  results = signal<Record<string, CheckResult>>({});
  busy = signal(false);
  autoCheck = false;
  private timer: any = null;

  runApp = signal<Application | null>(null);
  fieldValues: Record<string, string> = {};
  output = signal('');
  running = signal(false);

  state(name: string) { return this.results()[name]; }
  textFields(a: Application) { return (a.fields ?? []).filter(f => f.type === 'text'); }
  secretFields(a: Application) { return (a.fields ?? []).filter(f => f.type === 'secret'); }

  async checkNow() {
    this.busy.set(true);
    try {
      const enabled = this.apps().filter(a => a.enabled).map(a => a.name);
      this.results.set(await this.api.check(this.store.configText(), this.store.ageKey(), enabled));
    } catch { /* surfaced as no result */ }
    finally { this.busy.set(false); }
  }

  toggleAuto() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (this.autoCheck) {
      const min = Math.min(...this.apps().filter(a => a.check?.enabled).map(a => a.check.periodSeconds ?? 60), 60);
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
