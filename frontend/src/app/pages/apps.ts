import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../core/store';
import { Api } from '../core/api';
import { Application, Field } from '../core/models';
import { toYaml } from '../core/yaml';

// Screen 2 — CRUD of applications (and their launch fields). Nodes and
// secrets are edited here too since they're small. Everything mutates the
// in-memory Config; export happens from the Load screen.
@Component({
  selector: 'page-apps',
  standalone: true,
  imports: [FormsModule],
  template: `
  @if (!store.loaded()) {
    <p class="muted">Chargez d'abord une configuration.</p>
  } @else {
    <div class="viewtoggle">
      <button [class.active]="view() === 'form'" (click)="showForm()">Formulaire</button>
      <button [class.active]="view() === 'code'" (click)="showCode()">&lt;/&gt; Code</button>
    </div>

    @if (view() === 'code') {
      <section class="card">
        <div class="head"><h3>config.yaml</h3><button (click)="applyCode()">Appliquer</button></div>
        <p class="muted">Éditez le YAML directement. « Appliquer » revalide et met à jour le formulaire.</p>
        <textarea class="codearea" [value]="codeText()" (input)="onCode($event)" spellcheck="false"></textarea>
        @if (codeError()) { <p class="status">{{ codeError() }}</p> }
      </section>
    } @else {
    <section class="card">
      <div class="head"><h2>Applications</h2><button (click)="addApp()">+ Application</button></div>
      @for (a of apps(); track a.name; let i = $index) {
        <div class="app">
          <div class="app-row">
            <input [(ngModel)]="a.name" placeholder="nom" />
            <select [(ngModel)]="a.node">
              @for (n of nodeNames(); track n) { <option [value]="n">{{ n }}</option> }
            </select>
            <input [(ngModel)]="a.command" placeholder="terraform apply" class="grow" />
            <button class="danger" (click)="removeApp(i)">✕</button>
          </div>
          <div class="app-row">
            <input [(ngModel)]="a.workdir" placeholder="workdir (/opt/infra)" />
            <label><input type="checkbox" [(ngModel)]="a.enabled" /> activée</label>
            <label><input type="checkbox" [(ngModel)]="a.check.enabled" /> check</label>
            @if (a.check.enabled) {
              <select [(ngModel)]="a.check.type">
                <option value="tcp">tcp</option><option value="command">command</option>
              </select>
              @if (a.check.type === 'command') { <input [(ngModel)]="a.check.run" placeholder="systemctl is-active x" class="grow" /> }
              <input type="number" [(ngModel)]="a.check.periodSeconds" placeholder="60" style="width:70px" />
            }
          </div>
          <div class="fields">
            <div class="fhead"><span>Champs de saisie</span><button (click)="addField(a)">+ champ</button></div>
            @for (f of a.fields ?? []; track $index; let j = $index) {
              <div class="app-row">
                <input [(ngModel)]="f.env" placeholder="TF_VAR_x" />
                <input [(ngModel)]="f.label" placeholder="libellé" />
                <select [(ngModel)]="f.type"><option value="text">text</option><option value="secret">secret</option></select>
                @if (f.type === 'secret') {
                  <select [(ngModel)]="f.secretRef">
                    @for (s of secretNames(); track s) { <option [value]="s">{{ s }}</option> }
                  </select>
                } @else {
                  <input [(ngModel)]="f.default" placeholder="valeur par défaut" />
                }
                <button class="danger" (click)="removeField(a, j)">✕</button>
              </div>
            }
          </div>
        </div>
      }
    </section>

    <section class="card">
      <div class="head"><h2>Nodes</h2><button (click)="addNode()">+ Node</button></div>
      @for (n of nodes(); track $index; let i = $index) {
        <div class="app-row">
          <input [(ngModel)]="n.name" placeholder="node-01" />
          <input [(ngModel)]="n.host" placeholder="10.0.0.5" />
          <input type="number" [(ngModel)]="n.port" placeholder="22" style="width:70px" />
          <input [(ngModel)]="n.user" placeholder="admin" />
          <select [(ngModel)]="n.auth.type"><option value="key">key</option><option value="password">password</option></select>
          <select [(ngModel)]="n.auth.secretRef">
            @for (s of secretNames(); track s) { <option [value]="s">{{ s }}</option> }
          </select>
          <button class="danger" (click)="removeNode(i)">✕</button>
        </div>
      }
    </section>

    <section class="card">
      <div class="head"><h2>Secrets</h2></div>
      <p class="muted">Le chiffrement se fait côté backend avec votre clé age (jamais persistée).</p>
      <div class="app-row">
        <input [(ngModel)]="newSecretName" placeholder="nom (tf_pass)" />
        <input [(ngModel)]="newSecretValue" type="password" placeholder="valeur en clair" class="grow" />
        <button (click)="encryptSecret()" [disabled]="!store.hasKey() || !newSecretName">🔒 Chiffrer</button>
      </div>
      @if (secretError()) { <p class="status">{{ secretError() }}</p> }
      <ul class="secrets">
        @for (s of secretNames(); track s) {
          <li><code>{{ s }}</code> <span class="muted">{{ isEncrypted(s) ? '· chiffré' : '· clair (non chiffré)' }}</span>
            <button class="danger small" (click)="removeSecret(s)">✕</button></li>
        }
      </ul>
    </section>
    }
  }
  `,
  styles: [`
    .head { display:flex; justify-content:space-between; align-items:center; }
    .viewtoggle { display:flex; gap:.4rem; margin-bottom:1rem; }
    .viewtoggle button { background:transparent; border:1px solid var(--line); color:var(--muted); }
    .viewtoggle button.active { background:var(--accent); border-color:var(--accent); color:#fff; }
    .codearea { width:100%; min-height:360px; font-family:monospace; font-size:.8rem; }
    .app { border:1px solid var(--line); border-radius:8px; padding:.75rem; margin:.75rem 0; }
    .app-row { display:flex; gap:.5rem; align-items:center; margin:.4rem 0; flex-wrap:wrap; }
    .app-row input, .app-row select { padding:.35rem .5rem; }
    .grow { flex:1; min-width:160px; }
    .fields { margin-top:.5rem; padding-top:.5rem; border-top:1px dashed var(--line); }
    .fhead { display:flex; justify-content:space-between; font-size:.85rem; color:var(--muted); }
    .danger { color:#e5484d; } .danger.small { padding:0 .4rem; }
    .secrets { list-style:none; padding:0; } .secrets li { padding:.25rem 0; }
    .status { color:#e5a04d; }
  `],
})
export class AppsPage {
  store = inject(Store);
  private api = inject(Api);

