import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of, throwError } from 'rxjs';
import { routes } from '../../app.routes';
import { API_BASE } from '../../core/api';
import { AdminApi, AdminSession, Capabilities, Dashboard } from './admin-api';
import { StaffSession } from './admin-session';

const capabilities: Capabilities = {
  dashboard: true, rooms: true, addRoom: true, changeRoom: true, deleteRoom: true,
  addPhoto: true, changePhoto: true, deletePhoto: true, reservations: true, changeBooking: true,
  guests: true, reports: true,
};
const session: AdminSession = {
  account: { id: 1, email: 'manager@example.test', role: 'Admin' }, capabilities,
};

describe('Admin routing', () => {
  it('redirects a denied guest to a separate sign-in without the guest navigation', async () => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: StaffSession, useValue: {
          verify: () => throwError(() => new HttpErrorResponse({ status: 403 })),
        } },
      ],
    });
    const harness = await RouterTestingHarness.create('/admin/rooms');
    expect(harness.routeNativeElement?.textContent).toContain('Staff sign-in');
    expect(harness.routeNativeElement?.querySelector('.site-header')).toBeNull();
  });

  it('shows dashboard values returned by Django for an authorized session', async () => {
    const dashboard: Dashboard = {
      date: '2026-11-10', total_rooms: 9, available_rooms: 8, occupied_rooms: 1,
      arrivals: 1, departures: 0, active_reservations: 2, revenue: '42000.00',
    };
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: StaffSession, useValue: { verify: () => of(session), current: () => session } },
        { provide: AdminApi, useValue: { dashboard: () => of(dashboard) } },
      ],
    });
    const harness = await RouterTestingHarness.create('/admin');
    expect(harness.routeNativeElement?.textContent).toContain('Hotel dashboard');
    expect(harness.routeNativeElement?.textContent).toContain('42,000 ₸');
    expect(harness.routeNativeElement?.querySelector('a[href="/admin/front-desk"]')).toBeTruthy();
  });
});

describe('Admin API client', () => {
  let api: AdminApi;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE, useValue: '/api/' },
      ],
    });
    api = TestBed.inject(AdminApi);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('uses separate staff login with credentialed CSRF requests', () => {
    api.login({ email: session.account.email, password: 'preview-only' }).subscribe();
    const csrf = http.expectOne('/api/auth/csrf/');
    expect(csrf.request.withCredentials).toBe(true);
    csrf.flush({ csrf_token: 'staff-token' });
    const login = http.expectOne('/api/admin/login/');
    expect(login.request.headers.get('X-CSRFToken')).toBe('staff-token');
    expect(login.request.withCredentials).toBe(true);
    login.flush(session);
  });

  it('uses CSRF on room edits and deletes', () => {
    api.saveRoom({
      room_number: '201', room_type: 1, description: 'Deluxe', price_per_night: '42000',
      capacity: 2, status: 'maintenance',
    }, 2).subscribe();
    http.expectOne('/api/auth/csrf/').flush({ csrf_token: 'edit-token' });
    const edit = http.expectOne('/api/admin/rooms/2/');
    expect(edit.request.method).toBe('PATCH');
    expect(edit.request.body.status).toBe('maintenance');
    expect(edit.request.headers.get('X-CSRFToken')).toBe('edit-token');
    edit.flush({ id: 2 });

    api.deleteRoom(2).subscribe();
    http.expectOne('/api/auth/csrf/').flush({ csrf_token: 'delete-token' });
    const remove = http.expectOne('/api/admin/rooms/2/');
    expect(remove.request.method).toBe('DELETE');
    expect(remove.request.headers.get('X-CSRFToken')).toBe('delete-token');
    remove.flush(null, { status: 204, statusText: 'No Content' });
  });

  it('posts check-in to the front desk action endpoint', () => {
    api.deskAction(15, 'check-in').subscribe();
    http.expectOne('/api/auth/csrf/').flush({ csrf_token: 'desk-token' });
    const action = http.expectOne('/api/admin/front-desk/15/check-in/');
    expect(action.request.method).toBe('POST');
    expect(action.request.headers.get('X-CSRFToken')).toBe('desk-token');
    action.flush({ id: 15, status: 'checked_in' });
  });
});
