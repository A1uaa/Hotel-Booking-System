import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Auth } from './auth';
import { API_BASE } from './api';

describe('Guest session', () => {
  let auth: Auth;
  let http: HttpTestingController;
  const user = { id: 7, email: 'guest@example.com', role: 'Guest' as const };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE, useValue: '/api/' }],
    });
    auth = TestBed.inject(Auth);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('restores a cookie session once and shares the result', () => {
    auth.restore().subscribe();
    auth.restore().subscribe();
    const request = http.expectOne('/api/auth/me/');
    expect(request.request.withCredentials).toBe(true);
    request.flush(user);
    expect(auth.user()).toEqual(user);
    expect(auth.ready()).toBe(true);
    auth.restore().subscribe(result => expect(result).toEqual(user));
  });

  it('treats the backend missing-session response as signed out', () => {
    auth.restore().subscribe();
    http.expectOne('/api/auth/me/').flush({}, { status: 403, statusText: 'Forbidden' });
    expect(auth.ready()).toBe(true);
    expect(auth.user()).toBeNull();
  });

  it('uses CSRF on login and a fresh token on logout', () => {
    auth.login({ email: user.email, password: 'example-only' }).subscribe();
    http.expectOne('/api/auth/csrf/').flush({ csrf_token: 'before-login' });
    const login = http.expectOne('/api/auth/login/');
    expect(login.request.headers.get('X-CSRFToken')).toBe('before-login');
    expect(login.request.withCredentials).toBe(true);
    login.flush(user);
    expect(auth.user()).toEqual(user);

    auth.logout().subscribe();
    http.expectOne('/api/auth/csrf/').flush({ csrf_token: 'after-login' });
    const logout = http.expectOne('/api/auth/logout/');
    expect(logout.request.headers.get('X-CSRFToken')).toBe('after-login');
    logout.flush(null, { status: 204, statusText: 'No Content' });
    expect(auth.user()).toBeNull();
  });
});
