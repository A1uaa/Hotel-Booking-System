import { Injectable, inject } from '@angular/core';
import {
  Account, Booking, Credentials, HotelApi, PaymentMethod, PaymentState, PaymentStatus, RoomImage, RoomType,
} from '../../core/api';

export type RoomStatus = 'available' | 'maintenance' | 'out_of_service';
export interface RoomInput {
  room_number: string; room_type: number; description: string; price_per_night: string;
  capacity: number; status: RoomStatus;
}
export interface ManagedRoom extends RoomInput {
  id: number; room_type_name: string; images: RoomImage[]; has_history: boolean;
}
export interface Guest { id: number; name: string; email: string; date_joined: string; }
export interface Reservation extends Booking {
  guest: Guest; room_number: string; room_type: string; payment_status?: PaymentState;
}
export type Capabilities = Record<
  'dashboard' | 'rooms' | 'addRoom' | 'changeRoom' | 'deleteRoom' | 'addPhoto' |
  'changePhoto' | 'deletePhoto' | 'reservations' | 'changeBooking' | 'guests' | 'reports' |
  'payments' | 'recordPayment' | 'changePayment' | 'reviews' | 'moderateReviews', boolean
>;
export interface AdminSession { account: Account; capabilities: Capabilities; }
export interface Dashboard {
  date: string; total_rooms: number; available_rooms: number; occupied_rooms: number;
  arrivals: number; departures: number; active_reservations: number; revenue: string;
  pending_payments?: number; pending_amount?: string;
}
export interface ManagedPayment {
  id: number; booking: number; guest: Guest; room_number: string; booking_status: Booking['status'];
  booking_total: string; amount: string; method: PaymentMethod; payment_method: string;
  status: PaymentStatus; note: string; recorded_by_email: string; paid_at: string | null; created_at: string;
}
export interface ManagedReview {
  id: number; room: number; room_number: string; author_name: string; guest: Guest | null;
  rating: number; comment: string; is_hidden: boolean; created_at: string;
}
export interface ReviewFilters { q: string; visibility: string; rating: string; }
export interface PaymentFilters { q: string; status: string; method: string; date: string; }
export interface RecordPaymentInput { method: PaymentMethod; amount: string; note: string; }
export interface FrontDesk { date: string; arrivals: Reservation[]; departures: Reservation[]; }
export interface HotelReport {
  start: string; end: string; bookings: number; by_status: Record<Booking['status'], number>;
  occupied_nights: number; capacity_nights: number; occupancy_percent: number; revenue: string;
  popular_room_types: { name: string; bookings: number }[];
  revenue_by_method?: Record<PaymentMethod, string>; refunded?: string;
}

@Injectable({ providedIn: 'root' })
export class AdminApi {
  private readonly api = inject(HotelApi);
  login(data: Credentials) { return this.api.post<AdminSession>('admin/login/', data); }
  me() { return this.api.get<AdminSession>('admin/me/'); }
  dashboard() { return this.api.get<Dashboard>('admin/dashboard/'); }
  rooms() { return this.api.get<ManagedRoom[]>('admin/rooms/'); }
  roomTypes() { return this.api.get<RoomType[]>('admin/room-types/'); }
  saveRoom(data: RoomInput, id?: number) {
    return id == null ? this.api.post<ManagedRoom>('admin/rooms/', data)
      : this.api.patch<ManagedRoom>('admin/rooms/' + id + '/', data);
  }
  deleteRoom(id: number) { return this.api.delete<void>('admin/rooms/' + id + '/'); }
  upload(id: number, image: File) {
    const data = new FormData();
    data.set('image', image);
    return this.api.post<RoomImage>('admin/rooms/' + id + '/photos/', data);
  }
  primary(id: number, photo: number) {
    return this.api.patch<RoomImage>('admin/rooms/' + id + '/photos/' + photo + '/', { is_primary: true });
  }
  deletePhoto(id: number, photo: number) {
    return this.api.delete<void>('admin/rooms/' + id + '/photos/' + photo + '/');
  }
  reservations(filters: { q: string; status: string; date: string }) {
    return this.api.get<Reservation[]>('admin/reservations/', filters);
  }
  reservation(id: number) { return this.api.get<Reservation>('admin/reservations/' + id + '/'); }
  status(id: number, status: Booking['status']) {
    return this.api.post<Reservation>('admin/reservations/' + id + '/status/', { status });
  }
  guests(q: string) { return this.api.get<Guest[]>('admin/guests/', { q }); }
  guest(id: number) { return this.api.get<{guest: Guest; bookings: Reservation[]}>('admin/guests/' + id + '/'); }
  frontDesk() { return this.api.get<FrontDesk>('admin/front-desk/'); }
  deskAction(id: number, action: 'check-in' | 'check-out') {
    return this.api.post<Reservation>('admin/front-desk/' + id + '/' + action + '/', {});
  }
  payments(filters: PaymentFilters) { return this.api.get<ManagedPayment[]>('admin/payments/', { ...filters }); }
  changePayment(id: number, status: 'paid' | 'refunded' | 'cancelled', note = '') {
    return this.api.post<ManagedPayment>('admin/payments/' + id + '/status/', { status, note });
  }
  reservationPayments(id: number) { return this.api.get<ManagedPayment[]>('admin/reservations/' + id + '/payments/'); }
  recordPayment(id: number, data: RecordPaymentInput) {
    return this.api.post<ManagedPayment>('admin/reservations/' + id + '/payments/', data);
  }
  reviews(filters: ReviewFilters) { return this.api.get<ManagedReview[]>('admin/reviews/', { ...filters }); }
  setReviewHidden(id: number, hidden: boolean) {
    return this.api.post<ManagedReview>('admin/reviews/' + id + '/visibility/', { hidden });
  }
  reports(start: string, end: string) { return this.api.get<HotelReport>('admin/reports/', { start, end }); }
}
