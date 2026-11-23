import { Component, computed, input } from '@angular/core';
import { translate, TranslatePipe } from '../core/i18n';
import { Stars } from './stars';

/** The "community pulse": the average score in a ring and how many guests gave each star rating. */
@Component({
  selector: 'app-rating-summary',
  imports: [Stars, TranslatePipe],
  template: `
    <div class="rating-summary">
      <div class="rating-ring" [style.--pct]="ringPercent()" role="img" [attr.aria-label]="label()">
        <div class="rating-ring-inner">
          <strong>{{ average() === null ? '—' : average()!.toFixed(1) }}</strong>
          <small>{{ 'rs.avg' | t }}</small>
        </div>
      </div>
      <div class="rating-side">
        <app-stars [value]="average() ?? 0" />
        <p class="muted">{{ 'reviews.count' | t: { count: count() } }}</p>
        <ul class="rating-bars" [attr.aria-label]="'rs.breakdown' | t">
          @for (row of rows(); track row.star) {
            <li>
              <span class="bar-label">{{ row.star }} <span aria-hidden="true">★</span></span>
              <span class="bar" aria-hidden="true"><span [style.width.%]="row.percent"></span></span>
              <span class="bar-percent">{{ row.percent }}%<span class="visually-hidden"> {{ 'rs.gave' | t: { star: row.star } }}</span></span>
            </li>
          }
        </ul>
      </div>
    </div>
  `,
})
export class RatingSummary {
  readonly average = input<number | null>(null);
  readonly count = input(0);
  readonly breakdown = input<Record<string, number>>({});
  readonly ringPercent = computed(() => Math.min(100, Math.max(0, ((this.average() ?? 0) / 5) * 100)));
  readonly label = computed(() => this.average() === null
    ? translate('rs.none') : translate('rs.aria', { value: this.average()! }));
  readonly rows = computed(() => {
    const total = Math.max(this.count(), 1);
    return [5, 4, 3, 2, 1].map(star => ({
      star, percent: Math.round(((this.breakdown()[String(star)] ?? 0) / total) * 100),
    }));
  });
}
