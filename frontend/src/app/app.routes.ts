import { Routes } from '@angular/router';
import { LoadPage } from './pages/load';
import { BoardPage } from './pages/board';
import { AppsPage } from './pages/apps';
import { GraphPage } from './pages/graph';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'board' },
  { path: 'board', component: BoardPage },
  { path: 'load', component: LoadPage },
  { path: 'apps', component: AppsPage },
  { path: 'graph', component: GraphPage },
];
