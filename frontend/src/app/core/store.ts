import { Injectable, signal, computed } from '@angular/core';
import { Application, Config, Node, Project } from './models';
import { toYaml } from './yaml';

// In-memory only. Nothing is persisted: the config text and the age key
// live in signals for the lifetime of the tab. A refresh wipes them, which
// is the intended stateless behaviour.
//
// The store is the single place that mutates the config. Every mutation
// rebuilds the affected objects with fresh references (so the computed
// graph recomputes) and re-serialises configText, keeping the raw YAML in
// sync for run/check/export.
@Injectable({ providedIn: 'root' })
export class Store {
  readonly configText = signal<string>('');
  readonly config = signal<Config | null>(null);
  readonly ageKey = signal<string>('');
  readonly validationErrors = signal<string[]>([]);
  readonly currentProject = signal<number>(0);

  readonly projects = computed<Project[]>(() => this.config()?.projects ?? []);
  readonly projectNames = computed(() => this.projects().map(p => p.name));
  readonly project = computed<Project | null>(() => {
    const ps = this.projects();
    if (!ps.length) return null;
    return ps[Math.min(this.currentProject(), ps.length - 1)] ?? null;
  });
  readonly apps = computed<Application[]>(() => this.project()?.applications ?? []);
  readonly nodes = computed<Node[]>(() => this.project()?.nodes ?? []);
  readonly secretsMap = computed<Record<string, string>>(() => this.config()?.secrets ?? {});

  readonly platformName = computed(() => this.project()?.name ?? 'Launcher Console');
  readonly hasKey = computed(() => this.ageKey().trim().length > 0);
  readonly loaded = computed(() => this.projects().length > 0);

  // Live serialization of the current config — always reflects form edits.
  // Used for run/check/export so those never rely on a stale text buffer.
  readonly yaml = computed(() => { const c = this.config(); return c ? toYaml(c) : ''; });

  setConfig(text: string, parsed: Config | null, errors: string[]) {
    this.configText.set(text);
    this.config.set(parsed);
    this.validationErrors.set(errors);
    const n = parsed?.projects?.length ?? 0;
    if (this.currentProject() >= n) this.currentProject.set(0);
  }

  setAgeKey(k: string) { this.ageKey.set(k); }
  switchProject(i: number) { this.currentProject.set(i); }

  // commit sets config with a fresh reference so computed chains recompute.
  // configText is left as the import buffer; execution/export use yaml().
  private commit(c: Config) {
    this.config.set(c);
  }

  private patchProject(fn: (p: Project) => Project) {
    const c = this.config();
    if (!c) return;
    const i = this.currentProject();
    this.commit({ ...c, projects: c.projects.map((p, idx) => (idx === i ? fn(p) : p)) });
  }

  setApps(apps: Application[]) { this.patchProject(p => ({ ...p, applications: apps })); }
  setNodes(nodes: Node[]) { this.patchProject(p => ({ ...p, nodes })); }
  renameCurrentProject(name: string) { this.patchProject(p => ({ ...p, name })); }

  setSecrets(secrets: Record<string, string>) {
    const c = this.config();
    if (!c) return;
    this.commit({ ...c, secrets });
  }

  addProject() {
    const c = this.config();
    if (!c) return;
    const name = 'nouveau-projet-' + (c.projects.length + 1);
    this.commit({ ...c, projects: [...c.projects, { name, nodes: [], applications: [] }] });
    this.currentProject.set(c.projects.length);
  }

  deleteCurrentProject() {
    const c = this.config();
    if (!c || c.projects.length <= 1) return;
    const i = this.currentProject();
    this.commit({ ...c, projects: c.projects.filter((_, idx) => idx !== i) });
    this.currentProject.set(Math.max(0, i - 1));
  }

  reset() {
    this.configText.set('');
    this.config.set(null);
    this.ageKey.set('');
    this.validationErrors.set([]);
    this.currentProject.set(0);
  }
}
