import { Component, computed, inject } from '@angular/core';
import { Store } from '../core/store';

// Read-only topology map: applications → nodes, and both → the secrets
// they reference. This is NOT an editor and NOT an n8n-style flow (the
// data model is a flat list, not a DAG). It just answers "what runs
// where, and which secret feeds what" at a glance.

interface Box { id: string; label: string; sub: string; x: number; y: number; kind: string; }
interface Edge { x1: number; y1: number; x2: number; y2: number; }

const COL = { app: 60, node: 380, secret: 700 };
const BOX_W = 200;
const BOX_H = 48;
const GAP = 20;

@Component({
  selector: 'page-graph',
  standalone: true,
  template: `
  @if (!store.loaded()) {
    <p class="muted">Chargez d'abord une configuration.</p>
  } @else {
    <section class="card">
      <div class="head">
        <h2>Topologie</h2>
        <div class="legend">
          <span><i class="sw app"></i> application</span>
          <span><i class="sw node"></i> node</span>
          <span><i class="sw secret"></i> secret chiffré</span>
          <span><i class="sw plain"></i> secret en clair</span>
        </div>
      </div>
      <p class="muted">Vue lecture seule : quelle application tourne sur quel node, et quels secrets sont utilisés.</p>
      <svg [attr.viewBox]="'0 0 920 ' + height()" width="100%" [attr.height]="height()" role="img" aria-label="carte de topologie">
        @for (e of edges(); track $index) {
          <line [attr.x1]="e.x1" [attr.y1]="e.y1" [attr.x2]="e.x2" [attr.y2]="e.y2" class="edge" />
        }
        @for (b of boxes(); track b.id) {
          <g [attr.transform]="'translate(' + b.x + ',' + b.y + ')'">
            <rect [attr.width]="boxW" [attr.height]="boxH" rx="8" [attr.class]="'box ' + b.kind" />
            <text [attr.x]="boxW/2" y="20" class="lbl">{{ b.label }}</text>
            <text [attr.x]="boxW/2" y="36" class="sub">{{ b.sub }}</text>
          </g>
        }
      </svg>
    </section>
  }
  `,
  styles: [`
    .head { display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:.5rem; }
    .legend { display:flex; gap:1rem; font-size:.8rem; color:var(--muted); }
    .legend .sw { display:inline-block; width:11px; height:11px; border-radius:3px; margin-right:.3rem; vertical-align:middle; }
    .sw.app { background:#3b6fd4; } .sw.node { background:#8a5cf6; }
    .sw.secret { background:#2f9e5f; } .sw.plain { background:#c0873f; }
    svg { margin-top:.5rem; }
    .box { stroke:var(--line); stroke-width:1; }
    .box.app { fill:#16233f; stroke:#3b6fd4; }
    .box.app.off { opacity:.45; }
    .box.node { fill:#241a3f; stroke:#8a5cf6; }
    .box.secret { fill:#12291d; stroke:#2f9e5f; }
    .box.plain { fill:#2a2013; stroke:#c0873f; }
    .lbl { fill:var(--text); font-size:12px; font-weight:600; text-anchor:middle; }
    .sub { fill:var(--muted); font-size:10px; text-anchor:middle; }
    .edge { stroke:#3a4150; stroke-width:1.5; }
  `],
})
export class GraphPage {
  store = inject(Store);
  readonly boxW = BOX_W;
  readonly boxH = BOX_H;

  private layout = computed(() => {
    const cfg = this.store.config();
    const boxes: Box[] = [];
    const edges: Edge[] = [];
    if (!cfg) return { boxes, edges, rows: 0 };

    const yOf = (i: number) => 20 + i * (BOX_H + GAP);
    const center = (b: { x: number; y: number }) => ({ x: b.x, y: b.y + BOX_H / 2 });

    // Secrets column — remember positions to wire edges into them.
    const secretPos = new Map<string, { x: number; y: number }>();
    Object.entries(cfg.secrets ?? {}).forEach(([name, val], i) => {
      const encrypted = (val ?? '').includes('BEGIN AGE ENCRYPTED FILE');
      const b: Box = { id: 's:' + name, label: name, sub: encrypted ? 'chiffré' : 'clair',
        x: COL.secret, y: yOf(i), kind: encrypted ? 'secret' : 'plain' };
      boxes.push(b);
      secretPos.set(name, { x: b.x, y: b.y });
    });

    // Nodes column.
    const nodePos = new Map<string, { x: number; y: number }>();
    (cfg.nodes ?? []).forEach((n, i) => {
      const b: Box = { id: 'n:' + n.name, label: n.name, sub: n.host,
        x: COL.node, y: yOf(i), kind: 'node' };
      boxes.push(b);
      nodePos.set(n.name, { x: b.x, y: b.y });
      // node auth secret edge
      const sp = secretPos.get(n.auth?.secretRef);
      if (sp) edges.push({ ...rightOf(b), ...leftOf(sp) });
    });

    // Applications column.
    (cfg.applications ?? []).forEach((a, i) => {
      const b: Box = { id: 'a:' + a.name, label: a.name, sub: a.enabled ? a.command : '(désactivée)',
        x: COL.app, y: yOf(i), kind: 'app' + (a.enabled ? '' : ' off') };
      boxes.push(b);
      // app -> node
      const np = nodePos.get(a.node);
      if (np) edges.push({ ...rightOf(b), ...leftOf(np) });
      // app secret fields -> secret (drawn app→secret directly, curving over nodes)
      (a.fields ?? []).forEach((f) => {
        if (f.type === 'secret' && f.secretRef) {
          const sp = secretPos.get(f.secretRef);
          if (sp) edges.push({ x1: b.x + BOX_W / 2, y1: b.y, x2: sp.x + BOX_W / 2, y2: sp.y });
        }
      });
    });

    const rows = Math.max(cfg.applications?.length ?? 0, cfg.nodes?.length ?? 0, Object.keys(cfg.secrets ?? {}).length);
    return { boxes, edges, rows };

    function rightOf(b: { x: number; y: number }) { return { x1: b.x + BOX_W, y1: b.y + BOX_H / 2 }; }
    function leftOf(b: { x: number; y: number }) { return { x2: b.x, y2: b.y + BOX_H / 2 }; }
  });

  boxes = computed(() => this.layout().boxes);
  edges = computed(() => this.layout().edges);
  height = computed(() => Math.max(120, 40 + this.layout().rows * (BOX_H + GAP)));
}
