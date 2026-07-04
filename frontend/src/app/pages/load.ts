import { Component, inject, signal } from '@angular/core';
import { Store } from '../core/store';
import { Api } from '../core/api';
import { toYaml } from '../core/yaml';

// Screen 1 — load / export the three portable files:
//  - config.yaml (the database)
//  - age key (import only, never persisted)
@Component({
  selector: 'page-load',
  standalone: true,
  template: `
  <section class="card">
    <h2>Configuration</h2>
    <p class="muted">Chargez votre <code>config.yaml</code> et votre clé age. Rien n'est stocké : un rafraîchissement efface tout.</p>

    <div class="row">
      <label class="file">
        <input type="file" accept=".yaml,.yml" (change)="onConfigFile($event)" hidden />
        <span>⤒ Importer config.yaml</span>
      </label>
      <label class="file">
        <input type="file" accept=".txt,.key,*" (change)="onKeyFile($event)" hidden />
        <span>🔑 Importer la clé age</span>
      </label>
      <button (click)="exportConfig()" [disabled]="!store.loaded()">⤓ Exporter config.yaml</button>
    </div>

    <div class="grid">
      <div>
        <h3>config.yaml</h3>
        <textarea [value]="store.configText()" (input)="onConfigText($event)" spellcheck="false"></textarea>
      </div>
      <div>
        <h3>Clé age (mémoire seule)</h3>
        <textarea [value]="store.ageKey()" (input)="onKeyText($event)" placeholder="AGE-SECRET-KEY-..." spellcheck="false"></textarea>
        <p class="status" [class.ok]="store.hasKey()">{{ store.hasKey() ? 'Clé chargée en mémoire' : 'Aucune clé' }}</p>
      </div>
    </div>

    @if (store.validationErrors().length) {
      <div class="errors">
        <strong>{{ store.validationErrors().length }} erreur(s) de validation :</strong>
        <ul>@for (e of store.validationErrors(); track e) {<li>{{ e }}</li>}</ul>
      </div>
    } @else if (store.loaded()) {
      <p class="status ok">Configuration valide · plateforme « {{ store.platformName() }} »</p>
    }
  </section>
  `,
  styles: [`
    .row { display:flex; gap:.75rem; flex-wrap:wrap; margin:1rem 0; }
    .grid { display:grid; grid-template-columns:2fr 1fr; gap:1rem; }
    textarea { width:100%; min-height:280px; font-family:monospace; font-size:.8rem; }
    .file span { display:inline-block; padding:.5rem .9rem; border:1px solid var(--line); border-radius:6px; cursor:pointer; }
    .errors { margin-top:1rem; padding:1rem; border-left:3px solid #e5484d; background:#2a1416; }
    .status.ok { color:#46c26a; } .status { color:#e5a04d; }
  `],
})
export class LoadPage {
  store = inject(Store);
  private api = inject(Api);
  busy = signal(false);

  async onConfigText(e: Event) {
    await this.applyConfig((e.target as HTMLTextAreaElement).value);
  }
  onKeyText(e: Event) { this.store.setAgeKey((e.target as HTMLTextAreaElement).value); }

  async onConfigFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) await this.applyConfig(await f.text());
  }
  async onKeyFile(e: Event) {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) this.store.setAgeKey((await f.text()).trim());
  }

  private async applyConfig(text: string) {
    try {
      const res = await this.api.validate(text);
      this.store.setConfig(text, res.config ?? null, res.errors ?? []);
    } catch (err: any) {
      this.store.setConfig(text, null, [String(err.message ?? err)]);
    }
  }

  exportConfig() {
    const cfg = this.store.config();
    if (!cfg) return;
    const blob = new Blob([toYaml(cfg)], { type: 'text/yaml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'config.yaml';
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
