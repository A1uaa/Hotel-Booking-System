import { HotelApi } from '../../core/api';
import { TranslatePipe, translate } from '../../core/i18n';
import { Component, computed, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Stars } from '../../shared/stars';
import { AdminApi, ManagedReview } from './admin-api';
import { StaffSession } from './admin-session';
import { mutation, resource } from './admin-state';

@Component({
  imports: [TranslatePipe, ReactiveFormsModule, Stars],
  template: `
    <div class="staff-heading"><div><p class="eyebrow">Guests</p><h1>Reviews</h1><p>Read guest feedback and hide a review from the website. A hidden review is kept here and can be shown again.</p></div></div>
    <form class="staff-panel staff-filters" [formGroup]="filter" (ngSubmit)="search()">
      <label>Search<input formControlName="q" placeholder="Name, email, room or comment" /></label>
      <label>Visibility<select formControlName="visibility"><option value="">All reviews</option><option value="visible">Visible</option><option value="hidden">Hidden</option></select></label>
      <label>Rating<select formControlName="rating"><option value="">Any rating</option>@for (star of stars; track star) { <option [value]="star">{{ star }} {{ star === 1 ? 'star' : 'stars' }}</option> }</select></label>
      <button class="button">Search</button><button class="plain-button" type="button" (click)="clear()">Reset</button>
    </form>
    @if (action.feedback()) { <p class="notice success" role="status">{{ action.feedback() }}</p> }
    @if (action.error()) { <p class="notice error" role="alert">{{ action.error() }}</p> }
    @if (list.loading()) { <p class="notice" role="status">Loading reviews…</p> }
    @else if (list.error()) { <p class="notice error" role="alert">{{ list.error() }}</p><button class="button outline" (click)="load()">Retry</button> }
    @else if (list.data(); as rows) {
      <div class="staff-metrics">
        <article class="staff-metric"><p>Reviews shown</p><strong>{{ summary().visible }}</strong><small>Visible on the website</small></article>
        <article class="staff-metric"><p>Average rating</p><strong>{{ summary().average }}</strong><small>Of the visible reviews below</small></article>
        <article class="staff-metric"><p>Hidden</p><strong>{{ summary().hidden }}</strong><small>Not shown to guests</small></article>
      </div>
      <div class="staff-panel staff-table-wrap">
        <table class="staff-table"><caption>{{ rows.length }} reviews</caption>
          <thead><tr><th>Review</th><th>Room</th><th>Author</th><th>Rating</th><th>Comment</th><th>Status</th><th>Date</th>
            @if (canModerate()) { <th><span class="visually-hidden">Actions</span></th> }</tr></thead>
          <tbody>@for (row of rows; track row.id) {
            <tr [id]="'review-' + row.id"><th scope="row">#{{ row.id }}</th><td>Room {{ row.room_number }}</td>
              <td>{{ row.author_name }}@if (row.guest) { <br /><small class="muted">{{ row.guest.email }}</small> } @else { <br /><small class="muted">Visitor</small> }</td>
              <td><app-stars [value]="row.rating" /></td>
              <td class="review-comment">{{ row.comment || '—' }}</td>
              <td><span class="badge" [attr.data-status]="row.is_hidden ? 'hidden' : 'visible'">{{ row.is_hidden ? 'Hidden' : 'Visible' }}</span></td>
              <td>{{ row.created_at.slice(0, 10) }}</td>
              @if (canModerate()) {
                <td><div class="staff-actions">
                  @if (canHide()) { <button class="button button-small outline" (click)="toggle(row)" [disabled]="action.saving()">{{ row.is_hidden ? 'Show' : 'Hide' }}</button> }
                  @if (canDelete()) { <button class="plain-button" (click)="remove(row)" [disabled]="action.saving()">{{ 'member.delete' | t }}</button> }
                </div></td>
              }
            </tr>
          } @empty { <tr><td [attr.colspan]="canModerate() ? 8 : 7">No reviews to display.</td></tr> }</tbody>
        </table>
      </div>
    }
  `,
})
export class AdminReviews {
  private readonly api = inject(AdminApi);
  private readonly staff = inject(StaffSession);
  readonly canModerate = () => this.staff.current()?.capabilities.moderateReviews || this.staff.current()?.capabilities.deleteReviews;
  readonly canHide = () => this.staff.current()?.capabilities.moderateReviews;
  readonly canDelete = () => this.staff.current()?.capabilities.deleteReviews;
  private readonly http = inject(HotelApi);
  readonly list = resource<ManagedReview[]>();
  readonly action = mutation();
  readonly filter = inject(FormBuilder).nonNullable.group({ q: '', visibility: '', rating: '' });
  readonly stars = [5, 4, 3, 2, 1];
  private applied = this.filter.getRawValue();

  readonly summary = computed(() => {
    const rows = this.list.data() ?? [];
    const visible = rows.filter(row => !row.is_hidden);
    const average = visible.length ? (visible.reduce((sum, row) => sum + row.rating, 0) / visible.length).toFixed(1) : '—';
    return { visible: visible.length, hidden: rows.length - visible.length, average };
  });

  constructor() { this.load(); }
  search() { this.applied = this.filter.getRawValue(); this.load(); }
  clear() { this.filter.reset(); this.search(); }
  load() { this.list.load(this.api.reviews(this.applied)); }

  remove(row: ManagedReview) {
    if (!window.confirm(translate('member.deleteConfirm'))) return;
    this.action.run(this.http.delete('admin/reviews/' + row.id + '/'), translate('member.saved'), () => this.load());
  }

  toggle(row: ManagedReview) {
    const hide = !row.is_hidden;
    const message = hide ? 'Review hidden from the website.' : 'Review is visible on the website again.';
    this.action.run(this.api.setReviewHidden(row.id, hide), message, () => this.load());
  }
}
