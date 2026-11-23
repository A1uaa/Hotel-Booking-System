import { Stay } from '../core/api';

// All dates are ISO strings (YYYY-MM-DD). A stay occupies the nights from check_in up to,
// but not including, check_out, so the check-out day is free for the next guest.

function parts(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const { y, m, d } = parts(iso);
  return toIso(Date.UTC(y, m - 1, d + days));
}

/** First day of the month that lies `months` months after the month of `iso`. */
export function addMonths(iso: string, months: number): string {
  const { y, m } = parts(iso);
  return toIso(Date.UTC(y, m - 1 + months, 1));
}

/** The days of one month, preceded by `null` padding so that weeks start on Monday. */
export function monthGrid(monthStart: string): (string | null)[] {
  const { y, m } = parts(monthStart);
  const lead = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [
    ...Array<null>(lead).fill(null),
    ...Array.from({ length: count }, (_, index) => toIso(Date.UTC(y, m - 1, index + 1))),
  ];
}

/** Is the night that starts on `iso` taken by one of the stays? */
export function nightIsBooked(iso: string, booked: Stay[]): boolean {
  return booked.some(stay => stay.check_in <= iso && iso < stay.check_out);
}

/** Can a guest stay from `start` to `end` without touching another stay? */
export function rangeIsFree(start: string, end: string, booked: Stay[]): boolean {
  return !booked.some(stay => stay.check_in < end && stay.check_out > start);
}
