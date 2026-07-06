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

// Tile placement + styling for the drag-and-drop board. Optional and
// backward-compatible: apps without a tile get auto-positioned.
export interface Tile {
  x: number;
  y: number;
  w?: number;
  h?: number;
  icon?: string;   // Tabler icon name, e.g. "terminal-2"
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
