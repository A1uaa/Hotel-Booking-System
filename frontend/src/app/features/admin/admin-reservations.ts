import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { Booking, PaymentMethod } from '../../core/api';
import { hotelToday, money, statusLabel } from '../../shared/stay';
import { AdminApi, ManagedPayment, Reservation } from './admin-api';
import { StaffSession } from './admin-session';
import { mutation, resource } from './admin-state';
import { ReservationTable } from './reservation-table';

@Component({ imports: [ReactiveFormsModule, ReservationTable], templateUrl: './admin-reservations.html' })
export class AdminReservations {
  private readonly api = inject(AdminApi);
  private readonly staff = inject(StaffSession);
  readonly canChange = () => this.staff.current()?.capabilities.changeBooking;
  readonly canSeePayments = () => this.staff.current()?.capabilities.payments;
  readonly canRecord = () => this.staff.current()?.capabilities.recordPayment;
  readonly canChangePayment = () => this.staff.current()?.capabilities.changePayment;
  readonly payments = resource<ManagedPayment[]>();
  readonly paymentAction = mutation();
  readonly paymentMethods: PaymentMethod[] = ['cash', 'card', 'prepayment'];
  readonly paymentForm = inject(FormBuilder).nonNullable.group({ method: 'cash' as PaymentMethod, amount: '', note: '' });
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
    this.payments.clear();
    this.action.feedback.set('');
    this.action.error.set('');
    this.paymentAction.feedback.set('');
    this.paymentAction.error.set('');
    this.paymentForm.reset({ method: 'cash', amount: '', note: '' });
    this.detail.load(this.api.reservation(row.id));
    if (this.canSeePayments()) this.payments.load(this.api.reservationPayments(row.id));
  }
  closeDetail() { this.detail.clear(); this.payments.clear(); }
  refreshDetail(id: number) {
    this.detail.load(this.api.reservation(id));
    this.payments.load(this.api.reservationPayments(id));
    this.load();
  }
  record(row: Reservation) {
    const { method, amount, note } = this.paymentForm.getRawValue();
    if (!(Number(amount) > 0)) { this.paymentAction.error.set('Enter the amount received.'); return; }
    this.paymentAction.run(this.api.recordPayment(row.id, { method, amount: String(amount), note: note.trim() }), 'Payment recorded.', () => {
      this.paymentForm.reset({ method: 'cash', amount: '', note: '' });
      this.refreshDetail(row.id);
    });
  }
  settle(row: Reservation, payment: ManagedPayment, status: 'paid' | 'cancelled' | 'refunded') {
    const verb = { paid: 'mark as received', cancelled: 'void', refunded: 'refund' }[status];
    if (!window.confirm('Do you want to ' + verb + ' payment #' + payment.id + ' (' + money(payment.amount) + ')?')) return;
    this.paymentAction.run(this.api.changePayment(payment.id, status), 'Payment updated.', () => this.refreshDetail(row.id));
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
      if (this.canSeePayments()) this.payments.load(this.api.reservationPayments(updated.id));
    });
  }
}
