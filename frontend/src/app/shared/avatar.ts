import { Component, effect, input, signal } from '@angular/core';

@Component({
  selector: 'app-avatar',
  template: `<span class="profile-avatar" [class.large]="large()">
    @if (photo() && !failed()) { <img [src]="photo()" alt="" (error)="failed.set(true)" /> }
    @else {
      <svg viewBox="0 0 32 32" fill="none" aria-hidden="true">
        <circle cx="16" cy="11" r="5" stroke="currentColor" stroke-width="1.5"/>
        <path d="M6 28v-2a10 10 0 0 1 20 0v2" stroke="currentColor" stroke-width="1.5"/>
      </svg>
    }
  </span>`,
})
export class Avatar {
  readonly photo = input<string | null | undefined>(null);
  readonly large = input(false);
  readonly failed = signal(false);
  constructor() { effect(() => { this.photo(); this.failed.set(false); }); }
}
