import { Injectable, inject } from '@angular/core';
import { Account, Booking, Credentials, HotelApi, RoomImage, RoomType } from '../../core/api';

export type RoomStatus = 'available' | 'maintenance' | 'out_of_service';
export interface RoomInput {
  room_number: string; room_type: number; description: string; price_per_night: string;
  capacity: number; status: RoomStatus;
}
export interface ManagedRoom extends RoomInput {
  id: number; room_type_name: string; images: RoomImage[]; has_history: boolean;
}
export interface Guest { id: number; name: string; email: string; date_joined: string; }
export interface Reservation extends Booking { guest: Guest; room_number: string; room_type: string; }
export type Capabilities = Record<
  'dashboard' | 'rooms' | 'addRoom' | 'changeRoom' | 'deleteRoom' | 'addPhoto' |
  'changePhoto' | 'deletePhoto' | 'reservations' | 'changeBooking' | 'guests' | 'reports', boolean
>;
export interface AdminSession { account: Account; capabilities: Capabilities; }
export interface Dashboard {
  date: string; total_rooms: number; available_rooms: number; occupied_rooms: number;
  arrivals: number; departures: number; active_reservations: number; revenue: string;
}
export interface FrontDesk { date: string; arrivals: Reservation[]; departures: Reservation[]; }
export interface HotelReport {
  start: string; end: string; bookings: number; by_status: Record<Booking['status'], number>;
  occupied_nights: number; capacity_nights: number; occupancy_percent: number; revenue: string;
  popular_room_types: { name: string; bookings: number }[];
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
  reports(start: string, end: string) { return this.api.get<HotelReport>('admin/reports/', { start, end }); }
}
