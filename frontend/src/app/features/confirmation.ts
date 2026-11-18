import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { apiError, Booking, HotelApi, Payment } from '../core/api';
import { translate, TranslatePipe } from '../core/i18n';
import { money, statusLabel } from '../shared/stay';

@Component({
  imports: [RouterLink, TranslatePipe],
  template: `
    <section class="shell section narrow">
      @if (loading()) { <p class="notice" role="status">{{ 'common.loadingRes' | t }}</p> }
      @else if (error()) { <p class="notice error" role="alert">{{ error() }}</p><a class="button" routerLink="/bookings">{{ 'common.myBookings' | t }}</a> }
      @else if (booking(); as item) {
        <article class="panel confirmation">
          <p class="eyebrow">{{ 'bk.res' | t: { id: item.id } }}</p>
          <h1>{{ headline(item) }}</h1>
          <p>{{ 'conf.statusIs' | t }} <strong>{{ label(item.status) }}</strong>.</p>
          <dl class="facts"><dt>{{ 'common.checkin' | t }}</dt><dd>{{ item.check_in }}</dd><dt>{{ 'common.checkout' | t }}</dt><dd>{{ item.check_out }}</dd>
            <dt>{{ 'common.guests' | t }}</dt><dd>{{ item.guest_count }}</dd><dt>{{ 'conf.finalTotal' | t }}</dt><dd>{{ money(item.total_price) }}</dd></dl>
          @switch (item.payment_status) {
            @case ('paid') { <p class="notice success" role="status">{{ 'conf.paidFull' | t: { amount: money(item.paid_amount ?? item.total_price) } }}</p> }
            @case ('partial') { <p class="notice" role="status">{{ 'conf.partial' | t: { paid: money(item.paid_amount ?? 0), due: money(item.balance_due ?? 0) } }}</p> }
            @case ('pay_at_hotel') { <p class="notice" role="status">{{ 'conf.atHotel' | t: { amount: money(item.balance_due ?? 0) } }}</p> }
            @case ('refunded') { <p class="notice" role="status">{{ 'conf.refunded' | t }}</p> }
            @default { @if (item.status === 'pending') { <p class="notice">{{ 'conf.choose' | t }}</p> } }
          }
          @if (canPay(item)) { <a class="button" [routerLink]="['/bookings', item.id, 'payment']">{{ (item.status === 'pending' ? 'bk.payNow' : 'conf.payBalance') | t }}</a> }
          @if (payments().length) {
            <h2 class="payment-heading">{{ 'conf.history' | t }}</h2>
            <ul class="payment-history">
              @for (payment of payments(); track payment.id) {
                <li><span>{{ payment.payment_method }}</span><span>{{ money(payment.amount) }}</span><span class="badge" [attr.data-payment]="payment.status">{{ label(payment.status) }}</span></li>
              }
            </ul>
          }
          <a class="button" routerLink="/bookings">{{ 'conf.viewBookings' | t }}</a>
        </article>
      }
    </section>
  `,
})
export class Confirmation {
  readonly booking = signal<Booking | null>(null);
  readonly payments = signal<Payment[]>([]);
  headline(item: Booking) {
    if (item.payment_status === 'paid') return translate('conf.h.paid');
    if (item.payment_status === 'partial') return translate('conf.h.partial');
    if (item.payment_status === 'pay_at_hotel') return translate('conf.h.hotel');
    return translate(item.status === 'pending' ? 'conf.h.pending' : 'conf.h.details');
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
