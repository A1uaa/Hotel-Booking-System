import { TestBed } from '@angular/core/testing';
import { RatingSummary } from './rating-summary';

describe('RatingSummary', () => {
  function create(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(RatingSummary);
    for (const [key, value] of Object.entries(inputs)) fixture.componentRef.setInput(key, value);
    fixture.detectChanges();
    return fixture;
  }

  it('shows the average and the share of each star rating', () => {
    const fixture = create({ average: 4.6, count: 4, breakdown: { '1': 0, '2': 0, '3': 1, '4': 0, '5': 3 } });
    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('4.6');
    expect(text).toContain('4 reviews');
    expect(text).toContain('75%');
    expect(text).toContain('25%');
    expect(fixture.nativeElement.querySelectorAll('.rating-bars li')).toHaveLength(5);
    expect(fixture.nativeElement.querySelector('.rating-ring').getAttribute('aria-label')).toBe('Average rating 4.6 out of 5');
  });

  it('copes with no ratings at all', () => {
    const fixture = create({ average: null, count: 0, breakdown: {} });
    expect(fixture.nativeElement.textContent).toContain('0 reviews');
    expect(fixture.nativeElement.textContent).toContain('0%');
  });
});
