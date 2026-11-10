import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router, RouterLink } from '@angular/router';
import { apiError, HotelApi, Room, RoomFilters } from '../core/api';
import { RoomCard } from '../shared/room-card';
import { StaySearch } from '../shared/search';

@Component({
  imports: [RouterLink, StaySearch, RoomCard],
  templateUrl: './home.html',
})
export class Home {
  private readonly router = inject(Router);
  readonly rooms = signal<Room[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  constructor() {
    inject(HotelApi).rooms().pipe(takeUntilDestroyed()).subscribe({
      next: rooms => {
        const types = new Map<string, Room>();
        for (const room of [...rooms].sort((a, b) => Number(a.price_per_night) - Number(b.price_per_night))) {
          if (!types.has(room.room_type.name)) types.set(room.room_type.name, room);
        }
        this.rooms.set([...types.values()].slice(0, 3));
        this.loading.set(false);
      },
      error: error => { this.error.set(apiError(error)); this.loading.set(false); },
    });
  }

  search(filters: RoomFilters) { void this.router.navigate(['/rooms'], { queryParams: filters }); }
}
