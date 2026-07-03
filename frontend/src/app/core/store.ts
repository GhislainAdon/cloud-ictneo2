import { Injectable, signal, computed } from '@angular/core';
import { Config } from './models';

// In-memory only. Nothing is persisted: the config text and the age key
// live in signals for the lifetime of the tab. A refresh wipes them, which
// is the intended stateless behaviour.
@Injectable({ providedIn: 'root' })
export class Store {
  readonly configText = signal<string>('');
  readonly config = signal<Config | null>(null);
  readonly ageKey = signal<string>('');
  readonly validationErrors = signal<string[]>([]);

  readonly platformName = computed(() => this.config()?.platform?.name ?? 'Launcher Console');
  readonly hasKey = computed(() => this.ageKey().trim().length > 0);
  readonly loaded = computed(() => this.config() !== null);

  setConfig(text: string, parsed: Config | null, errors: string[]) {
    this.configText.set(text);
    this.config.set(parsed);
    this.validationErrors.set(errors);
  }

  setAgeKey(k: string) { this.ageKey.set(k); }

  // Re-serialise the current config back to YAML for export.
  reset() {
    this.configText.set('');
    this.config.set(null);
    this.ageKey.set('');
    this.validationErrors.set([]);
  }
}
