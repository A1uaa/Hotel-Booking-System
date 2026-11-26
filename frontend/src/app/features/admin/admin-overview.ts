import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { interval } from 'rxjs';
import { money } from '../../shared/stay';
import { TranslatePipe } from '../../core/i18n';
import { AdminApi, Dashboard } from './admin-api';
import { StaffSession } from './admin-session';
import { resource } from './admin-state';

@Component({
  imports: [FormsModule, TranslatePipe],
  template: `
    <div class="staff-heading"><div><h1>{{ 'member.dashboard' | t }}</h1></div></div>
    @if (can()?.dashboard) {
      <form class="staff-filters" (submit)="$event.preventDefault(); load()">
        <label>{{ 'member.selectedDate' | t }}<input type="date" [(ngModel)]="selected" name="date" /></label>
        <button class="button">{{ 'member.search' | t }}</button>
        <button type="button" class="plain-button" (click)="selected=''; load()">{{ 'member.today' | t }}</button>
      </form>
      @if (result.loading() && !result.data()) { <p role="status">{{ 'member.loading' | t }}</p> }
      @if (result.error()) { <p class="notice error" role="alert">{{ result.error() }}</p> }
      @if (result.data(); as row) {
        <p class="staff-date">{{ 'member.hotelDate' | t }} {{ row.date }} · {{ 'member.selectedDate' | t }} {{ row.selected_date || row.date }}</p>
        <div class="staff-metrics">
          @for (card of cards; track card) {
            <article class="staff-metric"><p>{{ 'metric.' + card | t }}</p><strong>{{ row[card] ?? 0 }}</strong></article>
          }
          <article class="staff-metric"><p>{{ 'member.awaiting' | t }}</p><strong>{{ row.pending_payments ?? 0 }}</strong><small>{{ money(row.pending_amount ?? 0) }}</small></article>
          <article class="staff-metric staff-revenue"><p>{{ 'member.revenue' | t }}</p><strong>{{ money(row.revenue) }}</strong></article>
        </div>
      }
    }
  `,
})
export class AdminOverview {
  private readonly api = inject(AdminApi);
  private readonly staff = inject(StaffSession);
  readonly can = () => this.staff.current()?.capabilities;
  readonly result = resource<Dashboard>();
  readonly money = money;
  selected = '';
  readonly cards = ['total_rooms','available_rooms','reserved_rooms','occupied_rooms','out_of_service_rooms','arrivals','departures','active_reservations'] as const;
  constructor() {
    if (this.can()?.dashboard) this.load();
    interval(60000).pipe(takeUntilDestroyed()).subscribe(() => { if (this.can()?.dashboard) this.load(); });
  }
  load() { this.result.load(this.api.dashboard(this.selected)); }
}
