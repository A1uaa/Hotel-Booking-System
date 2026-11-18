import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { AbstractControl, FormControl, FormGroup, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { apiError, Booking, HotelApi, PaymentInput, PaymentMethod } from '../core/api';
import { Auth } from '../core/auth';
import { money, nights } from '../shared/stay';

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
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <section class="shell section narrow">
      @if (loading()) { <p class="notice" role="status">Loading your reservation…</p> }
      @else if (loadError()) { <p class="notice error" role="alert">{{ loadError() }}</p><a class="button" routerLink="/bookings">My bookings</a> }
      @else if (booking(); as item) {
        @if (!payable(item)) {
          <div class="panel">
            <h1>Nothing to pay</h1>
            <p>Reservation #{{ item.id }} is <strong>{{ item.status.replaceAll('_', ' ') }}</strong>{{ item.status === 'cancelled' || item.status === 'checked_out' ? ', so it does not need a payment.' : ' and is fully paid.' }}</p>
            <a class="button" [routerLink]="['/bookings', item.id, 'confirmation']">View reservation</a>
          </div>
        } @else {
          <article class="panel">
            <p class="eyebrow">Reservation #{{ item.id }}</p>
            <h1>Payment</h1>
            <dl class="facts"><dt>Check-in</dt><dd>{{ item.check_in }}</dd><dt>Check-out</dt><dd>{{ item.check_out }}</dd>
              <dt>Nights</dt><dd>{{ nights(item.check_in, item.check_out) }}</dd>
              <dt>Total</dt><dd>{{ money(item.total_price) }}</dd>
              @if (paidSoFar(item) > 0) { <dt>Already paid</dt><dd>{{ money(item.paid_amount ?? 0) }}</dd> }
              <dt>Amount due</dt><dd><strong>{{ money(due(item)) }}</strong></dd></dl>

            <fieldset class="method-list" [disabled]="busy()">
              <legend>How would you like to pay?</legend>
              @for (option of options(item); track option.value) {
                <label class="method-option" [class.selected]="method() === option.value">
                  <input type="radio" name="method" [value]="option.value" [checked]="method() === option.value" (change)="choose(option.value)" />
                  <span><strong>{{ option.title }}</strong><small>{{ option.hint }}</small></span>
                  <em>{{ money(option.amount) }}</em>
                </label>
              }
            </fieldset>

            @if (method() === 'cash') {
              <p class="notice">Your room is reserved now. Pay {{ money(due(item)) }} in cash (or by card at the desk) when you arrive. Staff mark the payment as received.</p>
            } @else {
              <p class="notice">Demo payment: no real charge is made. Use 4242 4242 4242 4242 to succeed, or 4000 0000 0000 0002 to see a declined card.</p>
            }
            <form class="form-stack" [formGroup]="form" (ngSubmit)="submit(item)" autocomplete="off">
              @if (method() !== 'cash') {
                <fieldset class="form-stack bare-fieldset" [disabled]="busy()">
                  <label>Name on card<input type="text" formControlName="card_holder" autocomplete="cc-name" maxlength="100" /></label>
                  @if (show('card_holder')) { <p class="field-error">Enter the name on the card.</p> }
                  <label>Card number<input type="text" inputmode="numeric" formControlName="card_number" autocomplete="cc-number" maxlength="23" placeholder="1234 5678 9012 3456" (input)="formatCard($event)" /></label>
                  @if (show('card_number')) { <p class="field-error">Enter a valid card number.</p> }
                  <div class="card-row">
                    <label>Expiry (MM/YY)<input type="text" inputmode="numeric" formControlName="expiry" autocomplete="cc-exp" maxlength="5" placeholder="MM/YY" (input)="formatExpiry($event)" /></label>
                    <label>CVV<input type="password" inputmode="numeric" formControlName="cvv" autocomplete="cc-csc" maxlength="4" /></label>
                  </div>
                  @if (show('expiry')) { <p class="field-error">Enter a valid, unexpired date as MM/YY.</p> }
                  @if (show('cvv')) { <p class="field-error">Enter the 3 or 4 digit security code.</p> }
                </fieldset>
              }
              @if (error()) { <p class="notice error" role="alert">{{ error() }}</p> }
              <button class="button" type="submit" [disabled]="busy()">{{ busy() ? 'Processing…' : submitLabel(item) }}</button>
              <a class="plain-button" routerLink="/bookings">Decide later</a>
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
  readonly form = new FormGroup({
    card_holder: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.maxLength(100)] }),
    card_number: new FormControl('', { nonNullable: true, validators: [cardNumber] }),
    expiry: new FormControl('', { nonNullable: true, validators: [expiry] }),
    cvv: new FormControl('', { nonNullable: true, validators: [Validators.pattern(/^\d{3,4}$/)] }),
  });

  constructor() {
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
      { value: 'card', title: 'Pay by card', hint: 'Pay the full amount now and confirm instantly.', amount: due },
    ];
    // A deposit only makes sense before anything else has been paid.
    if (this.paidSoFar(item) === 0 && item.prepayment_amount) {
      list.push({ value: 'prepayment', title: 'Prepayment by card', hint: 'Pay a 30% deposit now, the rest at the hotel.', amount: Number(item.prepayment_amount) });
    }
    if (item.payment_status !== 'pay_at_hotel') {
      list.push({ value: 'cash', title: 'Pay at the hotel', hint: 'Cash or card at the front desk. Nothing to pay now.', amount: due });
    }
    return list;
  }

  choose(method: PaymentMethod) { this.method.set(method); this.error.set(''); }

  submitLabel(item: Booking) {
    const option = this.options(item).find(entry => entry.value === this.method());
    if (this.method() === 'cash') return 'Reserve and pay at the hotel';
    return (this.method() === 'prepayment' ? 'Pay deposit ' : 'Pay ') + money(option?.amount ?? this.due(item));
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
    this.api.pay(booking.id, body)
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
            ? 'Too many payment attempts. Please wait a minute and try again.' : apiError(error));
        },
      });
  }
}
