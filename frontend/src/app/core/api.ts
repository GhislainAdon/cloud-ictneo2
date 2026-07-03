import { Injectable } from '@angular/core';
import { CheckResult, Config } from './models';

export interface ValidateResponse {
  valid: boolean;
  errors: string[];
  config?: Config;
}

// Thin fetch wrapper. The backend is same-origin (it serves the SPA), so
// relative paths work in production; `ng serve` proxies /api to :9876.
@Injectable({ providedIn: 'root' })
export class Api {
  async validate(config: string): Promise<ValidateResponse> {
    return this.postJson('/api/validate', { config });
  }

  async encryptSecret(ageKey: string, name: string, value: string): Promise<{ name: string; encrypted: string }> {
    return this.postJson('/api/secrets', { ageKey, name, value });
  }

  async check(config: string, ageKey: string, apps: string[]): Promise<Record<string, CheckResult>> {
    const r = await this.postJson<{ results: Record<string, CheckResult> }>('/api/check', { config, ageKey, apps });
    return r.results;
  }

  // run streams SSE. onEvent gets (event, data) tuples until the stream ends.
  async run(
    body: { config: string; ageKey: string; app: string; fields: Record<string, string> },
    onEvent: (event: string, data: string) => void,
  ): Promise<void> {
    const res = await fetch('/api/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const t = await res.text();
      throw new Error(`${res.status}: ${t}`);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const chunks = buf.split('\n\n');
      buf = chunks.pop() ?? '';
      for (const chunk of chunks) {
        let event = 'message';
        let data = '';
        for (const line of chunk.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7);
          else if (line.startsWith('data: ')) data = line.slice(6);
        }
        if (data) {
          try { data = JSON.parse(data); } catch { /* keep raw */ }
          onEvent(event, data);
        }
      }
    }
  }

  private async postJson<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
  }
}
