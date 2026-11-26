import { Routes } from '@angular/router';
import { AdminLayout } from './admin-layout';
import { staffGuard } from './admin-session';

export const adminRoutes: Routes = [
  { path: 'login', title: 'Staff Sign-in | Koktem Park Hotel', loadComponent: () => import('./admin-login').then(m => m.AdminLogin) },
  {
    path: '', component: AdminLayout, canActivate: [staffGuard],
    children: [
      ...['profile','security','preferences'].map(mode => ({path:mode,data:{mode},loadComponent:()=>import('../member/profile').then(m=>m.ProfilePage)})),
      {path:'notifications',data:{mode:'notifications'},loadComponent:()=>import('../member/history').then(m=>m.HistoryPage)},
      {path:'activity',loadComponent:()=>import('./activity').then(m=>m.ActivityPage)},
      { path: '', pathMatch: 'full', title: 'Hotel Dashboard | Koktem Park Hotel', loadComponent: () => import('./admin-overview').then(m => m.AdminOverview) },
      { path: 'rooms', title: 'Manage Rooms | Koktem Park Hotel', loadComponent: () => import('./admin-rooms').then(m => m.AdminRooms) },
      { path: 'reservations', title: 'Manage Reservations | Koktem Park Hotel', loadComponent: () => import('./admin-reservations').then(m => m.AdminReservations) },
      { path: 'payments', title: 'Payments | Koktem Park Hotel', loadComponent: () => import('./admin-payments').then(m => m.AdminPayments) },
      { path: 'reviews', title: 'Reviews | Koktem Park Hotel', loadComponent: () => import('./admin-reviews').then(m => m.AdminReviews) },
      { path: 'guests', title: 'Guests | Koktem Park Hotel', loadComponent: () => import('./admin-guests').then(m => m.AdminGuests) },
      { path: 'front-desk', title: 'Front Desk | Koktem Park Hotel', loadComponent: () => import('./admin-desk').then(m => m.AdminDesk) },
      { path: 'reports', title: 'Reports | Koktem Park Hotel', loadComponent: () => import('./admin-reports').then(m => m.AdminReports) },
      { path: '**', redirectTo: '' },
    ],
  },
];
