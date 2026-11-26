import { FavoriteButton } from '../shared/favorite';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, map, of, switchMap } from 'rxjs';
import { apiError, BookingInput, HotelApi, Room, RoomAvailability, RoomReviews } from '../core/api';
import { Auth } from '../core/auth';
import { ContentPipe, translate, TranslatePipe } from '../core/i18n';
import { AvailabilityCalendar, CalendarPick } from '../shared/availability-calendar';
import { imageFallback, roomPhotosFor } from '../shared/photos';
import { FeedbackForm } from '../shared/feedback-form';
import { RatingSummary } from '../shared/rating-summary';
import { Stars } from '../shared/stars';
import { hotelToday, money, nights, stayDates } from '../shared/stay';

@Component({ imports: [FavoriteButton, ReactiveFormsModule, RouterLink, AvailabilityCalendar, Stars, RatingSummary, FeedbackForm, TranslatePipe, ContentPipe], templateUrl: './room-detail.html' })
export class RoomDetail {
  private readonly api = inject(HotelApi);
  private readonly auth = inject(Auth);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly destroy = inject(DestroyRef);
  readonly room = signal<Room | null>(null);
  readonly availability = signal<RoomAvailability | null>(null);
  readonly reviews = signal<RoomReviews | null>(null);
  readonly loading = signal(true);
  readonly loadError = signal('');
  readonly error = signal('');
  readonly busy = signal(false);
  readonly review = signal<BookingInput | null>(null);
  readonly reviewPrice = signal('');
  readonly selectedPhoto = signal(0);
  readonly photos = roomPhotosFor;
  readonly fallback = imageFallback;
  readonly money = money;
  readonly nights = nights;
  readonly today = hotelToday;
  readonly form = new FormGroup({
    check_in: new FormControl('', { nonNullable: true, validators: Validators.required }),
    check_out: new FormControl('', { nonNullable: true, validators: Validators.required }),
    guest_count: new FormControl<number | null>(1, [Validators.required, Validators.min(1), Validators.pattern(/^\d+$/)]),
  }, stayDates);
  readonly stay = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });

  constructor() {
    this.route.paramMap.pipe(
      switchMap(params => {
        this.loading.set(true);
        this.room.set(null);
        this.availability.set(null);
        this.reviews.set(null);
        this.loadError.set('');
        this.error.set('');
        this.review.set(null);
        this.selectedPhoto.set(0);
        const query = this.route.snapshot.queryParamMap;
        const guests = Number(query.get('guests'));
        this.form.reset({
          check_in: query.get('check_in') ?? '', check_out: query.get('check_out') ?? '',
          guest_count: Number.isSafeInteger(guests) && guests > 0 ? guests : 1,
        });
        return this.api.room(Number(params.get('id'))).pipe(
          map(room => ({ room, error: '' })),
          catchError(error => of({ room: null, error: apiError(error) })),
        );
      }),
      takeUntilDestroyed(),
    ).subscribe(({ room, error }) => {
      this.room.set(room);
      this.loadError.set(error);
      this.loading.set(false);
    });
    // The calendar is optional: if it cannot load, the date fields still work.
    this.route.paramMap.pipe(
      switchMap(params => this.api.availability(Number(params.get('id'))).pipe(catchError(() => of(null)))),
      takeUntilDestroyed(),
    ).subscribe(availability => this.availability.set(availability));
    // Reviews are optional too: the room page still works without them.
    this.route.paramMap.pipe(
      switchMap(params => this.api.roomReviews(Number(params.get('id'))).pipe(catchError(() => of(null)))),
      takeUntilDestroyed(),
    ).subscribe(reviews => this.reviews.set(reviews));
  }

  pickDates(pick: CalendarPick) {
    this.error.set('');
    this.form.patchValue(pick);
  }

  estimate(room: Room) {
    const { check_in, check_out } = this.form.getRawValue();
    return this.nights(check_in, check_out) * Number(room.price_per_night);
  }

  reviewStay(room: Room) {
    this.error.set('');
    this.form.markAllAsTouched();
    const { check_in, check_out, guest_count } = this.form.getRawValue();
    if (this.form.invalid || guest_count! > room.capacity) {
      this.error.set(translate('rd.errInvalid'));
      return;
    }
    const input = { room: room.id, check_in, check_out, guest_count: guest_count! };
    this.busy.set(true);
    this.api.room(room.id, { check_in, check_out }).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: result => {
        this.busy.set(false);
        if (this.room()?.id !== room.id) return;
        if (!result.available) {
          this.error.set(translate('rd.errUnavailable'));
          return;
        }
        if (input.guest_count > result.capacity) {
          this.error.set(translate('rd.errGuests'));
          return;
        }
        this.reviewPrice.set(result.price_per_night);
        this.review.set(input);
      },
      error: error => { this.busy.set(false); this.error.set(apiError(error)); },
    });
  }

  confirm(input: BookingInput) {
    if (this.busy()) return;
    if (!this.auth.user()) { this.loginForStay(input); return; }
    this.busy.set(true);
    this.error.set('');
    this.api.book(input).pipe(takeUntilDestroyed(this.destroy)).subscribe({
      next: booking => void this.router.navigate(['/bookings', booking.id, 'payment']),
      error: error => {
        this.busy.set(false);
        if (error instanceof HttpErrorResponse && error.status === 403 && !String(error.error?.detail).includes('CSRF')) {
          this.auth.expire();
          this.loginForStay(input);
          return;
        }
        this.error.set(apiError(error) + (error instanceof HttpErrorResponse && error.status === 0
          ? translate('rd.errCheck') : ''));
      },
    });
  }

  private loginForStay(input: BookingInput) {
    const returnUrl = this.router.serializeUrl(this.router.createUrlTree(['/rooms', input.room], {
      queryParams: { check_in: input.check_in, check_out: input.check_out, guests: input.guest_count },
    }));
    void this.router.navigate(['/login'], { queryParams: { returnUrl } });
  }
}
