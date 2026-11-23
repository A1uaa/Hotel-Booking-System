import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { API_BASE, Booking, Room, RoomAvailability, RoomReviews } from '../core/api';
import { Auth } from '../core/auth';
import { FeedbackForm } from '../shared/feedback-form';
import { hotelToday } from '../shared/stay';
import { Bookings } from './bookings';
import { RoomDetail } from './room-detail';
import { Rooms } from './rooms';

const room: Room = {
  id: 3, room_number: '103', room_type: { id: 1, name: 'Standard Room' },
  description: 'Twin room', price_per_night: '29000.00', capacity: 2,
  amenities: ['Wi-Fi'], images: [], available: true,
};
const withExtras: Room = {
  ...room,
  extras: [
    { code: 'parking', name: 'Parking', description: 'A reserved space.', unit: 'per_night', price: '0.00', included: true },
    { code: 'breakfast', name: 'Breakfast', description: 'Buffet breakfast.', unit: 'per_guest_night', price: '4500.00', included: false },
    { code: 'airport-transfer', name: 'Airport transfer', description: 'A car from the airport.', unit: 'per_stay', price: '12000.00', included: false },
  ],
};
const availability: RoomAvailability = { room: 3, bookable: true, booked: [] };
const emptyBreakdown = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
const noReviews: RoomReviews = { room: 3, count: 0, average: null, breakdown: emptyBreakdown, reviews: [] };
const start = hotelToday();
const end = new Date(Date.parse(start) + 2 * 86_400_000).toISOString().slice(0, 10);
const booking: Booking = {
  id: 42, room: room.id, check_in: start, check_out: end, guest_count: 2,
  price_per_night: '29000.00', total_price: '58000.00', status: 'pending', created_at: '', updated_at: '',
};

