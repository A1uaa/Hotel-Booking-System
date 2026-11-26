import { Component, computed, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { PaymentMethod, PaymentStatus } from '../../core/api';
import { money, statusLabel } from '../../shared/stay';
import { AdminApi, ManagedPayment } from './admin-api';
import { StaffSession } from './admin-session';
import { mutation, resource } from './admin-state';

@Component({
  imports: [ReactiveFormsModule],
  template: `
    <div class="staff-heading"><div><p class="eyebrow">Money</p><h1>Payments</h1><p>Track card, prepayment and pay-at-hotel payments. Confirm cash received, refund or void a payment.</p></div></div>
    <form class="staff-panel staff-filters" [formGroup]="filter" (ngSubmit)="search()">
      <label>Search<input formControlName="q" placeholder="Guest, room, reservation or payment ID" /></label>
      <label>Status<select formControlName="status"><option value="">All statuses</option>@for (status of statuses; track status) { <option [value]="status">{{ label(status) }}</option> }</select></label>
      <label>Method<select formControlName="method"><option value="">All methods</option>@for (method of methods; track method) { <option [value]="method">{{ label(method) }}</option> }</select></label>
      <label>Created on<input type="date" formControlName="date" /></label>
      <button class="button">Search</button><button class="plain-button" type="button" (click)="clear()">Reset</button>
    </form>
    @if (action.feedback()) { <p class="notice success" role="status">{{ action.feedback() }}</p> }
    @if (action.error()) { <p class="notice error" role="alert">{{ action.error() }}</p> }
    @if (list.loading()) { <p class="notice" role="status">Loading payments…</p> }
    @else if (list.error()) { <p class="notice error" role="alert">{{ list.error() }}</p><button class="button outline" (click)="load()">Retry</button> }
    @else if (list.data(); as rows) {
      <div class="staff-metrics">
        <article class="staff-metric"><p>Collected</p><strong>{{ money(totals().paid) }}</strong><small>Paid in the rows below</small></article>
        <article class="staff-metric"><p>Waiting to be collected</p><strong>{{ money(totals().pending) }}</strong><small>Pay-at-hotel requests</small></article>
        <article class="staff-metric"><p>Refunded</p><strong>{{ money(totals().refunded) }}</strong><small>Returned to guests</small></article>
      </div>
      <div class="staff-panel staff-table-wrap">
        <table class="staff-table"><caption>{{ rows.length }} payments</caption>
          <thead><tr><th>Payment</th><th>Reservation</th><th>Guest</th><th>Method</th><th>Amount</th><th>Status</th><th>Date</th>
            @if (canChange()) { <th><span class="visually-hidden">Actions</span></th> }</tr></thead>
          <tbody>@for (row of rows; track row.id) {
            <tr [id]="'payment-' + row.id"><th scope="row">#{{ row.id }}</th><td>#{{ row.booking }} · Room {{ row.room_number }}</td>
              <td>{{ row.guest.name || row.guest.email || 'Guest #' + row.guest.id }}</td>
              <td>{{ row.payment_method }}@if (row.note) { <br /><small>{{ row.note }}</small> }</td>
              <td>{{ money(row.amount) }}<br /><small>of {{ money(row.booking_total) }}</small></td>
              <td><span class="badge" [attr.data-status]="row.status">{{ label(row.status) }}</span></td>
              <td>{{ (row.paid_at || row.created_at).slice(0, 10) }}</td>
              @if (canChange()) {
                <td><div class="staff-actions">
                  @if (row.status === 'pending') {
                    <button class="button button-small" (click)="change(row, 'paid')" [disabled]="action.saving()">Mark received</button>
                    <button class="button button-small outline" (click)="change(row, 'cancelled')" [disabled]="action.saving()">Void</button>
                  } @else if (row.status === 'paid') {
                    <button class="button button-small outline" (click)="change(row, 'refunded')" [disabled]="action.saving()">Refund</button>
                  }
                </div></td>
              }
            </tr>
          } @empty { <tr><td [attr.colspan]="canChange() ? 8 : 7">No payments to display.</td></tr> }</tbody>
        </table>
      </div>
    }
  `,
})
export class AdminPayments {
  private readonly api = inject(AdminApi);
  private readonly staff = inject(StaffSession);
  readonly canChange = () => this.staff.current()?.capabilities.changePayment;
  readonly list = resource<ManagedPayment[]>();
  readonly action = mutation();
  readonly filter = inject(FormBuilder).nonNullable.group({ q: '', status: '', method: '', date: '' });
  readonly statuses: PaymentStatus[] = ['pending', 'paid', 'failed', 'refunded', 'cancelled'];
  readonly methods: PaymentMethod[] = ['card', 'prepayment', 'cash'];
  readonly label = statusLabel;
  readonly money = money;
  private applied = this.filter.getRawValue();

  readonly totals = computed(() => {
    const sum = { paid: 0, pending: 0, refunded: 0 };
    for (const row of this.list.data() ?? []) {
      if (row.status === 'paid') sum.paid += Number(row.amount);
      else if (row.status === 'pending') sum.pending += Number(row.amount);
      else if (row.status === 'refunded') sum.refunded += Number(row.amount);
    }
    return sum;
  });

  constructor() { this.load(); }
  search() { this.applied = this.filter.getRawValue(); this.load(); }
  clear() { this.filter.reset(); this.search(); }
  load() { this.list.load(this.api.payments(this.applied)); }

  change(row: ManagedPayment, status: 'paid' | 'refunded' | 'cancelled') {
    const verb = { paid: 'mark as received', refunded: 'refund', cancelled: 'void' }[status];
    if (!window.confirm('Do you want to ' + verb + ' payment #' + row.id + ' (' + money(row.amount) + ')?')) return;
    const done = { paid: 'Payment marked as received.', refunded: 'Payment refunded.', cancelled: 'Payment voided.' }[status];
    this.action.run(this.api.changePayment(row.id, status), done, () => this.load());
  }
}
