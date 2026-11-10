import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject } from 'rxjs';
import { API_BASE, Booking, Room } from '../core/api';
import { Auth } from '../core/auth';
import { hotelToday } from '../shared/stay';
import { Bookings } from './bookings';
import { RoomDetail } from './room-detail';
import { Rooms } from './rooms';

const room: Room = {
  id: 3, room_number: '103', room_type: { id: 1, name: 'Standard Room' },
  description: 'Twin room', price_per_night: '29000.00', capacity: 2,
  amenities: ['Wi-Fi'], images: [], available: true,
};
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
    const page = fixture.componentInstance;
    page.form.setValue({ check_in: start, check_out: end, guest_count: 2 });
    page.reviewStay(room);
    http.expectOne(request => request.url === '/api/rooms/3/' && request.params.get('check_in') === start).flush(room);
    return fixture;
  }

  it('submits only room, dates and guest count, then opens the confirmed server record', () => {
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
    expect(navigate).toHaveBeenCalledWith(['/bookings', booking.id, 'confirmation']);
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
