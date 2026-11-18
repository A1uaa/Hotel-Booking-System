import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { inject, Injectable, InjectionToken } from '@angular/core';
import { switchMap } from 'rxjs';
import { translate } from './i18n';

export interface Account { id: number; email: string; role: 'Guest' | 'Admin'; }
export interface Credentials { email: string; password: string; }
export interface RoomType { id: number; name: string; }
export interface RoomImage { id: number; image: string; is_primary: boolean; }
export interface Room {
  id: number; room_number: string; room_type: RoomType; description: string;
  price_per_night: string; capacity: number; amenities: string[]; images: RoomImage[];
  available: boolean;
  // Average (one decimal) and number of visible reviews; the API always sends them.
  rating_average?: number | null; rating_count?: number;
}
export interface Stay { check_in: string; check_out: string; }
export interface Review { id: number; rating: number; comment: string; author: string; created_at: string; }
// `breakdown` maps each star rating "1".."5" to how many reviews gave it.
export interface RoomReviews {
  room: number; count: number; average: number | null; breakdown: Record<string, number>; reviews: Review[];
}
export interface ReviewInput { rating: number; comment: string; name: string; }
export interface RoomAvailability { room: number; bookable: boolean; booked: Stay[]; }
export interface RoomFilters extends Partial<Stay> {
  guests?: number; room_type?: number; min_price?: number; max_price?: number;
}
export interface BookingInput extends Stay { room: number; guest_count: number; }
export type PaymentState = 'unpaid' | 'partial' | 'pay_at_hotel' | 'paid' | 'refunded';
export interface Booking extends BookingInput {
  id: number; price_per_night: string; total_price: string; created_at: string; updated_at: string;
  status: 'pending' | 'confirmed' | 'checked_in' | 'checked_out' | 'cancelled';
  // Money position, always sent by the API.
  paid_amount?: string; balance_due?: string; prepayment_amount?: string;
  payment_status?: PaymentState;
}
export type PaymentMethod = 'card' | 'prepayment' | 'cash';
export type PaymentStatus = 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled';
// Card fields are required for card and prepayment, and ignored for cash (pay at the hotel).
export interface PaymentInput {
  method: PaymentMethod; card_holder?: string; card_number?: string; expiry?: string; cvv?: string;
}
export interface Payment {
  id: number; booking: number; amount: string; method: PaymentMethod; payment_method: string;
  created_at: string; paid_at: string | null; status: PaymentStatus;
}
export interface ContactInput { name: string; email: string; subject: string; message: string; }

export const API_BASE = new InjectionToken<string>('Hotel API URL', {
  providedIn: 'root', factory: () => 'http://localhost:8000/api/',
});

@Injectable({ providedIn: 'root' })
export class HotelApi {
  private readonly http = inject(HttpClient);
  private readonly base = inject(API_BASE);

  me() { return this.get<Account>('auth/me/'); }
  login(data: Credentials) { return this.post<Account>('auth/login/', data); }
  register(data: Credentials) { return this.post<Account>('auth/register/', data); }
  logout() { return this.post<void>('auth/logout/', {}); }
  rooms(filters: RoomFilters = {}) { return this.get<Room[]>('rooms/', { ...filters }); }
  room(id: number, dates: Partial<Stay> = {}) { return this.get<Room>('rooms/' + id + '/', { ...dates }); }
  availability(id: number) { return this.get<RoomAvailability>('rooms/' + id + '/availability/'); }
  roomReviews(id: number) { return this.get<RoomReviews>('rooms/' + id + '/reviews/'); }
  // Anyone can leave feedback on a room; the reply is the refreshed review list plus the new review.
  addReview(id: number, data: ReviewInput) {
    return this.post<RoomReviews & { review: Review }>('rooms/' + id + '/reviews/', data);
  }
  bookings() { return this.get<Booking[]>('bookings/'); }
  booking(id: number) { return this.get<Booking>('bookings/' + id + '/'); }
  book(data: BookingInput) { return this.post<Booking>('bookings/', data); }
  cancel(id: number) { return this.post<Booking>('bookings/' + id + '/cancel/', {}); }
  payments(id: number) { return this.get<Payment[]>('bookings/' + id + '/payments/'); }
  pay(id: number, data: PaymentInput) {
    return this.post<{ payment: Payment; booking: Booking }>('bookings/' + id + '/pay/', data);
  }
  contact(data: ContactInput) { return this.post<{ id: number }>('contact/', data); }

  get<T>(path: string, params: Record<string, string | number> = {}) {
    return this.http.get<T>(this.base + path, { params, withCredentials: true });
  }

  post<T>(path: string, body: object) { return this.write<T>('POST', path, body); }
  patch<T>(path: string, body: object) { return this.write<T>('PATCH', path, body); }
  delete<T>(path: string) { return this.write<T>('DELETE', path); }

  private write<T>(method: string, path: string, body?: object) {
    // A fresh token also handles rotation at login or in another browser tab.
    return this.get<{ csrf_token: string }>('auth/csrf/').pipe(
      switchMap(({ csrf_token }) => this.http.request<T>(method, this.base + path, { body,
        withCredentials: true, headers: { 'X-CSRFToken': csrf_token },
      })),
    );
  }
}

export function apiError(error: unknown): string {
  if (!(error instanceof HttpErrorResponse)) return translate('err.generic');
  if (error.status === 0) return translate('err.network');
  const body: unknown = error.error;
  if (body && typeof body === 'object') {
    const messages = Object.entries(body).flatMap(([key, value]) => {
      const label = key.replaceAll('_', ' ');
      const items = Array.isArray(value) ? value : [value];
      return items.filter((item): item is string => typeof item === 'string')
        .map(item => key === 'detail' || key === 'non_field_errors' ? item : label + ' — ' + item);
    });
    if (messages.length) return messages.join(' ');
  }
  return translate('err.failed');
}
