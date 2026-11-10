import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { apiError, Booking, HotelApi } from '../core/api';
import { money, statusLabel } from '../shared/stay';

@Component({
  imports: [RouterLink],
  template: `
    <section class="shell section narrow">
      @if (loading()) { <p class="notice" role="status">Loading your reservation…</p> }
      @else if (error()) { <p class="notice error" role="alert">{{ error() }}</p><a class="button" routerLink="/bookings">My bookings</a> }
      @else if (booking(); as item) {
        <article class="panel confirmation">
          <p class="eyebrow">Reservation #{{ item.id }}</p>
          <h1>{{ item.status === 'pending' ? 'Reservation received' : 'Reservation details' }}</h1>
          <p>Your reservation status is <strong>{{ label(item.status) }}</strong>.</p>
          <dl class="facts"><dt>Check-in</dt><dd>{{ item.check_in }}</dd><dt>Check-out</dt><dd>{{ item.check_out }}</dd>
            <dt>Guests</dt><dd>{{ item.guest_count }}</dd><dt>Final total</dt><dd>{{ money(item.total_price) }}</dd></dl>
          <a class="button" routerLink="/bookings">View my bookings ↗</a>
        </article>
      }
    </section>
  `,
})
export class Confirmation {
  readonly booking = signal<Booking | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly money = money;
  readonly label = statusLabel;
  constructor() {
    const api = inject(HotelApi);
    inject(ActivatedRoute).paramMap.pipe(
      switchMap(params => {
        this.loading.set(true);
        return api.booking(Number(params.get('id'))).pipe(
          map(booking => ({ booking, error: '' })),
          catchError(error => of({ booking: null, error: apiError(error) })),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe(({ booking, error }) => {
      this.booking.set(booking);
      this.error.set(error);
      this.loading.set(false);
    });
  }
}
