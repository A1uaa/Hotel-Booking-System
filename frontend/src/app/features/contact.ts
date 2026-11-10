import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { apiError, HotelApi } from '../core/api';

@Component({
  imports: [ReactiveFormsModule],
  templateUrl: './contact.html',
})
export class Contact {
  private readonly api = inject(HotelApi);
  private readonly destroy = inject(DestroyRef);
  readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(150), Validators.pattern(/\S/)]],
    email: ['', [Validators.required, Validators.email]],
    subject: ['', [Validators.required, Validators.maxLength(200), Validators.pattern(/\S/)]],
    message: ['', [Validators.required, Validators.maxLength(10000), Validators.pattern(/\S/)]],
  });
  readonly busy = signal(false);
  readonly error = signal('');
  readonly sent = signal(false);

  submit() {
    if (this.busy()) return;
    this.form.markAllAsTouched();
    this.error.set('');
    this.sent.set(false);
    if (this.form.invalid) return;
    this.busy.set(true);
    this.api.contact(this.form.getRawValue()).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: () => { this.busy.set(false); this.sent.set(true); this.form.reset(); },
      error: error => { this.busy.set(false); this.error.set(apiError(error)); },
    });
  }
}
