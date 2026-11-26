import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { apiError, Booking, HotelApi, PaymentInput, PaymentMethod } from '../core/api';
import { Auth } from '../core/auth';
import { ContentPipe, translate, TranslatePipe } from '../core/i18n';
import { money, nights, statusLabel } from '../shared/stay';

function cardNumber(control: AbstractControl): ValidationErrors | null {
  const digits = String(control.value ?? '').replace(/\s/g, '');
  if (!/^\d{13,19}$/.test(digits)) return { card: true };
  let total = 0;
  [...digits].reverse().forEach((char, index) => {
    let value = Number(char);
    if (index % 2) { value *= 2; if (value > 9) value -= 9; }
    total += value;
  });
  return total % 10 === 0 ? null : { card: true };
}

function expiry(control: AbstractControl): ValidationErrors | null {
  const match = /^(0[1-9]|1[0-2])\/(\d{2})$/.exec(String(control.value ?? ''));
  if (!match) return { expiry: true };
  const now = new Date();
  const left = (2000 + Number(match[2])) * 12 + Number(match[1]);
  return left < now.getFullYear() * 12 + now.getMonth() + 1 ? { expiry: true } : null;
}

@Component({
  imports: [ReactiveFormsModule, RouterLink, TranslatePipe, ContentPipe],
  template: `
    <section class="shell section narrow">
      @if (loading()) { <p class="notice" role="status">{{ 'common.loadingRes' | t }}</p> }
      @else if (loadError()) { <p class="notice error" role="alert">{{ loadError() }}</p><a class="button" routerLink="/bookings">{{ 'common.myBookings' | t }}</a> }
      @else if (booking(); as item) {
        @if (!payable(item)) {
          <div class="panel">
            <h1>{{ 'pay.nothing' | t }}</h1>
            <p>{{ 'pay.reservation' | t: { id: item.id } }} <strong>{{ label(item.status) }}</strong>{{ (item.status === 'cancelled' || item.status === 'checked_out' ? 'pay.noNeed' : 'pay.fully') | t }}</p>
            <a class="button" [routerLink]="['/bookings', item.id, 'confirmation']">{{ 'pay.viewRes' | t }}</a>
          </div>
        } @else {
          <article class="panel">
            <p class="eyebrow">{{ 'bk.res' | t: { id: item.id } }}</p>
            <h1>{{ 'pay.title' | t }}</h1>
            <dl class="facts"><dt>{{ 'common.checkin' | t }}</dt><dd>{{ item.check_in }}</dd><dt>{{ 'common.checkout' | t }}</dt><dd>{{ item.check_out }}</dd>
              <dt>{{ 'common.nights' | t }}</dt><dd>{{ nights(item.check_in, item.check_out) }}</dd>
              @for (extra of item.extras ?? []; track $index) { <dt>{{ extra.name | content }}</dt><dd>{{ extra.included ? ('ex.included' | t) : money(extra.amount) }}</dd> }
              <dt>{{ 'common.total' | t }}</dt><dd>{{ money(item.total_price) }}</dd>
              @if (paidSoFar(item) > 0) { <dt>{{ 'pay.already' | t }}</dt><dd>{{ money(item.paid_amount ?? 0) }}</dd> }
              <dt>{{ 'pay.due' | t }}</dt><dd><strong>{{ money(due(item)) }}</strong></dd></dl>

            <fieldset class="method-list" [disabled]="busy()">
              <legend>{{ 'pay.how' | t }}</legend>
              @for (option of options(item); track option.value) {
                <label class="method-option" [class.selected]="method() === option.value">
                  <input type="radio" name="method" [value]="option.value" [checked]="method() === option.value" (change)="choose(option.value)" />
                  <span><strong>{{ option.title }}</strong><small>{{ option.hint }}</small></span>
                  <em>{{ money(option.amount) }}</em>
                </label>
              }
            </fieldset>

            @if (method() === 'cash') {
              <p class="notice">{{ 'pay.cashNote' | t: { amount: money(due(item)) } }}</p>
            } @else {
              <p class="notice">{{ 'pay.demo' | t }}</p>
            }
            <form class="form-stack" [formGroup]="form" (ngSubmit)="submit(item)" autocomplete="off">
              @if (method() !== 'cash') {
                <fieldset class="form-stack bare-fieldset" [disabled]="busy()">
                  <label>{{ 'pay.holder' | t }}<input type="text" formControlName="card_holder" autocomplete="cc-name" maxlength="100" /></label>
                  @if (show('card_holder')) { <p class="field-error">{{ 'pay.holderErr' | t }}</p> }
                  <label>{{ 'pay.number' | t }}<input type="text" inputmode="numeric" formControlName="card_number" autocomplete="cc-number" maxlength="23" placeholder="1234 5678 9012 3456" (input)="formatCard($event)" /></label>
                  @if (show('card_number')) { <p class="field-error">{{ 'pay.numberErr' | t }}</p> }
                  <div class="card-row">
                    <label>{{ 'pay.expiry' | t }}<input type="text" inputmode="numeric" formControlName="expiry" autocomplete="cc-exp" maxlength="5" placeholder="MM/YY" (input)="formatExpiry($event)" /></label>
                    <label>{{ 'pay.cvv' | t }}<input type="password" inputmode="numeric" formControlName="cvv" autocomplete="cc-csc" maxlength="4" /></label>
                  </div>
                  @if (show('expiry')) { <p class="field-error">{{ 'pay.expiryErr' | t }}</p> }
                  @if (show('cvv')) { <p class="field-error">{{ 'pay.cvvErr' | t }}</p> }
                </fieldset>
              }
              @if (error()) { <p class="notice error" role="alert">{{ error() }}</p> }
              <button class="button" type="submit" [disabled]="busy()">{{ busy() ? ('pay.processing' | t) : submitLabel(item) }}</button>
              <a class="plain-button" routerLink="/bookings">{{ 'pay.later' | t }}</a>
            </form>
          </article>
        }
      }
    </section>
  `,
})
export class PaymentPage {
  private readonly api = inject(HotelApi);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  readonly booking = signal<Booking | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly method = signal<PaymentMethod>('card');
  readonly money = money;
  readonly nights = nights;
  readonly label = statusLabel;
  readonly form = new FormGroup({
    card_holder: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    card_number: new FormControl('', { nonNullable: true, validators: [cardNumber] }),
    expiry: new FormControl('', { nonNullable: true, validators: [expiry] }),
    cvv: new FormControl('', { nonNullable: true, validators: [Validators.pattern(/^\d{3,4}$/)] }),
  });

