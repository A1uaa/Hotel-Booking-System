import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { API_BASE, RoomReviews } from '../core/api';
import { FeedbackForm } from './feedback-form';

describe('FeedbackForm', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: API_BASE, useValue: '/api/' }],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  function create() {
    const fixture = TestBed.createComponent(FeedbackForm);
    fixture.componentRef.setInput('roomId', 3);
    fixture.detectChanges();
    return fixture;
  }

  it('asks for a star rating before sending anything', () => {
    const fixture = create();
    fixture.componentInstance.send();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Choose a star rating');
  });

  it('shows the chosen rating with a word, like 4/5 · Very good', () => {
    const fixture = create();
    (fixture.nativeElement.querySelectorAll('.star-input button')[3] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.rating()).toBe(4);
    expect(fixture.nativeElement.textContent).toContain('4/5 · Very good');
  });

  it('sends the feedback, emits the refreshed list and clears the form', () => {
    const fixture = create();
    const saved: RoomReviews[] = [];
    fixture.componentInstance.saved.subscribe(value => saved.push(value));
    fixture.componentInstance.rating.set(4);
    fixture.componentInstance.comment.set('Nice');
    fixture.componentInstance.send();
    http.expectOne('/api/auth/csrf/').flush({ csrf_token: 't' });
    const request = http.expectOne('/api/rooms/3/reviews/');
    expect(request.request.body).toEqual({ rating: 4, comment: 'Nice', name: '' });
    const body = { room: 3, count: 1, average: 4, breakdown: { '1': 0, '2': 0, '3': 0, '4': 1, '5': 0 }, reviews: [] };
    request.flush(body, { status: 201, statusText: 'Created' });
    expect(saved).toHaveLength(1);
    expect(fixture.componentInstance.rating()).toBe(0);
    expect(fixture.componentInstance.comment()).toBe('');
    expect(fixture.componentInstance.done()).toBe(true);
  });

  it('shows the server message, for example when the room was already reviewed', () => {
    const fixture = create();
    fixture.componentInstance.rating.set(2);
    fixture.componentInstance.send();
    http.expectOne('/api/auth/csrf/').flush({ csrf_token: 't' });
    http.expectOne('/api/rooms/3/reviews/').flush(
      { detail: 'You have already left feedback for this room.' }, { status: 409, statusText: 'Conflict' },
    );
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('already left feedback');
    expect(fixture.componentInstance.busy()).toBe(false);
  });
});
