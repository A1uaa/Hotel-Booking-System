import { TestBed } from '@angular/core/testing';
import { AvailabilityCalendar } from './availability-calendar';
import { addDays, addMonths, monthGrid, nightIsBooked, rangeIsFree } from './calendar';

const booked = [{ check_in: '2030-01-15', check_out: '2030-01-18' }];

describe('calendar helpers', () => {
  it('adds days and months across boundaries', () => {
    expect(addDays('2030-01-31', 1)).toBe('2030-02-01');
    expect(addDays('2030-03-01', -1)).toBe('2030-02-28');
    expect(addMonths('2030-11-17', 2)).toBe('2031-01-01');
  });

  it('builds a Monday-first month grid', () => {
    const grid = monthGrid('2030-01-01'); // 1 January 2030 is a Tuesday
    expect(grid.slice(0, 2)).toEqual([null, '2030-01-01']);
    expect(grid.filter(Boolean)).toHaveLength(31);
    expect(grid.at(-1)).toBe('2030-01-31');
  });

  it('treats the check-out day as free', () => {
    expect(nightIsBooked('2030-01-15', booked)).toBe(true);
    expect(nightIsBooked('2030-01-17', booked)).toBe(true);
    expect(nightIsBooked('2030-01-18', booked)).toBe(false);
    expect(nightIsBooked('2030-01-14', booked)).toBe(false);
  });

  it('accepts stays that only touch an existing one', () => {
    expect(rangeIsFree('2030-01-12', '2030-01-15', booked)).toBe(true);
    expect(rangeIsFree('2030-01-18', '2030-01-20', booked)).toBe(true);
    expect(rangeIsFree('2030-01-12', '2030-01-16', booked)).toBe(false);
    expect(rangeIsFree('2030-01-16', '2030-01-17', booked)).toBe(false);
    expect(rangeIsFree('2030-01-10', '2030-01-25', booked)).toBe(false);
  });
});

describe('AvailabilityCalendar', () => {
  function render(checkIn = '', checkOut = '') {
    const fixture = TestBed.createComponent(AvailabilityCalendar);
    fixture.componentRef.setInput('today', '2030-01-10');
    fixture.componentRef.setInput('booked', booked);
    fixture.componentRef.setInput('checkIn', checkIn);
    fixture.componentRef.setInput('checkOut', checkOut);
    fixture.detectChanges();
    const cell = (iso: string) => fixture.nativeElement.querySelector(`[data-date="${iso}"]`) as HTMLButtonElement;
    return { fixture, cell };
  }

  it('disables past days and booked nights but not the check-out day', () => {
    const { cell } = render();
    expect(cell('2030-01-09').disabled).toBe(true);
    expect(cell('2030-01-10').disabled).toBe(false);
    expect(cell('2030-01-15').disabled).toBe(true);
    expect(cell('2030-01-17').disabled).toBe(true);
    expect(cell('2030-01-18').disabled).toBe(false);
  });

  it('starts a stay with the first click', () => {
    const { fixture, cell } = render();
    const picks: unknown[] = [];
    fixture.componentInstance.pick.subscribe(value => picks.push(value));
    cell('2030-01-12').click();
    expect(picks).toEqual([{ check_in: '2030-01-12', check_out: '' }]);
  });

  it('completes a stay only when no booked night lies in between', () => {
    const { fixture, cell } = render('2030-01-12');
    const picks: unknown[] = [];
    fixture.componentInstance.pick.subscribe(value => picks.push(value));
    expect(cell('2030-01-15').disabled).toBe(false); // check out on the day the next stay begins
    expect(cell('2030-01-16').disabled).toBe(true);
    expect(cell('2030-01-20').disabled).toBe(true);
    cell('2030-01-15').click();
    expect(picks).toEqual([{ check_in: '2030-01-12', check_out: '2030-01-15' }]);
  });

  it('starts over when a complete stay is already chosen', () => {
    const { fixture, cell } = render('2030-01-12', '2030-01-14');
    const picks: unknown[] = [];
    fixture.componentInstance.pick.subscribe(value => picks.push(value));
    cell('2030-01-20').click();
    expect(picks).toEqual([{ check_in: '2030-01-20', check_out: '' }]);
  });

  it('moves between months but never before the current one', () => {
    const { fixture } = render();
    const root: HTMLElement = fixture.nativeElement;
    const [prev, next] = Array.from(root.querySelectorAll<HTMLButtonElement>('.calendar-nav'));
    expect(prev.disabled).toBe(true);
    next.click();
    fixture.detectChanges();
    expect(root.querySelector('[data-date="2030-02-01"]')).not.toBeNull();
    expect(root.querySelector('[data-date="2030-01-31"]')).toBeNull();
    expect(prev.disabled).toBe(false);
  });
});
