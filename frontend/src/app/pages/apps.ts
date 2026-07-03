import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '../core/store';
import { Api } from '../core/api';
import { Application, Field } from '../core/models';

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
  `,
  styles: [`
    .head { display:flex; justify-content:space-between; align-items:center; }
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

  apps = computed<Application[]>(() => this.store.config()?.applications ?? []);
  nodes = computed(() => this.store.config()?.nodes ?? []);
  nodeNames = computed(() => this.nodes().map(n => n.name));
  secretNames = computed(() => Object.keys(this.store.config()?.secrets ?? {}));

  private touch() { this.store.config.set({ ...this.store.config()! }); }

  addApp() {
    const c = this.store.config()!;
    c.applications.push({ name: 'nouvelle-app', node: this.nodeNames()[0] ?? '', command: '', fields: [], check: { enabled: false }, enabled: true });
    this.touch();
  }
  removeApp(i: number) { this.store.config()!.applications.splice(i, 1); this.touch(); }
  addField(a: Application) { (a.fields ??= []).push({ env: '', type: 'text' } as Field); this.touch(); }
  removeField(a: Application, j: number) { a.fields!.splice(j, 1); this.touch(); }

  addNode() { this.store.config()!.nodes.push({ name: 'node', host: '', port: 22, user: '', auth: { type: 'key', secretRef: '' } }); this.touch(); }
  removeNode(i: number) { this.store.config()!.nodes.splice(i, 1); this.touch(); }

  isEncrypted(name: string) { return (this.store.config()?.secrets[name] ?? '').includes('BEGIN AGE ENCRYPTED FILE'); }
  removeSecret(name: string) { delete this.store.config()!.secrets[name]; this.touch(); }

  async encryptSecret() {
    this.secretError.set('');
    try {
      const { encrypted } = await this.api.encryptSecret(this.store.ageKey(), this.newSecretName, this.newSecretValue);
      this.store.config()!.secrets[this.newSecretName] = encrypted;
      this.newSecretName = ''; this.newSecretValue = '';
      this.touch();
    } catch (e: any) { this.secretError.set(String(e.message ?? e)); }
  }
}
