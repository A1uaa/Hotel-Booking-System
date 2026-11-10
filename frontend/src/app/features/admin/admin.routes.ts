import { Routes } from '@angular/router';
import { AdminLayout } from './admin-layout';
import { staffGuard } from './admin-session';

export const adminRoutes: Routes = [
  { path: 'login', title: 'Staff Sign-in | Koktem Park Hotel', loadComponent: () => import('./admin-login').then(m => m.AdminLogin) },
  {
    path: '', component: AdminLayout, canActivate: [staffGuard],
    children: [
      { path: '', pathMatch: 'full', title: 'Hotel Dashboard | Koktem Park Hotel', loadComponent: () => import('./admin-overview').then(m => m.AdminOverview) },
      { path: 'rooms', title: 'Manage Rooms | Koktem Park Hotel', loadComponent: () => import('./admin-rooms').then(m => m.AdminRooms) },
      { path: 'reservations', title: 'Manage Reservations | Koktem Park Hotel', loadComponent: () => import('./admin-reservations').then(m => m.AdminReservations) },
      { path: 'guests', title: 'Guests | Koktem Park Hotel', loadComponent: () => import('./admin-guests').then(m => m.AdminGuests) },
      { path: 'front-desk', title: 'Front Desk | Koktem Park Hotel', loadComponent: () => import('./admin-desk').then(m => m.AdminDesk) },
      { path: 'reports', title: 'Reports | Koktem Park Hotel', loadComponent: () => import('./admin-reports').then(m => m.AdminReports) },
      { path: '**', redirectTo: '' },
    ],
  },
];
