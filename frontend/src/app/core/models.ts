// Mirror of the backend config schema (backend/internal/config).
export interface Platform { name: string; }

export interface NodeAuth { type: 'key' | 'password'; secretRef: string; }

export interface Node {
  name: string;
  host: string;
  port?: number;
  user: string;
  auth: NodeAuth;
}

export interface Field {
  env: string;
  label?: string;
  type: 'text' | 'secret';
  secretRef?: string;
  default?: string;
}

export interface Check {
  enabled: boolean;
  type?: 'tcp' | 'command';
  run?: string;
  periodSeconds?: number;
}

// Tile placement + styling for the drag-and-drop board. Everything is
// optional: x/y are set only once a tile is dragged (otherwise it auto-
// positions); icon/color can be set without pinning a position.
export interface Tile {
  x?: number;
  y?: number;
  w?: number;      // column span (default 1)
  h?: number;      // row span (default 1)
  icon?: string;   // emoji, e.g. "🚀"
  color?: string;  // accent | blue | green | amber | red | purple
}

export interface Application {
  name: string;
  node: string;
  workdir?: string;
  command: string;
  fields?: Field[];
  check: Check;
  enabled: boolean;
  tile?: Tile;
}

// A project groups nodes + applications under one display name. The board,
// applications and topology screens operate on the "current" project.
export interface Project {
  name: string;
  nodes: Node[];
  applications: Application[];
}

export interface Config {
  platform?: Platform;
  projects: Project[];
  secrets: Record<string, string>;
}

export interface CheckResult {
  state: 'up' | 'down' | 'disabled' | 'error';
  detail?: string;
}
