import { Routes } from '@angular/router';
import { requireSession } from '../../core/auth';
import { MemberLayout } from './layout';

export const memberRoutes: Routes = [{
  path: '', component: MemberLayout, canActivate: [requireSession], children: [
    {path:'',pathMatch:'full',redirectTo:'profile'},
    ...['profile','security','preferences'].map(mode => ({
      path:mode,data:{mode},loadComponent:()=>import('./profile').then(m=>m.ProfilePage),
    })),
    ...['favorites','reviews','payments','notifications'].map(mode => ({
      path:mode,data:{mode},loadComponent:()=>import('./history').then(m=>m.HistoryPage),
    })),
    {path:'bookings',loadComponent:()=>import('../bookings').then(m=>m.Bookings)},
  ],
}];

