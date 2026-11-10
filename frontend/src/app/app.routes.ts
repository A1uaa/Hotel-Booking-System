import { Component } from '@angular/core';
import { RouterLink, Routes } from '@angular/router';
import { requireSession } from './core/auth';
import { Site } from './layouts/site';

@Component({
  imports: [RouterLink],
  template: '<section class="shell section narrow"><h1>Page not found</h1><a class="button" routerLink="/">Return home</a></section>',
})
class NotFound {}

const customerRoutes: Routes = [
  { path: '', title: 'Koktem Park Hotel | Almaty', loadComponent: () => import('./features/home').then(m => m.Home) },
  { path: 'rooms', title: 'Rooms & Suites | Koktem Park Hotel', loadComponent: () => import('./features/rooms').then(m => m.Rooms) },
  { path: 'rooms/:id', title: 'Room Details | Koktem Park Hotel', loadComponent: () => import('./features/room-detail').then(m => m.RoomDetail) },
  { path: 'login', title: 'Log In | Koktem Park Hotel', loadComponent: () => import('./features/account').then(m => m.AccountPage) },
  { path: 'register', title: 'Register | Koktem Park Hotel', data: { register: true }, loadComponent: () => import('./features/account').then(m => m.AccountPage) },
  { path: 'bookings', title: 'My Bookings | Koktem Park Hotel', canActivate: [requireSession], loadComponent: () => import('./features/bookings').then(m => m.Bookings) },
  { path: 'bookings/:id/confirmation', title: 'Reservation | Koktem Park Hotel', canActivate: [requireSession], loadComponent: () => import('./features/confirmation').then(m => m.Confirmation) },
  { path: 'contact', title: 'Contact | Koktem Park Hotel', loadComponent: () => import('./features/contact').then(m => m.Contact) },
  { path: '**', title: 'Page Not Found | Koktem Park Hotel', component: NotFound },
];

export const routes: Routes = [
  { path: 'admin', loadChildren: () => import('./features/admin/admin.routes').then(m => m.adminRoutes) },
  { path: '', component: Site, children: customerRoutes },
];