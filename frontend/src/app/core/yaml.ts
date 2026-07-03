import { Config } from './models';

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
  lines.push('platform:');
  lines.push(`  name: ${q(c.platform?.name ?? '')}`);

  lines.push('nodes:');
  for (const n of c.nodes ?? []) {
    lines.push(`  - name: ${q(n.name)}`);
    lines.push(`    host: ${q(n.host)}`);
    if (n.port) lines.push(`    port: ${n.port}`);
    lines.push(`    user: ${q(n.user)}`);
    lines.push(`    auth: { type: ${n.auth.type}, secretRef: ${q(n.auth.secretRef)} }`);
  }

  lines.push('applications:');
  for (const a of c.applications ?? []) {
    lines.push(`  - name: ${q(a.name)}`);
    lines.push(`    node: ${q(a.node)}`);
    if (a.workdir) lines.push(`    workdir: ${q(a.workdir)}`);
    lines.push(`    command: ${q(a.command)}`);
    if (a.fields?.length) {
      lines.push('    fields:');
      for (const f of a.fields) {
        const parts = [`env: ${f.env}`, `type: ${f.type}`];
        if (f.label) parts.push(`label: ${q(f.label)}`);
        if (f.secretRef) parts.push(`secretRef: ${q(f.secretRef)}`);
        if (f.default) parts.push(`default: ${q(f.default)}`);
        lines.push(`      - { ${parts.join(', ')} }`);
      }
    }
    const ch = a.check;
    if (ch?.enabled) {
      lines.push(`    check: { enabled: true, type: ${ch.type}, run: ${q(ch.run ?? '')}, periodSeconds: ${ch.periodSeconds ?? 60} }`);
    } else {
      lines.push('    check: { enabled: false }');
    }
    lines.push(`    enabled: ${a.enabled}`);
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
