import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Member, ReviewHistory, PaymentHistory, Notices, OwnReview } from '../../core/member';
import { Room } from '../../core/api';
import { TranslatePipe, translate, language, LOCALES } from '../../core/i18n';
import { money, statusLabel } from '../../shared/stay';
import { RoomCard } from '../../shared/room-card';
import { resource, mutation } from '../admin/admin-state';
import { StarInput } from '../../shared/stars';

@Component({
  imports: [RouterLink, FormsModule, TranslatePipe, RoomCard, StarInput],
  templateUrl: './history.html',
})
export class HistoryPage {
  readonly mode = inject(ActivatedRoute).snapshot.data['mode'] as string;
  readonly member = inject(Member);
  readonly favorites = resource<Room[]>();
  readonly reviews = resource<ReviewHistory>();
  readonly payments = resource<PaymentHistory>();
  readonly notices = resource<Notices>();
  readonly action = mutation();
  readonly edited = signal<OwnReview | null>(null);
  readonly rating = signal(5);
  comment = '';
  paymentStatus = '';
  noticePage = 1;
  readonly statuses = ['pending','paid','failed','refunded','cancelled'];
  readonly money = money;
  readonly label = statusLabel;
  readonly t = translate;
  constructor() { this.load(); }
  load() {
    if (this.mode === 'favorites') this.favorites.load(this.member.favorites());
    if (this.mode === 'reviews') this.reviews.load(this.member.reviews());
    if (this.mode === 'payments') this.payments.load(this.member.payments(this.paymentStatus));
    if (this.mode === 'notifications') this.notices.load(this.member.notifications(this.noticePage));
  }
  loading() { return this.favorites.loading() || this.reviews.loading() || this.payments.loading() || this.notices.loading(); }
  error() { return this.favorites.error() || this.reviews.error() || this.payments.error() || this.notices.error(); }
  removeFavorite(id: number) {
    this.action.run(this.member.api.delete('account/favorites/' + id + '/'), 'done', () => this.load());
  }
  edit(review: OwnReview) { this.edited.set(review); this.rating.set(review.rating); this.comment = review.comment; }
  save() {
    this.action.run(this.member.api.patch('account/reviews/' + this.edited()!.id + '/', {
      rating: this.rating(), comment: this.comment,
    }), 'done', () => { this.edited.set(null); this.load(); });
  }
  removeReview(id: number) {
    if (!window.confirm(translate('member.deleteConfirm'))) return;
    this.action.run(this.member.api.delete('account/reviews/' + id + '/'), 'done', () => this.load());
  }
  read(id?: number) {
    this.action.run(this.member.api.post('account/notifications/' + (id ? id + '/read/' : 'read-all/'), {}), 'done', () => this.load());
  }
  date(value: string) { return new Date(value).toLocaleString(LOCALES[language()], {timeZone:'Asia/Almaty'}); }
}
