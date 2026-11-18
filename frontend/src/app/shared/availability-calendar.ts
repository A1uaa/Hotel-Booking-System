import { Component, computed, input, output, signal } from '@angular/core';
import { Stay } from '../core/api';
import { addDays, addMonths, monthGrid, nightIsBooked, rangeIsFree } from './calendar';

export interface CalendarPick { check_in: string; check_out: string; }

interface Cell {
  iso: string; day: number; disabled: boolean; booked: boolean; past: boolean;
  inRange: boolean; edge: boolean; label: string;
}

const MONTHS_AHEAD = 12;

@Component({
  selector: 'app-availability-calendar',
  template: `
    <div class="calendar">
      <div class="calendar-head">
        <button type="button" class="calendar-nav" (click)="move(-1)" [disabled]="!canPrev()" aria-label="Previous month">‹</button>
        <strong aria-live="polite">{{ title() }}</strong>
        <button type="button" class="calendar-nav" (click)="move(1)" [disabled]="!canNext()" aria-label="Next month">›</button>
      </div>
      <div class="calendar-grid" role="group" [attr.aria-label]="title()">
        @for (name of weekdays(); track $index) { <span class="calendar-weekday" aria-hidden="true">{{ name }}</span> }
        @for (cell of cells(); track $index) {
          @if (cell; as c) {
            <button type="button" class="calendar-day" [attr.data-date]="c.iso" [disabled]="c.disabled"
              [class.booked]="c.booked" [class.past]="c.past" [class.in-range]="c.inRange" [class.edge]="c.edge"
              [attr.aria-label]="c.label" [attr.aria-pressed]="c.edge" (click)="choose(c.iso)">{{ c.day }}</button>
          } @else { <span></span> }
        }
      </div>
      <p class="calendar-legend muted"><span class="swatch free"></span> Free <span class="swatch booked"></span> Booked <span class="swatch chosen"></span> Your stay</p>
    </div>
  `,
})
export class AvailabilityCalendar {
  readonly booked = input<Stay[]>([]);
  readonly checkIn = input('');
  readonly checkOut = input('');
  readonly today = input.required<string>();
  readonly locale = input('en');
  /** Emits the new stay; `check_out` is empty while only the first day is chosen. */
  readonly pick = output<CalendarPick>();

  private readonly offset = signal(0);
  private readonly monthStart = computed(() => addMonths(this.today(), this.offset()));

  readonly canPrev = computed(() => this.offset() > 0);
  readonly canNext = computed(() => this.offset() < MONTHS_AHEAD - 1);
  readonly title = computed(() => this.format(this.monthStart(), { month: 'long', year: 'numeric' }));
  readonly weekdays = computed(() => {
    // 2024-01-01 is a Monday.
    return Array.from({ length: 7 }, (_, index) => this.format(addDays('2024-01-01', index), { weekday: 'short' }));
  });

  readonly cells = computed<(Cell | null)[]>(() => {
    const booked = this.booked(), start = this.checkIn(), end = this.checkOut(), today = this.today();
    const choosingEnd = !!start && !end;
    return monthGrid(this.monthStart()).map(iso => {
      if (iso === null) return null;
      const past = iso < today;
      const taken = nightIsBooked(iso, booked);
      // After the first day is chosen, a later day is valid whenever no stay lies in between.
      // That includes a booked day, because the guest checks out that morning.
      const disabled = choosingEnd && iso > start ? !rangeIsFree(start, iso, booked) : past || taken;
      const inRange = start && end ? iso >= start && iso < end : iso === start;
      const edge = iso === start || iso === end;
      const state = past ? 'past' : taken ? 'booked' : disabled ? 'unavailable' : 'free';
      return { iso, day: Number(iso.slice(8)), disabled, booked: taken, past, inRange, edge, label: iso + ', ' + state };
    });
  });

  move(step: number) {
    this.offset.update(value => Math.min(MONTHS_AHEAD - 1, Math.max(0, value + step)));
  }

  choose(iso: string) {
    const start = this.checkIn();
    if (start && !this.checkOut() && iso > start && rangeIsFree(start, iso, this.booked())) {
      this.pick.emit({ check_in: start, check_out: iso });
    } else {
      this.pick.emit({ check_in: iso, check_out: '' });
    }
  }

  private format(iso: string, options: Intl.DateTimeFormatOptions) {
    return new Intl.DateTimeFormat(this.locale(), { ...options, timeZone: 'UTC' }).format(new Date(iso + 'T00:00:00Z'));
  }
}
