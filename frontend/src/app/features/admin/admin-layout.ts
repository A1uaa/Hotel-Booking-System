import { Avatar } from '../../shared/avatar';
import { Member } from '../../core/member';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NotificationBell } from '../../shared/notifications';
import { TranslatePipe } from '../../core/i18n';
import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { StaffSession } from './admin-session';
import { mutation } from './admin-state';

@Component({
  imports: [Avatar, NotificationBell, TranslatePipe, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="staff-frame">
      <aside class="staff-side">
        <a class="staff-brand" routerLink="/admin"><img src="/koktem.svg" alt="" /><span>Koktem Park<small>HOTEL MANAGEMENT</small></span></a>
        <nav aria-label="Hotel management">
          @if (staff.current()?.capabilities; as can) {
            @if (can.dashboard) { <a routerLink="/admin" routerLinkActive="current" [routerLinkActiveOptions]="{exact: true}">Overview</a> }
            @if (can.rooms) { <a routerLink="/admin/rooms" routerLinkActive="current">Rooms</a> }
            @if (can.reservations) {
              <a routerLink="/admin/reservations" routerLinkActive="current">Reservations</a>
              <a routerLink="/admin/front-desk" routerLinkActive="current">Front desk</a>
            }
            @if (can.payments) { <a routerLink="/admin/payments" routerLinkActive="current">Payments</a> }
            @if (can.reviews) { <a routerLink="/admin/reviews" routerLinkActive="current">Reviews</a> }
            @if (can.guests) { <a routerLink="/admin/guests" routerLinkActive="current">Guests</a> }
            @if (can.activity) { <a routerLink="/admin/activity" routerLinkActive="current">{{ 'member.activity' | t }}</a> }
            @if (can.reports) { <a routerLink="/admin/reports" routerLinkActive="current">Reports</a> }
          }
        </nav>
        <a class="staff-exit" routerLink="/">↗ Customer website</a>
      </aside>
      <main class="staff-main">
        <header class="staff-top">
          <span>Almaty operations</span>
          <div><app-notifications [admin]="true" /><details class="account-menu"><summary><app-avatar [photo]="member.profile()?.photo" /> {{ 'nav.account' | t }}</summary><div class="account-panel">
            <a routerLink="/admin/profile">{{ 'member.profile' | t }}</a><a routerLink="/admin/security">{{ 'member.security' | t }}</a><a routerLink="/admin/preferences">{{ 'member.preferences' | t }}</a>
            @if (staff.current()?.capabilities?.activity) { <a routerLink="/admin/activity">{{ 'member.activity' | t }}</a> }
            </div></details><span class="staff-email">{{ staff.current()?.account?.email }}</span>
            <button class="button outline button-small" type="button" (click)="logout()" [disabled]="action.saving()">Sign out</button></div>
        </header>
        <div class="staff-content">
          @if (action.error()) { <p class="notice error" role="alert">{{ action.error() }}</p> }
          <router-outlet />
        </div>
      </main>
    </div>
  `,
})
export class AdminLayout {
  readonly member = inject(Member);
  readonly staff = inject(StaffSession);
  private readonly router = inject(Router);
  readonly action = mutation();
  constructor() { this.member.loadProfile().pipe(takeUntilDestroyed()).subscribe({error:()=>{}}); }
  logout() {
    this.action.run(this.staff.logout(), '', () => { void this.router.navigate(['/admin/login']); });
  }
}
