import { Component, input, output } from '@angular/core';
import { money, statusLabel } from '../../shared/stay';
import { Reservation } from './admin-api';

@Component({
  selector: 'app-reservation-table',
  template: `
    <div class="staff-panel staff-table-wrap">
      <table class="staff-table"><caption>{{ caption() }}</caption>
        <thead><tr><th>Reservation</th><th>Guest</th><th>Room</th><th>Check-in</th><th>Check-out</th><th>Total</th><th>Status</th>
          @if (mode() !== 'none') { <th><span class="visually-hidden">Actions</span></th> }
        </tr></thead>
        <tbody>@for (row of rows(); track row.id) {
          <tr><th scope="row">#{{ row.id }}</th><td>{{ row.guest.name || row.guest.email || 'Guest #' + row.guest.id }}</td><td>{{ row.room_number }}</td>
            <td>{{ row.check_in }}</td><td>{{ row.check_out }}</td><td>{{ money(row.total_price) }}</td>
            <td><span class="badge" [attr.data-status]="row.status">{{ label(row.status) }}</span></td>
            @if (mode() !== 'none') {
              <td>
                @if (mode() === 'detail') { <button class="plain-button" (click)="selected.emit(row)" [disabled]="busy()">View</button> }
                @else if (mode() === 'arrival' && row.status === 'confirmed') { <button class="button button-small outline" (click)="selected.emit(row)" [disabled]="busy()">Check in</button> }
                @else if (mode() === 'departure' && row.status === 'checked_in') { <button class="button button-small outline" (click)="selected.emit(row)" [disabled]="busy()">Check out</button> }
              </td>
            }
          </tr>
        } @empty { <tr><td [attr.colspan]="mode() === 'none' ? 7 : 8">No reservations to display.</td></tr> }</tbody>
      </table>
    </div>
  `,
})
export class ReservationTable {
  readonly rows = input.required<Reservation[]>();
  readonly caption = input('Reservations');
  readonly mode = input<'none' | 'detail' | 'arrival' | 'departure'>('none');
  readonly busy = input(false);
  readonly selected = output<Reservation>();
  readonly label = statusLabel;
  readonly money = money;
}
