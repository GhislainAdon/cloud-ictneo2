import { Routes } from '@angular/router';
import { LoadPage } from './pages/load';
import { AppsPage } from './pages/apps';
import { DashboardPage } from './pages/dashboard';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'load' },
  { path: 'load', component: LoadPage },
  { path: 'apps', component: AppsPage },
  { path: 'dashboard', component: DashboardPage },
];
