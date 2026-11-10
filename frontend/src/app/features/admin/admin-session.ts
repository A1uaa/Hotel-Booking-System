import { Injectable, inject, signal } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of, tap } from 'rxjs';
import { Auth } from '../../core/auth';
import { Credentials } from '../../core/api';
import { AdminApi, AdminSession } from './admin-api';

@Injectable({ providedIn: 'root' })
export class StaffSession {
  private readonly api = inject(AdminApi);
  private readonly auth = inject(Auth);
  private readonly session = signal<AdminSession | null>(null);
  readonly current = this.session.asReadonly();

  verify() {
    return this.api.me().pipe(tap({
      next: result => this.set(result),
      error: () => this.session.set(null),
    }));
  }
  login(data: Credentials) { return this.api.login(data).pipe(tap(result => this.set(result))); }
  logout() { return this.auth.logout().pipe(tap(() => this.session.set(null))); }
  private set(result: AdminSession) {
    this.session.set(result);
    this.auth.adopt(result.account);
  }
}

export const staffGuard: CanActivateFn = (_, state) => {
  const router = inject(Router);
  const redirect = router.createUrlTree(['/admin/login'], { queryParams: { next: state.url } });
  return inject(StaffSession).verify().pipe(map(() => true), catchError(() => of(redirect)));
};
