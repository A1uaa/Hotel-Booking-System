import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, map, of, switchMap } from 'rxjs';
import { apiError, Booking, HotelApi, Room } from '../core/api';
import { imageFallback, roomPhotosFor } from '../shared/photos';
import { money, statusLabel } from '../shared/stay';

@Component({ imports: [RouterLink], templateUrl: './bookings.html' })
export class Bookings {
  private readonly api = inject(HotelApi);
  private readonly destroy = inject(DestroyRef);
  readonly rows = signal<Booking[]>([]);
  readonly rooms = signal<Record<number, Room>>({});
  readonly loading = signal(true);
  readonly cancelling = signal<number | null>(null);
  readonly selected = signal<number | null>(null);
  readonly error = signal('');
  readonly feedback = signal('');
  readonly money = money;
  readonly label = statusLabel;
  readonly photos = roomPhotosFor;
  readonly fallback = imageFallback;

  constructor() { this.load(); }

  load() {
    this.error.set('');
    this.loading.set(true);
    this.api.bookings().pipe(
      switchMap(bookings => {
        const roomIds = [...new Set(bookings.map(booking => booking.room))];
        return roomIds.length ? forkJoin(roomIds.map(id => this.api.room(id).pipe(
          catchError(() => of(null)),
        ))).pipe(map(rooms => ({ bookings, rooms }))) : of({ bookings, rooms: [] });
      }),
      takeUntilDestroyed(this.destroy),
    ).subscribe({
      next: ({ bookings, rooms }) => {
        this.rows.set(bookings);
        this.rooms.set(Object.fromEntries(rooms.flatMap(room => room ? [[room.id, room]] : [])));
        this.loading.set(false);
      },
      error: error => { this.error.set(apiError(error)); this.loading.set(false); },
    });
  }

  cancel(id: number) {
    if (this.cancelling() !== null) return;
    this.cancelling.set(id);
    this.error.set('');
    this.feedback.set('');
    this.api.cancel(id).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: booking => {
        this.rows.update(rows => rows.map(row => row.id === booking.id ? booking : row));
        this.cancelling.set(null);
        this.selected.set(null);
        this.feedback.set('Reservation #' + id + ' was cancelled.');
        this.load();
      },
      error: error => { this.cancelling.set(null); this.error.set(apiError(error)); },
    });
  }
}
