import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { apiError, Booking, HotelApi, Payment } from '../core/api';
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
          <h1>{{ headline(item) }}</h1>
          <p>Your reservation status is <strong>{{ label(item.status) }}</strong>.</p>
          <dl class="facts"><dt>Check-in</dt><dd>{{ item.check_in }}</dd><dt>Check-out</dt><dd>{{ item.check_out }}</dd>
            <dt>Guests</dt><dd>{{ item.guest_count }}</dd><dt>Final total</dt><dd>{{ money(item.total_price) }}</dd></dl>
          @switch (item.payment_status) {
            @case ('paid') { <p class="notice success" role="status">Paid in full · {{ money(item.paid_amount ?? item.total_price) }}</p> }
            @case ('partial') { <p class="notice" role="status">Prepaid {{ money(item.paid_amount ?? 0) }}. Remaining {{ money(item.balance_due ?? 0) }} is due at the hotel.</p> }
            @case ('pay_at_hotel') { <p class="notice" role="status">Pay {{ money(item.balance_due ?? 0) }} at the hotel when you arrive. Your room is reserved.</p> }
            @case ('refunded') { <p class="notice" role="status">Your payment was refunded.</p> }
            @default { @if (item.status === 'pending') { <p class="notice">Choose how to pay to secure this reservation.</p> } }
          }
          @if (canPay(item)) { <a class="button" [routerLink]="['/bookings', item.id, 'payment']">{{ item.status === 'pending' ? 'Pay now' : 'Pay the balance' }}</a> }
          @if (payments().length) {
            <h2 class="payment-heading">Payment history</h2>
            <ul class="payment-history">
              @for (payment of payments(); track payment.id) {
                <li><span>{{ payment.payment_method }}</span><span>{{ money(payment.amount) }}</span><span class="badge" [attr.data-payment]="payment.status">{{ label(payment.status) }}</span></li>
              }
            </ul>
          }
          <a class="button" routerLink="/bookings">View my bookings ↗</a>
        </article>
      }
    </section>
  `,
})
export class Confirmation {
  readonly booking = signal<Booking | null>(null);
  readonly payments = signal<Payment[]>([]);
  headline(item: Booking) {
    if (item.payment_status === 'paid') return 'Payment received';
    if (item.payment_status === 'partial') return 'Prepayment received';
    if (item.payment_status === 'pay_at_hotel') return 'Reservation confirmed';
    return item.status === 'pending' ? 'Reservation received' : 'Reservation details';
  }
  canPay(item: Booking) {
    return (item.status === 'pending' || item.status === 'confirmed') && Number(item.balance_due ?? 0) > 0;
  }
  readonly loading = signal(true);
  readonly error = signal('');
  readonly money = money;
  readonly label = statusLabel;
  constructor() {
    const api = inject(HotelApi);
    inject(ActivatedRoute).paramMap.pipe(
      switchMap(params => {
        this.loading.set(true);
        const id = Number(params.get('id'));
        return forkJoin({
          booking: api.booking(id),
          payments: api.payments(id).pipe(catchError(() => of([] as Payment[]))),
        }).pipe(
          map(result => ({ ...result, error: '' })),
          catchError(error => of({ booking: null, payments: [] as Payment[], error: apiError(error) })),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe(({ booking, payments, error }) => {
      this.booking.set(booking);
      this.payments.set(payments);
      this.error.set(error);
      this.loading.set(false);
    });
  }
}
