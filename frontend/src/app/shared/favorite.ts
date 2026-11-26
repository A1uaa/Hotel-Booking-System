import { Component, DestroyRef, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Auth } from '../core/auth';
import { Member } from '../core/member';
import { apiError } from '../core/api';
import { TranslatePipe } from '../core/i18n';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-favorite', imports: [TranslatePipe],
  template: `<button type="button" class="favorite-button" [attr.aria-label]="'member.favorites' | t" [attr.aria-pressed]="saved()" [disabled]="busy()" (click)="toggle()">{{ saved() ? '♥' : '♡' }}</button>
    @if (error()) { <span role="alert" class="field-error">{{ error() }}</span> }`,
})
export class FavoriteButton {
  readonly roomId = input.required<number>();
  readonly saved = signal(false);
  readonly busy = signal(false);
  readonly error = signal('');
  private readonly member = inject(Member);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly destroy = inject(DestroyRef);

  ngOnInit() {
    this.auth.restore().pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: user => { if (user) this.member.favorites().pipe(takeUntilDestroyed(this.destroy)).subscribe({
        next: rooms => this.saved.set(rooms.some(room => room.id === this.roomId())), error: () => {},
      }); }, error: () => {},
    });
  }
  toggle() {
    if (!this.auth.user()) { void this.router.navigate(['/login'], {queryParams: {returnUrl: this.router.url}}); return; }
    this.busy.set(true); this.error.set('');
    const path = 'account/favorites/' + this.roomId() + '/';
    (this.saved() ? this.member.api.delete(path) : this.member.api.post(path, {}))
      .pipe(takeUntilDestroyed(this.destroy)).subscribe({
        next: () => { this.saved.set(!this.saved()); this.busy.set(false); },
        error: error => { this.error.set(apiError(error)); this.busy.set(false); },
      });
  }
}

