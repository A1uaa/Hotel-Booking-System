import { Profile, OwnReview } from '../../core/member';
import { Payment } from '../../core/api';
import { TranslatePipe } from '../../core/i18n';
import { Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { AdminApi, Guest, Reservation } from './admin-api';
import { resource } from './admin-state';
import { ReservationTable } from './reservation-table';

@Component({
  imports: [TranslatePipe, ReactiveFormsModule, ReservationTable],
  template: `
    <div class="staff-heading"><div><p class="eyebrow">Guest records</p><h1>Guests</h1><p>Find a guest and review their reservation history.</p></div></div>
    <form class="staff-panel staff-filters" (ngSubmit)="search()">
      <label>Name or email<input [formControl]="query" placeholder="Search registered guests" /></label><button class="button">Search</button>
    </form>
    @if (detail.loading()) { <p class="notice" role="status">Loading guest history…</p> }
    @if (detail.error()) { <p class="notice error" role="alert">{{ detail.error() }}</p> }
    @if (detail.data(); as record) {
      <section class="staff-editor">
        <div class="staff-panel staff-panel-heading"><div><h2>{{ record.guest.name || record.guest.email || 'Guest #' + record.guest.id }}</h2><p>{{ record.guest.email || 'Email unlisted' }}</p></div>
          <button class="plain-button" (click)="detail.clear()">Close</button>
        </div>
        <section class="staff-panel">
          @if (record.profile.photo) { <img class="profile-avatar large" [src]="record.profile.photo" alt="" /> }
          <p>{{ record.profile.phone }} · {{ record.guest.date_joined.slice(0,10) }}</p>
          <h3>{{ 'member.payments' | t }}</h3>
          @for (payment of record.payments; track payment.id) { <p>#{{ payment.id }} · {{ payment.amount }} ₸ · {{ payment.status }}</p> }
          <h3>{{ 'member.reviews' | t }}</h3>
          @for (review of record.reviews; track review.id) { <p>{{ review.rating }}/5 · {{ review.comment }}</p> }
        </section>
        <app-reservation-table [rows]="record.bookings" caption="Booking history" />
      </section>
    }
    @if (list.loading()) { <p class="notice" role="status">Loading guests…</p> }
    @else if (list.error()) { <p class="notice error" role="alert">{{ list.error() }}</p><button class="button outline" (click)="search()">Retry</button> }
    @else if (list.data(); as rows) {
      <div class="staff-panel staff-table-wrap"><table class="staff-table"><caption>{{ rows.length }} registered guests</caption>
        <thead><tr><th>Name</th><th>Email</th><th>Registered</th><th><span class="visually-hidden">Actions</span></th></tr></thead>
        <tbody>@for (guest of rows; track guest.id) {
          <tr><th scope="row">{{ guest.name || 'Guest #' + guest.id }}</th><td>{{ guest.email || 'Unlisted' }}</td>
            <td>{{ guest.date_joined.slice(0, 10) }}</td><td><button class="plain-button" (click)="view(guest.id)">View history</button></td></tr>
        } @empty { <tr><td colspan="4">No guests match this search.</td></tr> }</tbody>
      </table></div>
    }
  `,
})
export class AdminGuests {
  private readonly api = inject(AdminApi);
  readonly query = new FormControl('', { nonNullable: true });
  readonly list = resource<Guest[]>();
  readonly detail = resource<{ guest: Guest; bookings: Reservation[];profile:Profile;payments:Payment[];reviews:OwnReview[] }>();
  constructor() { this.search(); }
  search() { this.list.load(this.api.guests(this.query.value)); }
  view(id: number) { this.detail.clear(); this.detail.load(this.api.guest(id)); }
}
