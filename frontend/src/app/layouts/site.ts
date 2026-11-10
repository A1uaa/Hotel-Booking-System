import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { apiError } from '../core/api';
import { Auth } from '../core/auth';

@Component({
  selector: 'app-site',
  imports: [RouterLink, RouterLinkActive, RouterOutlet],
  templateUrl: './site.html',
})
export class Site {
  readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  readonly menu = signal(false);
  readonly leaving = signal(false);
  readonly error = signal('');

  constructor() {
    this.auth.restore().pipe(takeUntilDestroyed()).subscribe({ error: () => {} });
  }

  logout() {
    if (this.leaving()) return;
    this.leaving.set(true);
    this.error.set('');
    this.auth.logout().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: () => {
        this.leaving.set(false);
        this.menu.set(false);
        void this.router.navigate(['/']);
      },
      error: error => { this.leaving.set(false); this.error.set(apiError(error)); },
    });
  }
}
