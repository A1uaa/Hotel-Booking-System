import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Booking } from '../../core/api';
import { hotelToday, money, statusLabel } from '../../shared/stay';
import { AdminApi, Reservation } from './admin-api';
import { StaffSession } from './admin-session';
import { mutation, resource } from './admin-state';
import { ReservationTable } from './reservation-table';

@Component({ imports: [ReactiveFormsModule, ReservationTable], templateUrl: './admin-reservations.html' })
export class AdminReservations {
  private readonly api = inject(AdminApi);
  private readonly staff = inject(StaffSession);
  readonly canChange = () => this.staff.current()?.capabilities.changeBooking;
  readonly list = resource<Reservation[]>();
  readonly detail = resource<Reservation>();
  readonly action = mutation();
  readonly filter = inject(FormBuilder).nonNullable.group({ q: '', status: '', date: '' });
  readonly statuses: Booking['status'][] = ['pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'];
  readonly label = statusLabel;
  readonly money = money;
  private applied = this.filter.getRawValue();

  constructor() { this.load(); }
  search() { this.applied = this.filter.getRawValue(); this.load(); }
  clear() { this.filter.reset(); this.search(); }
  load() { this.list.load(this.api.reservations(this.applied)); }
  select(row: Reservation) {
    this.detail.clear();
    this.action.feedback.set('');
    this.action.error.set('');
    this.detail.load(this.api.reservation(row.id));
  }
  actions(row: Reservation): Booking['status'][] {
    if (row.status === 'pending') return ['confirmed', 'cancelled'];
    if (row.status === 'confirmed') return row.check_in === hotelToday() ? ['checked_in', 'cancelled'] : ['cancelled'];
    if (row.status === 'checked_in' && row.check_out <= hotelToday()) return ['checked_out'];
    return [];
  }
  change(row: Reservation, status: Booking['status']) {
    if (!window.confirm('Set reservation #' + row.id + ' to ' + this.label(status) + '?')) return;
    this.action.run(this.api.status(row.id, status), 'Reservation updated.', updated => {
      this.detail.data.set(updated);
      this.load();
    });
  }
}
