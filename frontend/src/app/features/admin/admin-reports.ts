import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { hotelToday, money, statusLabel } from '../../shared/stay';
import { AdminApi, HotelReport } from './admin-api';
import { resource } from './admin-state';

@Component({
  imports: [ReactiveFormsModule],
  template: `
    <div class="staff-heading"><div><p class="eyebrow">Performance</p><h1>Reports</h1><p>Review booking activity, reserved room nights, and revenue.</p></div></div>
    <form class="staff-panel staff-filters" [formGroup]="form" (ngSubmit)="load()">
      <label>From<input type="date" formControlName="start" required /></label>
      <label>Through<input type="date" formControlName="end" required [min]="form.value.start || ''" /></label>
      <button class="button">Run report</button>
      @if (form.invalid && form.touched) { <p class="field-error">Choose an inclusive date range of up to 366 days.</p> }
    </form>
    @if (result.loading()) { <p class="notice" role="status">Calculating report…</p> }
    @else if (result.error()) { <p class="notice error" role="alert">{{ result.error() }}</p> }
    @else if (result.data(); as report) {
      <p class="staff-date"><span>REPORT RANGE</span> {{ report.start }} to {{ report.end }}</p>
      <div class="staff-metrics">
        <article class="staff-metric"><p>Reservations</p><strong>{{ report.bookings }}</strong><small>Stays intersecting the report range</small></article>
        <article class="staff-metric"><p>Reserved occupancy</p><strong>{{ report.occupancy_percent }}%</strong><small>{{ report.occupied_nights }} reserved of {{ report.capacity_nights }} inventory nights</small></article>
        <article class="staff-metric"><p>Revenue</p><strong>{{ money(report.revenue) }}</strong><small>Paid amounts and completed stays without payment records</small></article>
      </div>
      <div class="staff-report-grid">
        <div class="staff-panel staff-table-wrap"><table class="staff-table"><caption>Reservations by status</caption><thead><tr><th>Status</th><th>Bookings</th></tr></thead>
          <tbody>@for (status of statuses; track status) { <tr><th scope="row">{{ label(status) }}</th><td>{{ report.by_status[status] }}</td></tr> }</tbody></table></div>
        <div class="staff-panel staff-table-wrap"><table class="staff-table"><caption>Popular room types</caption><thead><tr><th>Room type</th><th>Bookings</th></tr></thead>
          <tbody>@for (row of report.popular_room_types; track row.name) { <tr><th scope="row">{{ row.name }}</th><td>{{ row.bookings }}</td></tr> }
          @empty { <tr><td colspan="2">No non-cancelled bookings in this period.</td></tr> }</tbody></table></div>
      </div>
    }
  `,
})
export class AdminReports {
  private readonly api = inject(AdminApi);
  readonly result = resource<HotelReport>();
  private readonly today = hotelToday();
  readonly form = inject(FormBuilder).nonNullable.group({
    start: [this.today.slice(0, 7) + '-01', Validators.required],
    end: [this.today, Validators.required],
  }, { validators: control => {
    const days = (Date.parse(control.value.end) - Date.parse(control.value.start)) / 86_400_000;
    return days >= 0 && days <= 365 ? null : { dateRange: true };
  } });
  readonly statuses = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'] as const;
  readonly label = statusLabel;
  readonly money = money;
  constructor() { this.load(); }
  load() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const { start, end } = this.form.getRawValue();
    this.result.load(this.api.reports(start, end));
  }
}
