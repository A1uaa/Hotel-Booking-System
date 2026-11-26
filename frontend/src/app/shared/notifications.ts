import { Component, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { merge, timer, switchMap, catchError, EMPTY } from 'rxjs';
import { Member, Notices } from '../core/member';
import { TranslatePipe, translate, language, LOCALES } from '../core/i18n';

@Component({
  selector: 'app-notifications', imports: [RouterLink, TranslatePipe],
  template: `<details class="notification-menu">
    <summary [attr.aria-label]="'member.notifications' | t">🔔 <span>{{ data().unread }}</span></summary>
    <div class="notification-panel">
      <strong>{{ 'member.notifications' | t }}</strong>
      <button class="plain-button" (click)="markAll()">{{ 'member.readAll' | t }}</button>
      @for (notice of data().results.slice(0, 5); track notice.id) {
        <a [routerLink]="notice.path.split('#')[0]" [fragment]="notice.path.split('#')[1]" (click)="read(notice.id)" [class.unread]="!notice.is_read">{{ text(notice.kind) }} #{{ notice.parameters.id }}<small>{{ date(notice.created_at) }}</small></a>
      } @empty { <p>{{ 'member.noNotifications' | t }}</p> }
      <a [routerLink]="admin() ? '/admin/notifications' : '/account/notifications'">{{ 'member.viewAll' | t }}</a>
      @if (error()) { <p class="field-error" role="alert">{{ error() }}</p> }
    </div></details>`,
})
export class NotificationBell {
  readonly admin = input(false);
  private readonly member = inject(Member);
  readonly data = signal<Notices>({unread: 0, results: []});
  readonly error = signal('');
  constructor() {
    merge(timer(0, 30000), this.member.changes).pipe(switchMap(() => this.member.notifications().pipe(catchError(() => EMPTY))), takeUntilDestroyed())
      .subscribe(data => this.data.set(data));
  }
  text(key: string) { return translate('event.' + key); }
  date(value: string) { return new Date(value).toLocaleString(LOCALES[language()], {timeZone:'Asia/Almaty'}); }
  read(id: number) { this.mark('account/notifications/' + id + '/read/'); }
  markAll() { this.mark('account/notifications/read-all/'); }
  private mark(path: string) {
    this.member.api.post(path, {}).pipe(switchMap(() => this.member.notifications())).subscribe({
      next: value => { this.data.set(value); this.error.set(''); }, error: () => this.error.set(translate('err.failed')),
    });
  }
}
