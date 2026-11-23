import { Component, input, output } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { RoomFilters } from '../core/api';
import { TranslatePipe } from '../core/i18n';
import { hotelToday, stayDates } from './stay';

@Component({
  selector: 'app-stay-search',
  imports: [ReactiveFormsModule, TranslatePipe],
  template: `
    <form class="stay-search" [formGroup]="form" (ngSubmit)="submit()">
      <label>{{ 'common.checkin' | t }}<input type="date" formControlName="check_in" [min]="today()" /></label>
      <label>{{ 'common.checkout' | t }}<input type="date" formControlName="check_out" [min]="form.value.check_in || today()" /></label>
      <label>{{ 'common.guests' | t }}<input type="number" formControlName="guests" min="1" max="32767" /></label>
      <button class="button" type="submit">{{ 'search.find' | t }} <span aria-hidden="true">↗</span></button>
      @if (form.invalid && attempted) {
        <p class="notice error" role="alert">{{ 'search.error' | t }}</p>
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
