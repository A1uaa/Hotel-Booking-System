import { Component, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RoomFilters } from '../core/api';
import { hotelToday, stayDates } from './stay';

@Component({
  selector: 'app-stay-search',
  imports: [ReactiveFormsModule],
  template: `
    <form class="stay-search" [formGroup]="form" (ngSubmit)="submit()">
      <label>Check-in<input type="date" formControlName="check_in" [min]="today()" /></label>
      <label>Check-out<input type="date" formControlName="check_out" [min]="form.value.check_in || today()" /></label>
      <label>Guests<input type="number" formControlName="guests" min="1" max="32767" /></label>
      <button class="button" type="submit">Find a room <span aria-hidden="true">↗</span></button>
      @if (form.invalid && attempted) {
        <p class="notice error" role="alert">Enter a valid guest count and both dates, with checkout after check-in.</p>
      }
    </form>
  `,
})
export class StaySearch {
  readonly initial = input<RoomFilters>({});
  readonly search = output<RoomFilters>();
  readonly today = hotelToday;
  attempted = false;
  readonly form = new FormGroup({
    check_in: new FormControl('', { nonNullable: true }),
    check_out: new FormControl('', { nonNullable: true }),
    guests: new FormControl<number | null>(2, [Validators.required, Validators.min(1), Validators.max(32767), Validators.pattern(/^\d+$/)]),
  }, stayDates);

  ngOnInit() { this.form.patchValue(this.initial()); }

  submit() {
    this.attempted = true;
    if (this.form.invalid) return;
    const { check_in, check_out, guests } = this.form.getRawValue();
    this.search.emit({ guests: guests!, ...(check_in ? { check_in, check_out } : {}) });
  }
}
