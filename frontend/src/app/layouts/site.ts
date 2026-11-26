import { Subject, concatMap, catchError, EMPTY } from 'rxjs';
import { Avatar } from '../shared/avatar';
import { NotificationBell } from '../shared/notifications';
import { Member } from '../core/member';
import { Component, DestroyRef, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { apiError } from '../core/api';
import { Auth } from '../core/auth';
import { Lang, TranslatePipe } from '../core/i18n';
import { LanguageSwitcher } from '../shared/language-switcher';

@Component({
  selector: 'app-site',
  imports: [Avatar, NotificationBell, RouterLink, RouterLinkActive, RouterOutlet, TranslatePipe, LanguageSwitcher],
  templateUrl: './site.html',
})
export class Site {
  readonly member = inject(Member);
  readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);
  private readonly languageChanges = new Subject<Lang>();
  readonly menu = signal(false);
  readonly leaving = signal(false);
  readonly error = signal('');

  constructor() {
    this.languageChanges.pipe(
      concatMap(lang => this.member.saveProfile({preferred_language:lang}).pipe(
        catchError(error => { this.error.set(apiError(error)); return EMPTY; }),
      )),
      takeUntilDestroyed(),
    ).subscribe();
    this.auth.restore().pipe(takeUntilDestroyed()).subscribe({ error: () => {} });
    effect(cleanup => {
      const user = this.auth.user();
      this.member.profile.set(null);
      if (user) {
        const subscription = this.member.loadProfile().subscribe({error:()=>{}});
        cleanup(() => subscription.unsubscribe());
      }
    });
  }

  saveLanguage(lang: Lang) {
    if (this.auth.user()) this.languageChanges.next(lang);
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