  newSecretName = '';
  newSecretValue = '';
  secretError = signal('');

  // Code ↔ Form toggle. Form is the default (friendly for non-technical
  // users); the code view exposes the raw YAML for power users.
  view = signal<'form' | 'code'>('form');
  codeText = signal('');
  codeError = signal('');

  showForm() { this.view.set('form'); }
  showCode() {
    const cfg = this.store.config();
    this.codeText.set(cfg ? toYaml(cfg) : this.store.configText());
    this.codeError.set('');
    this.view.set('code');
  }
  onCode(e: Event) { this.codeText.set((e.target as HTMLTextAreaElement).value); }

  async applyCode() {
    this.codeError.set('');
    try {
      const res = await this.api.validate(this.codeText());
      if (!res.config) { this.codeError.set((res.errors ?? ['YAML invalide']).join(' · ')); return; }
      this.store.setConfig(this.codeText(), res.config, res.errors ?? []);
      this.view.set('form');
    } catch (err: any) { this.codeError.set(String(err.message ?? err)); }
  }

  // All CRUD operates on the CURRENT project via the store, which rebuilds
  // references so the computed graph (and the board) update live. Field
  // edits via [(ngModel)] mutate the app objects in place; store.apps()
  // still reflects them since it returns those same objects.
  apps = computed<Application[]>(() => this.store.apps());
  nodes = computed(() => this.store.nodes());
  nodeNames = computed(() => this.nodes().map(n => n.name));
  secretNames = computed(() => Object.keys(this.store.secretsMap()));

  addApp() {
    const app: Application = { name: 'nouvelle-app', node: this.nodeNames()[0] ?? '', command: '', fields: [], check: { enabled: false }, enabled: true };
    this.store.setApps([...this.store.apps(), app]);
  }
  removeApp(i: number) { this.store.setApps(this.store.apps().filter((_, idx) => idx !== i)); }
  addField(a: Application) { this.store.setApps(this.store.apps().map(x => x === a ? { ...x, fields: [...(x.fields ?? []), { env: '', type: 'text' } as Field] } : x)); }
  removeField(a: Application, j: number) { this.store.setApps(this.store.apps().map(x => x === a ? { ...x, fields: (x.fields ?? []).filter((_, k) => k !== j) } : x)); }

  addNode() { this.store.setNodes([...this.store.nodes(), { name: 'node', host: '', port: 22, user: '', auth: { type: 'key', secretRef: '' } }]); }
  removeNode(i: number) { this.store.setNodes(this.store.nodes().filter((_, idx) => idx !== i)); }

  isEncrypted(name: string) { return (this.store.secretsMap()[name] ?? '').includes('BEGIN AGE ENCRYPTED FILE'); }
  removeSecret(name: string) { const s = { ...this.store.secretsMap() }; delete s[name]; this.store.setSecrets(s); }

  async encryptSecret() {
    this.secretError.set('');
    try {
      const { encrypted } = await this.api.encryptSecret(this.store.ageKey(), this.newSecretName, this.newSecretValue);
      this.store.setSecrets({ ...this.store.secretsMap(), [this.newSecretName]: encrypted });
      this.newSecretName = ''; this.newSecretValue = '';
    } catch (e: any) { this.secretError.set(String(e.message ?? e)); }
  }
}
