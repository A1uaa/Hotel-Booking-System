import { HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, finalize, map, of, shareReplay, tap, throwError } from 'rxjs';
import { Account, Credentials, HotelApi } from './api';

@Injectable({ providedIn: 'root' })
export class Auth {
  private readonly api = inject(HotelApi);
  private readonly account = signal<Account | null>(null);
  private readonly initialized = signal(false);
  private pending?: ReturnType<Auth['requestSession']>;
  readonly user = this.account.asReadonly();
  readonly ready = this.initialized.asReadonly();

  restore() {
    if (this.ready()) return of(this.user());
    return this.pending ??= this.requestSession();
  }

  private requestSession() {
    return this.api.me().pipe(
      catchError(error => error instanceof HttpErrorResponse && error.status === 403
        ? of(null) : throwError(() => error)),
      map(user => this.ready() ? this.user() : user),
      tap(user => { this.account.set(user); this.initialized.set(true); }),
      finalize(() => { this.pending = undefined; }),
      shareReplay(1),
    );
  }

  login(credentials: Credentials) {
    return this.api.login(credentials).pipe(tap(user => this.adopt(user)));
  }

  adopt(user: Account) {
    this.account.set(user);
    this.initialized.set(true);
  }

  logout() {
    return this.api.logout().pipe(tap(() => this.account.set(null)));
  }

  expire() {
    this.account.set(null);
    this.initialized.set(true);
  }
}

export const requireSession: CanActivateFn = (_, state) => {
  const auth = inject(Auth);
  const router = inject(Router);
  const login = router.createUrlTree(['/login'], { queryParams: { returnUrl: state.url } });
  return auth.restore().pipe(map(user => user ? true : login), catchError(() => of(login)));
};

export function safeReturnUrl(value: string | null): string {
  return value && /^\/(rooms|bookings)(?:[/?]|$)/.test(value) ? value : '/bookings';
}
