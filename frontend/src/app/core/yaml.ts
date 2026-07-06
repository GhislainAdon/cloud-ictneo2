import { Application, Config, Node } from './models';

// Minimal YAML emitter tailored to our Config shape. We avoid pulling a
// full YAML lib into the bundle; the backend remains the source of truth
// for parsing. Only used for EXPORT (object -> text).
export function toYaml(c: Config): string {
  const q = (s: string) => {
    if (s === '' || /[:#\-?*&!|>'"%@`{}\[\],]/.test(s) || /^\s|\s$/.test(s)) {
      return JSON.stringify(s);
    }
    return s;
  };
  const lines: string[] = [];

  if (c.platform?.name) {
    lines.push('platform:');
    lines.push(`  name: ${q(c.platform.name)}`);
  }

  // Nodes/apps live under each project, indented two extra spaces.
  const nodeLines = (n: Node, pad: string) => {
    lines.push(`${pad}- name: ${q(n.name)}`);
    lines.push(`${pad}  host: ${q(n.host)}`);
    if (n.port) lines.push(`${pad}  port: ${n.port}`);
    lines.push(`${pad}  user: ${q(n.user)}`);
    lines.push(`${pad}  auth: { type: ${n.auth.type}, secretRef: ${q(n.auth.secretRef)} }`);
  };

  const appLines = (a: Application, pad: string) => {
    lines.push(`${pad}- name: ${q(a.name)}`);
    lines.push(`${pad}  node: ${q(a.node)}`);
    if (a.workdir) lines.push(`${pad}  workdir: ${q(a.workdir)}`);
    lines.push(`${pad}  command: ${q(a.command)}`);
    if (a.fields?.length) {
      lines.push(`${pad}  fields:`);
      for (const f of a.fields) {
        const parts = [`env: ${f.env}`, `type: ${f.type}`];
        if (f.label) parts.push(`label: ${q(f.label)}`);
        if (f.secretRef) parts.push(`secretRef: ${q(f.secretRef)}`);
        if (f.default) parts.push(`default: ${q(f.default)}`);
        lines.push(`${pad}    - { ${parts.join(', ')} }`);
      }
    }
    const ch = a.check;
    if (ch?.enabled) {
      lines.push(`${pad}  check: { enabled: true, type: ${ch.type}, run: ${q(ch.run ?? '')}, periodSeconds: ${ch.periodSeconds ?? 60} }`);
    } else {
      lines.push(`${pad}  check: { enabled: false }`);
    }
    lines.push(`${pad}  enabled: ${a.enabled}`);
    if (a.tile && (a.tile.x != null || a.tile.icon || a.tile.color || a.tile.w || a.tile.h)) {
      const t = a.tile;
      const parts: string[] = [];
      if (t.x != null) parts.push(`x: ${t.x}`);
      if (t.y != null) parts.push(`y: ${t.y}`);
      if (t.w && t.w !== 1) parts.push(`w: ${t.w}`);
      if (t.h && t.h !== 1) parts.push(`h: ${t.h}`);
      if (t.icon) parts.push(`icon: ${q(t.icon)}`);
      if (t.color) parts.push(`color: ${q(t.color)}`);
      lines.push(`${pad}  tile: { ${parts.join(', ')} }`);
    }
  };

  lines.push('projects:');
  for (const p of c.projects ?? []) {
    lines.push(`  - name: ${q(p.name)}`);
    lines.push('    nodes:');
    for (const n of p.nodes ?? []) nodeLines(n, '      ');
    lines.push('    applications:');
    for (const a of p.applications ?? []) appLines(a, '      ');
  }

  lines.push('secrets:');
  for (const [k, v] of Object.entries(c.secrets ?? {})) {
    if (v.includes('\n')) {
      lines.push(`  ${k}: |`);
      for (const l of v.split('\n')) lines.push(`    ${l}`);
    } else {
      lines.push(`  ${k}: ${q(v)}`);
    }
  }
  return lines.join('\n') + '\n';
}
