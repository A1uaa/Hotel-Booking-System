import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { TranslatePipe } from '../../core/i18n';
import { Auth } from '../../core/auth';
import { mutation } from '../admin/admin-state';

@Component({
  imports: [RouterLink, RouterLinkActive, RouterOutlet, TranslatePipe],
  template: `<section class="shell section member-layout">
    <nav class="panel member-nav" [attr.aria-label]="'nav.account' | t">
      @for (page of pages; track page) { <a [routerLink]="'/account/' + page" routerLinkActive="active">{{ 'member.' + page | t }}</a> }
      <button class="plain-button" [disabled]="action.saving()" (click)="logout()">{{ 'nav.logout' | t }}</button>
      @if (action.error()) { <p class="field-error">{{ action.error() }}</p> }
    </nav><div class="member-content"><router-outlet /></div>
  </section>`,
})
export class MemberLayout {
  readonly pages = ['profile','favorites','bookings','reviews','payments','security','preferences','notifications'];
  readonly action = mutation();
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  logout() { this.action.run(this.auth.logout(), '', () => { void this.router.navigate(['/']); }); }
}
