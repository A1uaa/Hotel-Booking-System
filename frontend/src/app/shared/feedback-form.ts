import { Component, DestroyRef, inject, input, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { apiError, HotelApi, RoomReviews } from '../core/api';
import { translate, TranslatePipe } from '../core/i18n';
import { StarInput } from './stars';

/** "How was your experience?" Anyone can leave feedback on a room: no booking or account is needed. */
@Component({
  selector: 'app-feedback-form',
  imports: [StarInput, TranslatePipe],
  template: `
    <form class="feedback-form" (submit)="$event.preventDefault(); send()">
      <p class="eyebrow">{{ 'ff.eyebrow' | t }}</p>
      <h3>{{ 'ff.title' | t }}</h3>
      <p class="muted">{{ 'ff.hint' | t }}</p>
      <app-star-input [(value)]="rating" />
      @if (rating() > 0) { <p class="rating-chip" role="status">{{ 'ff.chip' | t: { rating: rating(), word: word() } }}</p> }
      <label>{{ 'ff.name' | t }}<input maxlength="80" autocomplete="given-name" [value]="name()" (input)="name.set(read($event))" /></label>
      <label>{{ 'ff.comment' | t }}<textarea rows="3" maxlength="2000" [value]="comment()" (input)="comment.set(read($event))"></textarea></label>
      @if (error()) { <p class="notice error" role="alert">{{ error() }}</p> }
      @if (done()) { <p class="notice success" role="status">{{ 'ff.thanks' | t }}</p> }
      <button class="button" type="submit" [disabled]="busy()">{{ (busy() ? 'ff.sending' : 'ff.send') | t }}</button>
    </form>
  `,
})
export class FeedbackForm {
  private readonly api = inject(HotelApi);
  private readonly destroy = inject(DestroyRef);
  readonly roomId = input.required<number>();
  /** The refreshed review list, sent after feedback was saved. */
  readonly saved = output<RoomReviews>();
  readonly rating = signal(0);
  readonly name = signal('');
  readonly comment = signal('');
  readonly busy = signal(false);
  readonly error = signal('');
  readonly done = signal(false);

  word() { return this.rating() > 0 ? translate('ff.w' + this.rating()) : ''; }
  read(event: Event) { return (event.target as HTMLInputElement | HTMLTextAreaElement).value; }

  send() {
    if (this.busy()) return;
    this.done.set(false);
    if (this.rating() < 1) { this.error.set(translate('ff.choose')); return; }
    this.error.set('');
    this.busy.set(true);
    this.api.addReview(this.roomId(), {
      rating: this.rating(), comment: this.comment().trim(), name: this.name().trim(),
    }).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: result => {
        this.busy.set(false);
        this.done.set(true);
        this.rating.set(0);
        this.comment.set('');
        this.saved.emit(result);
      },
      error: error => { this.busy.set(false); this.error.set(apiError(error)); },
    });
  }
}
