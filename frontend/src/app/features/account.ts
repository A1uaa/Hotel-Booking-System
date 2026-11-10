import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiError, HotelApi } from '../core/api';
import { Auth, safeReturnUrl } from '../core/auth';

@Component({ imports: [ReactiveFormsModule, RouterLink], templateUrl: './account.html' })
export class AccountPage {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly auth = inject(Auth);
  private readonly api = inject(HotelApi);
  private readonly destroy = inject(DestroyRef);
  readonly register = this.route.snapshot.data['register'] === true;
  readonly returnUrl = safeReturnUrl(this.route.snapshot.queryParamMap.get('returnUrl'));
  readonly registered = this.route.snapshot.queryParamMap.get('registered') === '1';
  readonly busy = signal(false);
  readonly error = signal('');
  readonly form = new FormGroup({
    email: new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email, Validators.maxLength(254)] }),
    password: new FormControl('', { nonNullable: true, validators: [
      Validators.required, Validators.maxLength(128), ...(this.register ? [Validators.minLength(8)] : []),
    ] }),
  });

  submit() {
    if (this.busy()) return;
    this.form.markAllAsTouched();
    this.error.set('');
    if (this.form.invalid) return;
    this.busy.set(true);
    const { email, password } = this.form.getRawValue();
    const data = { email: email.trim(), password };
    const action = this.register ? this.api.register(data) : this.auth.login(data);
    action.pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: () => {
        if (this.register) {
          void this.router.navigate(['/login'], { queryParams: { registered: '1', returnUrl: this.returnUrl } });
        } else {
          void this.router.navigateByUrl(this.returnUrl);
        }
      },
      error: error => { this.busy.set(false); this.error.set(apiError(error)); },
    });
  }
}
