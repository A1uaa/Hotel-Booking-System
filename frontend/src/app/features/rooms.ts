import { Component, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { BehaviorSubject, catchError, combineLatest, map, of, switchMap } from 'rxjs';
import { apiError, HotelApi, Room, RoomFilters, RoomType } from '../core/api';
import { RoomCard } from '../shared/room-card';
import { hotelToday, stayDates } from '../shared/stay';

export function readFilters(params: ParamMap): RoomFilters {
  const filters: RoomFilters = {};
  for (const key of ['check_in', 'check_out'] as const) {
    const value = params.get(key);
    if (value) filters[key] = value;
  }
  for (const key of ['guests', 'room_type', 'min_price', 'max_price'] as const) {
    const value = params.get(key);
    if (value != null && String(value).trim() && Number.isFinite(Number(value))) filters[key] = Number(value);
  }
  return filters;
}

@Component({ imports: [ReactiveFormsModule, RoomCard], templateUrl: './rooms.html' })
export class Rooms {
  private readonly api = inject(HotelApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly refresh = new BehaviorSubject(0);
  readonly rooms = signal<Room[]>([]);
  readonly types = signal<RoomType[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');
  readonly attempted = signal(false);
  readonly dates = signal<RoomFilters>({});
  readonly today = hotelToday;
  readonly form = new FormGroup({
    check_in: new FormControl('', { nonNullable: true }),
    check_out: new FormControl('', { nonNullable: true }),
    guests: new FormControl<number | null>(null, [Validators.min(1), Validators.max(32767), Validators.pattern(/^\d+$/)]),
    room_type: new FormControl<number | null>(null),
    min_price: new FormControl<number | null>(null, Validators.min(0)),
    max_price: new FormControl<number | null>(null, Validators.min(0)),
  }, control => {
    const datesError = stayDates(control);
    const { min_price, max_price } = control.value;
    return datesError ?? (min_price != null && max_price != null && min_price > max_price
      ? { priceOrder: true } : null);
  });

  constructor() {
    this.api.rooms().pipe(takeUntilDestroyed()).subscribe({
      next: rooms => this.types.set([...new Map(rooms.map(room => [room.room_type.id, room.room_type])).values()]),
      error: () => {},
    });
    combineLatest([this.route.queryParamMap, this.refresh]).pipe(
      switchMap(([params]) => {
        const filters = readFilters(params);
        this.form.reset(filters);
        this.dates.set({
          ...(filters.check_in ? { check_in: filters.check_in, check_out: filters.check_out } : {}),
          ...(filters.guests != null ? { guests: filters.guests } : {}),
        });
        this.loading.set(true);
        this.error.set('');
        return this.api.rooms(filters).pipe(
          map(rooms => ({ rooms, error: '' })),
          catchError(error => of({ rooms: [] as Room[], error: apiError(error) })),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe(({ rooms, error }) => {
      this.rooms.set(rooms);
      this.error.set(error);
      this.loading.set(false);
    });
  }

  search() {
    this.attempted.set(true);
    if (this.form.invalid) return;
    const params = Object.fromEntries(Object.entries(this.form.getRawValue())
      .filter(([, value]) => value !== null && value !== ''));
    void this.router.navigate(['/rooms'], { queryParams: params });
  }

  retry() { this.refresh.next(this.refresh.value + 1); }

  clear() {
    this.attempted.set(false);
    this.form.reset();
    void this.router.navigate(['/rooms']);
  }
}