describe('Customer pages and the hotel API', () => {
  let http: HttpTestingController;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(() => {
    params = new BehaviorSubject(convertToParamMap({}));
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: API_BASE, useValue: '/api/' },
        { provide: ActivatedRoute, useValue: {
          queryParamMap: params, paramMap: new BehaviorSubject(convertToParamMap({ id: room.id })),
          snapshot: { queryParamMap: convertToParamMap({}) },
        } },
        { provide: Auth, useValue: { user: () => ({ id: 1 }), expire: () => {} } },
      ],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('renders the rooms returned by Django and sends search filters on query changes', () => {
    const fixture = TestBed.createComponent(Rooms);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Checking available rooms');
    const initialRequests = http.match('/api/rooms/');
    expect(initialRequests).toHaveLength(2);
    initialRequests.forEach(request => request.flush([room]));
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Twin room');
    expect(fixture.nativeElement.textContent).toContain('No reviews yet');

    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const filters = { check_in: start, check_out: end, guests: 2, room_type: 1, min_price: 20000, max_price: 30000 };
    fixture.componentInstance.form.setValue(filters);
    fixture.componentInstance.search();
    expect(navigate).toHaveBeenCalledWith(['/rooms'], { queryParams: filters });
    params.next(convertToParamMap(filters));
    const search = http.expectOne(request => request.url === '/api/rooms/');
    for (const [key, value] of Object.entries(filters)) {
      expect(search.request.params.get(key)).toBe(String(value));
    }
    search.flush([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No rooms match');
  });

  function review() {
    const fixture = TestBed.createComponent(RoomDetail);
    fixture.detectChanges();
    http.expectOne('/api/rooms/3/').flush(room);
    http.expectOne('/api/rooms/3/availability/').flush(availability);
    http.expectOne('/api/rooms/3/reviews/').flush(noReviews);
    const page = fixture.componentInstance;
    page.form.setValue({ check_in: start, check_out: end, guest_count: 2 });
    page.reviewStay(room);
    http.expectOne(request => request.url === '/api/rooms/3/' && request.params.get('check_in') === start).flush(room);
    return fixture;
  }

  it('submits only room, dates and guest count, then opens the payment page', () => {
    const fixture = review();
    const page = fixture.componentInstance;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    page.confirm(page.review()!);
    http.expectOne('/api/auth/csrf/').flush({ csrf_token: 'booking-token' });
    const submit = http.expectOne('/api/bookings/');
    expect(submit.request.method).toBe('POST');
    expect(submit.request.body).toEqual({ room: 3, check_in: start, check_out: end, guest_count: 2 });
    expect(submit.request.headers.get('X-CSRFToken')).toBe('booking-token');
    expect(navigate).not.toHaveBeenCalled();
    submit.flush(booking, { status: 201, statusText: 'Created' });
    expect(navigate).toHaveBeenCalledWith(['/bookings', booking.id, 'payment']);
  });

  function openWithExtras() {
    const fixture = TestBed.createComponent(RoomDetail);
    fixture.detectChanges();
    http.expectOne('/api/rooms/3/').flush(withExtras);
    http.expectOne('/api/rooms/3/availability/').flush(availability);
    http.expectOne('/api/rooms/3/reviews/').flush(noReviews);
    fixture.componentInstance.form.setValue({ check_in: start, check_out: end, guest_count: 2 });
    fixture.detectChanges();
    return fixture;
  }

  it('shows the extras of the room as checkboxes, with the free bonus already ticked', () => {
    const fixture = openWithExtras();
    const boxes = Array.from(fixture.nativeElement.querySelectorAll('.extra input')) as HTMLInputElement[];
    expect(boxes).toHaveLength(3);
    expect(boxes.map(box => box.checked)).toEqual([true, false, false]);
    expect(boxes.map(box => box.disabled)).toEqual([true, false, false]);
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Included');
    expect(text).toContain('Breakfast');
    expect(text).toContain('4,500');
    expect(text).toContain('per guest, per night');
  });

  it('adds the ticked extras to the estimated total', () => {
    const fixture = openWithExtras();
    const page = fixture.componentInstance;
    expect(page.estimate(withExtras)).toBe(58000); // 2 nights, no paid extras
    page.toggleExtra('breakfast'); // 4,500 x 2 nights x 2 guests = 18,000
    page.toggleExtra('airport-transfer'); // 12,000 once
    expect(page.estimate(withExtras)).toBe(58000 + 18000 + 12000);
    expect(page.extrasEstimate(withExtras)).toBe(30000);
    page.toggleExtra('breakfast');
    expect(page.estimate(withExtras)).toBe(58000 + 12000);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('70,000');
  });

  it('sends the codes of the ticked extras, and none when nothing is ticked', () => {
    const fixture = openWithExtras();
    const page = fixture.componentInstance;
    page.toggleExtra('breakfast');
    page.reviewStay(withExtras);
    http.expectOne(request => request.url === '/api/rooms/3/' && request.params.get('check_in') === start).flush(withExtras);
    expect(page.review()).toEqual({ room: 3, check_in: start, check_out: end, guest_count: 2, extras: ['breakfast'] });
    expect(page.reviewTotal(withExtras, page.review()!)).toBe(58000 + 18000);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Breakfast');
    expect(text).toContain('Parking'); // the free bonus is listed on the review too
    expect(text).toContain('76,000');
  });

  it('lists the extras of a booking with the free ones marked included', () => {
    const fixture = TestBed.createComponent(Bookings);
    fixture.detectChanges();
    http.expectOne('/api/bookings/').flush([{
      ...booking, total_price: '76000.00', extras: [
        { name: 'Parking', unit: 'per_night', unit_price: '0.00', included: true, amount: '0.00' },
        { name: 'Breakfast', unit: 'per_guest_night', unit_price: '4500.00', included: false, amount: '18000.00' },
      ],
    }]);
    http.expectOne('/api/rooms/3/').flush(withExtras);
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Parking');
    expect(text).toContain('Included');
    expect(text).toContain('18,000');
  });

  it('keeps the review open and displays a booking conflict', () => {
    const fixture = review();
    const page = fixture.componentInstance;
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    page.confirm(page.review()!);
    http.expectOne('/api/auth/csrf/').flush({ csrf_token: 'booking-token' });
    http.expectOne('/api/bookings/').flush(
      { detail: 'The room is already booked for those dates.' }, { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('The room is already booked for those dates.');
    expect(fixture.nativeElement.textContent).toContain('Review your reservation');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('shows the availability calendar and fills the dates when days are picked', () => {
    const fixture = TestBed.createComponent(RoomDetail);
    fixture.detectChanges();
    http.expectOne('/api/rooms/3/').flush(room);
    http.expectOne('/api/rooms/3/availability/').flush(availability);
    http.expectOne('/api/rooms/3/reviews/').flush(noReviews);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-availability-calendar')).not.toBeNull();
    fixture.componentInstance.pickDates({ check_in: start, check_out: end });
    expect(fixture.componentInstance.form.getRawValue()).toMatchObject({ check_in: start, check_out: end });
  });

  it('still works when the calendar cannot be loaded', () => {
    const fixture = TestBed.createComponent(RoomDetail);
    fixture.detectChanges();
    http.expectOne('/api/rooms/3/').flush(room);
    http.expectOne('/api/rooms/3/availability/').flush({}, { status: 500, statusText: 'Server Error' });
    http.expectOne('/api/rooms/3/reviews/').flush(noReviews);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('app-availability-calendar')).toBeNull();
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });

  it('shows the rating of each room on the rooms page', () => {
    const fixture = TestBed.createComponent(Rooms);
    fixture.detectChanges();
    http.match('/api/rooms/').forEach(request => request.flush([{ ...room, rating_average: 4.6, rating_count: 12 }]));
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('4.6');
    expect(text).toContain('(12 reviews)');
    expect(text).not.toContain('No reviews yet');
  });

  it('shows the rating section and the feedback section inside the room page', () => {
    const fixture = TestBed.createComponent(RoomDetail);
    fixture.detectChanges();
    http.expectOne('/api/rooms/3/').flush(room);
    http.expectOne('/api/rooms/3/availability/').flush(availability);
    http.expectOne('/api/rooms/3/reviews/').flush({
      room: 3, count: 2, average: 4.5, breakdown: { ...emptyBreakdown, '4': 1, '5': 1 }, reviews: [
        { id: 2, rating: 5, comment: 'Quiet and spotless.', author: 'Guest', created_at: '2026-10-02T10:00:00+05:00' },
        { id: 1, rating: 4, comment: '', author: 'Aida', created_at: '2026-09-01T10:00:00+05:00' },
      ],
    });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Ratings & feedback');
    expect(text).toContain('4.5');
    expect(text).toContain('2 reviews');
    expect(text).toContain('50%'); // half of the guests gave 5 stars
    expect(text).toContain('How was your experience?');
    expect(text).toContain('Quiet and spotless.');
    expect(text).toContain('Aida');
    expect(fixture.nativeElement.querySelector('app-rating-summary')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('app-feedback-form')).not.toBeNull();
  });

  it('says so when a room has no reviews yet, keeps the feedback form, and hides the section if reviews cannot load', () => {
    const fixture = TestBed.createComponent(RoomDetail);
    fixture.detectChanges();
    http.expectOne('/api/rooms/3/').flush(room);
    http.expectOne('/api/rooms/3/availability/').flush(availability);
    http.expectOne('/api/rooms/3/reviews/').flush(noReviews);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('No reviews yet');
    expect(fixture.nativeElement.querySelector('app-feedback-form')).not.toBeNull();

    const broken = TestBed.createComponent(RoomDetail);
    broken.detectChanges();
    http.expectOne('/api/rooms/3/').flush(room);
    http.expectOne('/api/rooms/3/availability/').flush(availability);
    http.expectOne('/api/rooms/3/reviews/').flush({}, { status: 500, statusText: 'Server Error' });
    broken.detectChanges();
    expect(broken.nativeElement.textContent).not.toContain('Ratings & feedback');
    expect(broken.nativeElement.querySelector('form')).not.toBeNull();
  });

  it('lets anyone leave feedback on the room page and shows it at once', () => {
    const fixture = TestBed.createComponent(RoomDetail);
    fixture.detectChanges();
    http.expectOne('/api/rooms/3/').flush(room);
    http.expectOne('/api/rooms/3/availability/').flush(availability);
    http.expectOne('/api/rooms/3/reviews/').flush(noReviews);
    fixture.detectChanges();
    const form = fixture.debugElement.query(By.directive(FeedbackForm)).componentInstance as FeedbackForm;
    form.rating.set(5);
    form.name.set(' Aida ');
    form.comment.set('  Great room  ');
    form.send();
    http.expectOne('/api/auth/csrf/').flush({ csrf_token: 'feedback-token' });
    const submit = http.expectOne('/api/rooms/3/reviews/');
    expect(submit.request.method).toBe('POST');
    expect(submit.request.body).toEqual({ rating: 5, comment: 'Great room', name: 'Aida' });
    expect(submit.request.headers.get('X-CSRFToken')).toBe('feedback-token');
    const created = { id: 1, rating: 5, comment: 'Great room', author: 'Aida', created_at: '2026-11-18T10:00:00+05:00' };
    submit.flush({
      room: 3, count: 1, average: 5, breakdown: { ...emptyBreakdown, '5': 1 }, reviews: [created], review: created,
    }, { status: 201, statusText: 'Created' });
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Thank you');
    expect(text).toContain('Great room');
    expect(text).toContain('1 review');
    expect(text).not.toContain('No reviews yet');
  });

  it('shows cancellation only after the server responds and reloads the list', () => {
    const fixture = TestBed.createComponent(Bookings);
    fixture.detectChanges();
    http.expectOne('/api/bookings/').flush([booking]);
    http.expectOne('/api/rooms/3/').flush(room);
    const page = fixture.componentInstance;
    page.cancel(booking.id);
    http.expectOne('/api/auth/csrf/').flush({ csrf_token: 'cancel-token' });
    const cancel = http.expectOne('/api/bookings/42/cancel/');
    expect(cancel.request.method).toBe('POST');
    expect(page.rows()[0].status).toBe('pending');
    const cancelled = { ...booking, status: 'cancelled' };
    cancel.flush(cancelled);
    http.expectOne('/api/bookings/').flush([cancelled]);
    http.expectOne('/api/rooms/3/').flush(room);
    fixture.detectChanges();
    expect(page.rows()[0].status).toBe('cancelled');
    expect(fixture.nativeElement.textContent).toContain('Reservation #42 was cancelled.');
  });
});
