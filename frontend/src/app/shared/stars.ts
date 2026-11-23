import { Component, computed, input, model } from '@angular/core';
import { translate, TranslatePipe } from '../core/i18n';

/** Read-only stars. A fractional value, such as an average, is rounded to whole stars. */
@Component({
  selector: 'app-stars',
  template: `<span class="stars" role="img" [attr.aria-label]="label()"><span aria-hidden="true">{{ glyphs() }}</span></span>`,
})
export class Stars {
  readonly value = input.required<number>();
  private readonly whole = computed(() => Math.min(5, Math.max(0, Math.round(this.value()))));
  readonly glyphs = computed(() => '★'.repeat(this.whole()) + '☆'.repeat(5 - this.whole()));
  readonly label = computed(() => translate('stars.label', { value: this.value() }));
}

/** Five buttons that pick a rating from 1 to 5. */
@Component({
  selector: 'app-star-input',
  imports: [TranslatePipe],
  template: `
    <div class="star-input" role="radiogroup" [attr.aria-label]="'stars.input' | t">
      @for (star of stars; track star) {
        <button type="button" role="radio" [attr.aria-checked]="value() === star"
          [attr.aria-label]="'stars.n' | t: { count: star }" [class.on]="star <= value()"
          (click)="value.set(star)">{{ star <= value() ? '★' : '☆' }}</button>
      }
    </div>
  `,
})
export class StarInput {
  readonly value = model(0);
  readonly stars = [1, 2, 3, 4, 5];
}
