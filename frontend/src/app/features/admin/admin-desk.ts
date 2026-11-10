import { Component, inject } from '@angular/core';
import { AdminApi, FrontDesk, Reservation } from './admin-api';
import { StaffSession } from './admin-session';
import { mutation, resource } from './admin-state';
import { ReservationTable } from './reservation-table';

@Component({
  imports: [ReservationTable],
  template: `
    <div class="staff-heading"><div><p class="eyebrow">Guest operations</p><h1>Front desk</h1><p>Process today’s arrivals and scheduled or overdue departures.</p></div>
      <button class="button outline" (click)="load()" [disabled]="result.loading() || action.saving()">Refresh</button></div>
    @if (action.feedback()) { <p class="notice success" role="status">{{ action.feedback() }}</p> }
    @if (action.error()) { <p class="notice error" role="alert">{{ action.error() }}</p> }
    @if (result.loading()) { <p class="notice" role="status">Loading today’s activity…</p> }
    @else if (result.error()) { <p class="notice error" role="alert">{{ result.error() }}</p> }
    @else if (result.data(); as desk) {
      <p class="staff-date"><span>HOTEL DATE</span> {{ desk.date }}</p>
      <div class="staff-stack">
        <app-reservation-table [rows]="desk.arrivals" caption="Today’s arrivals" [mode]="canChange() ? 'arrival' : 'none'" [busy]="action.saving()" (selected)="process($event, 'check-in')" />
        <app-reservation-table [rows]="desk.departures" caption="Today’s and overdue departures" [mode]="canChange() ? 'departure' : 'none'" [busy]="action.saving()" (selected)="process($event, 'check-out')" />
      </div>
    }
  `,
})
export class AdminDesk {
  private readonly api = inject(AdminApi);
  private readonly staff = inject(StaffSession);
  readonly canChange = () => this.staff.current()?.capabilities.changeBooking;
  readonly result = resource<FrontDesk>();
  readonly action = mutation();
  constructor() { this.load(); }
  load() { this.result.load(this.api.frontDesk()); }
  process(row: Reservation, operation: 'check-in' | 'check-out') {
    if (!window.confirm('Process ' + operation + ' for reservation #' + row.id + '?')) return;
    this.action.run(this.api.deskAction(row.id, operation), 'Reservation #' + row.id + ' ' + (operation === 'check-in' ? 'checked in.' : 'checked out.'), () => this.load());
  }
}