  constructor() {
    this.form.valueChanges.pipe(takeUntilDestroyed()).subscribe(() => { this.attemptKey = crypto.randomUUID(); });
    inject(ActivatedRoute).paramMap.pipe(
      switchMap(params => {
        this.loading.set(true);
        return this.api.booking(Number(params.get('id'))).pipe(
          map(booking => ({ booking, error: '' })),
          catchError(error => of({ booking: null, error: apiError(error) })),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe(({ booking, error }) => {
      this.booking.set(booking);
      this.loadError.set(error);
      this.loading.set(false);
      // Someone who already arranged to pay at the hotel starts on the card option.
      this.method.set('card');
    });
  }

  paidSoFar(item: Booking) { return Number(item.paid_amount ?? 0); }
  due(item: Booking) { return Number(item.balance_due ?? item.total_price); }
  payable(item: Booking) { return (item.status === 'pending' || item.status === 'confirmed') && this.due(item) > 0; }

  options(item: Booking) {
    const due = this.due(item);
    const list: { value: PaymentMethod; title: string; hint: string; amount: number }[] = [
      { value: 'card', title: translate('pay.card.title'), hint: translate('pay.card.hint'), amount: due },
    ];
    // A deposit only makes sense before anything else has been paid.
    if (this.paidSoFar(item) === 0 && item.prepayment_amount) {
      list.push({ value: 'prepayment', title: translate('pay.pre.title'), hint: translate('pay.pre.hint'), amount: Number(item.prepayment_amount) });
    }
    if (item.payment_status !== 'pay_at_hotel') {
      list.push({ value: 'cash', title: translate('pay.cash.title'), hint: translate('pay.cash.hint'), amount: due });
    }
    return list;
  }

  choose(method: PaymentMethod) { this.attemptKey = crypto.randomUUID(); this.method.set(method); this.error.set(''); }

  submitLabel(item: Booking) {
    const option = this.options(item).find(entry => entry.value === this.method());
    if (this.method() === 'cash') return translate('pay.reserveHotel');
    return translate(this.method() === 'prepayment' ? 'pay.payDeposit' : 'pay.pay', { amount: money(option?.amount ?? this.due(item)) });
  }

  show(name: keyof PaymentPage['form']['controls']) {
    const control = this.form.controls[name];
    return control.touched && control.invalid;
  }

  formatCard(event: Event) {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 19);
    this.form.controls.card_number.setValue(digits.replace(/(.{4})(?=.)/g, '$1 '));
  }

  formatExpiry(event: Event) {
    const input = event.target as HTMLInputElement;
    const digits = input.value.replace(/\D/g, '').slice(0, 4);
    this.form.controls.expiry.setValue(digits.length > 2 ? digits.slice(0, 2) + '/' + digits.slice(2) : digits);
  }

  private attemptKey = crypto.randomUUID();

  submit(booking: Booking) {
    if (this.busy()) return;
    this.error.set('');
    const method = this.method();
    let body: PaymentInput = { method };
    if (method !== 'cash') {
      this.form.markAllAsTouched();
      if (this.form.invalid) return;
      const value = this.form.getRawValue();
      body = { method, ...value, card_holder: value.card_holder.trim() };
    }
    this.busy.set(true);
    this.api.pay(booking.id, body, this.attemptKey)
      .pipe(takeUntilDestroyed(this.destroy)).subscribe({
        next: () => {
          this.form.reset();
          void this.router.navigate(['/bookings', booking.id, 'confirmation']);
        },
        error: error => {
          this.busy.set(false);
          if (error instanceof HttpErrorResponse && error.status === 403 && !String(error.error?.detail).includes('CSRF')) {
            this.auth.expire();
            void this.router.navigate(['/login'], { queryParams: { returnUrl: '/bookings/' + booking.id + '/payment' } });
            return;
          }
          this.error.set(error instanceof HttpErrorResponse && error.status === 429
            ? translate('pay.tooMany') : apiError(error));
        },
      });
  }
}
