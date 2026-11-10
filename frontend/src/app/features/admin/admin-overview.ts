import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { money } from '../../shared/stay';
import { AdminApi, Dashboard } from './admin-api';
import { StaffSession } from './admin-session';
import { resource } from './admin-state';

@Component({
  imports: [RouterLink],
  template: `
    <div class="staff-heading"><div><p class="eyebrow">Operations overview</p><h1>Hotel dashboard</h1><p>Room inventory, arrivals, and departures in Almaty time.</p></div>
      @if (can()?.reservations) { <a class="button" routerLink="/admin/front-desk">Open front desk ↗</a> }
    </div>
    @if (!can()?.dashboard) {
      <p class="notice">Select an authorized section from the menu. Overview statistics require room, booking, and payment access.</p>
    } @else if (result.loading()) { <p class="notice" role="status">Loading overview…</p> }
    @else if (result.error()) { <p class="notice error" role="alert">{{ result.error() }}</p><button class="button outline" (click)="load()">Retry</button> }
    @else if (result.data(); as row) {
      <div class="staff-date"><span>HOTEL DATE</span> {{ row.date }}</div>
      <div class="staff-metrics">
        @for (card of cards; track card.key) {
          <article class="staff-metric"><p>{{ card.title }}</p><strong>{{ row[card.key] }}</strong><small>{{ card.hint }}</small></article>
        }
        <article class="staff-metric staff-revenue"><p>Total revenue</p><strong>{{ money(row.revenue) }}</strong><small>Paid amounts and completed stays without payment records</small></article>
      </div>
    }
  `,
})
export class AdminOverview {
  private readonly api = inject(AdminApi);
  readonly can = () => this.staff.current()?.capabilities;
  private readonly staff = inject(StaffSession);
  readonly result = resource<Dashboard>();
  readonly money = money;
  readonly cards = [
    { key: 'total_rooms', title: 'Total rooms', hint: 'All inventory' },
    { key: 'available_rooms', title: 'Available rooms', hint: 'In service and unoccupied' },
    { key: 'occupied_rooms', title: 'Occupied rooms', hint: 'Currently checked in' },
    { key: 'arrivals', title: 'Today’s arrivals', hint: 'Confirmed and processed arrivals' },
    { key: 'departures', title: 'Today’s departures', hint: 'Scheduled departures' },
    { key: 'active_reservations', title: 'Active reservations', hint: 'Pending, confirmed, or checked in' },
  ] as const;
  constructor() { if (this.can()?.dashboard) this.load(); }
  load() { this.result.load(this.api.dashboard()); }
}

