import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { StaffSession } from './admin-session';
import { mutation } from './admin-state';

@Component({
  imports: [ReactiveFormsModule, RouterLink],
  template: `
    <main class="staff-login">
      <section class="staff-login-visual"><img src="/koktem.svg" alt="" /><p>Koktem Park Hotel</p><small>ALMATY · STAFF PORTAL</small></section>
      <section class="staff-login-form panel">
        <p class="eyebrow">Hotel management</p><h1>Staff sign-in</h1><p>Sign in with your authorized Django staff account.</p>
        <form class="form-stack" [formGroup]="form" (ngSubmit)="submit()">
          <label>Email <input type="email" formControlName="email" autocomplete="username" /></label>
          <label>Password <input type="password" formControlName="password" autocomplete="current-password" /></label>
          @if (form.touched && form.invalid) { <p class="field-error">Enter a valid email address and password.</p> }
          @if (action.error()) { <p class="notice error" role="alert">{{ action.error() }}</p> }
          <button class="button" [disabled]="action.saving()">{{ action.saving() ? 'Signing in…' : 'Sign in' }}</button>
        </form>
        <a class="text-link" routerLink="/">← Customer website</a>
      </section>
    </main>
  `,
})
export class AdminLogin {
  private readonly staff = inject(StaffSession);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly action = mutation();
  readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]], password: ['', Validators.required],
  });

  submit() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    const next = this.route.snapshot.queryParamMap.get('next');
    const destination = next && /^\/admin(?:\/(?:rooms|reservations|guests|front-desk|reports))?(?:\?.*)?$/.test(next)
      ? next : '/admin';
    this.action.run(this.staff.login(this.form.getRawValue()), '', () => {
      void this.router.navigateByUrl(destination);
    });
  }
}
