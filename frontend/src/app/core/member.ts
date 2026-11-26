import { setLanguage } from './i18n';
import { Injectable, inject, signal } from '@angular/core';
import { tap } from 'rxjs';
import { HotelApi, Room, Review, Booking, Payment } from './api';

export interface Profile {
  id: number; email: string; first_name: string; last_name: string; phone: string;
  photo: string | null; role: string; preferred_language: 'en' | 'ru' | 'kk';
}
export interface OwnReview extends Review {
  room: number; room_number: string; booking: number | null; is_hidden: boolean;
}
export interface ReviewHistory { reviews: OwnReview[]; eligible: Booking[]; }
export interface Notice { id: number; kind: string; parameters: {id: number}; path: string; is_read: boolean; created_at: string; }
export interface Notices { count?:number;page?:number;unread: number; results: Notice[]; }
export interface PaymentHistory { payments: (Payment & {room_number: string})[]; bookings: Booking[]; }

@Injectable({providedIn: 'root'})
export class Member {
  readonly api = inject(HotelApi);
  readonly changes = this.api.changes;
  readonly profile = signal<Profile | null>(null);
  loadProfile() { return this.api.get<Profile>('account/profile/').pipe(tap(value => { this.profile.set(value); setLanguage(value.preferred_language); })); }
  saveProfile(data: object) { return this.api.patch<Profile>('account/profile/', data).pipe(tap(value => this.profile.set(value))); }
  photo(file: File) {
    const data = new FormData(); data.set('photo', file);
    return this.api.post<Profile>('account/profile/photo/', data).pipe(tap(value => this.profile.set(value)));
  }
  removePhoto() { return this.api.delete<Profile>('account/profile/photo/').pipe(tap(value => this.profile.set(value))); }
  favorites() { return this.api.get<Room[]>('account/favorites/'); }
  reviews() { return this.api.get<ReviewHistory>('account/reviews/'); }
  payments(status = '') { return this.api.get<PaymentHistory>('account/payments/', status ? {status} : {}); }
  notifications(page = 1) { return this.api.get<Notices>('account/notifications/', page > 1 ? {page} : {}); }
}
