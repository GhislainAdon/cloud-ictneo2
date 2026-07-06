import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { Store } from './core/store';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  store = inject(Store);
  menuOpen = signal(false);
  renaming = signal(false);
  renameValue = '';

  toggleMenu() { this.menuOpen.update(v => !v); }
  switchTo(i: number) { this.store.switchProject(i); this.menuOpen.set(false); }
  add() { this.store.addProject(); this.menuOpen.set(false); }
  del() { this.store.deleteCurrentProject(); this.menuOpen.set(false); }

  startRename() {
    this.renameValue = this.store.platformName();
    this.menuOpen.set(false);
    this.renaming.set(true);
  }
  commitRename() {
    const v = this.renameValue.trim();
    if (v) this.store.renameCurrentProject(v);
    this.renaming.set(false);
  }
}
