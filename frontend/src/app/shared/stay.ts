import { AbstractControl } from '@angular/forms';

export function hotelToday(): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts();
  const value = (name: string) => parts.find(part => part.type === name)?.value;
  return [value('year'), value('month'), value('day')].join('-');
}

export function stayDates(control: AbstractControl) {
  const { check_in, check_out } = control.value;
  if (!check_in && !check_out) return null;
  if (!check_in || !check_out) return { datePair: true };
  if (check_in < hotelToday() || check_out <= check_in) return { dateOrder: true };
  return null;
}

export function nights(start: string, end: string) {
  return Math.max(0, (Date.parse(end) - Date.parse(start)) / 86_400_000) || 0;
}

export function money(value: string | number): string {
  return new Intl.NumberFormat('en-KZ', { maximumFractionDigits: 2 }).format(Number(value)) + ' ₸';
}

export function statusLabel(value: string): string {
  return value.replaceAll('_', ' ');
}
