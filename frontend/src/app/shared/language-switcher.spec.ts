import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Room } from '../core/api';
import { language, setLanguage } from '../core/i18n';
import { LanguageSwitcher } from './language-switcher';
import { RoomCard } from './room-card';

const room: Room = {
  id: 3, room_number: '101', room_type: { id: 1, name: 'Standard Room' }, description: 'Quiet single room overlooking the courtyard.',
  price_per_night: '24000', capacity: 1, amenities: ['Wi-Fi', 'Work desk'], images: [], available: true,
};

describe('LanguageSwitcher', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));
  afterEach(() => setLanguage('en'));

  function buttons(fixture: { nativeElement: HTMLElement }) {
    return Array.from(fixture.nativeElement.querySelectorAll('.language-switcher button')) as HTMLButtonElement[];
  }

  it('shows the Kazakh, Russian and English flags with English selected', () => {
    const fixture = TestBed.createComponent(LanguageSwitcher);
    fixture.detectChanges();
    const items = buttons(fixture);
    expect(items.map(button => button.getAttribute('aria-label'))).toEqual(['Қазақша', 'Русский', 'English']);
    expect(items.every(button => button.querySelector('svg') !== null)).toBe(true);
    expect(items.map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'false', 'true']);
  });

  it('changes the language of the whole page when a flag is chosen', () => {
    const card = TestBed.createComponent(RoomCard);
    card.componentRef.setInput('room', room);
    card.detectChanges();
    expect(card.nativeElement.textContent).toContain('No reviews yet');
    expect(card.nativeElement.textContent).toContain('Standard Room');

    const fixture = TestBed.createComponent(LanguageSwitcher);
    fixture.detectChanges();
    buttons(fixture)[1].click(); // Russian
    fixture.detectChanges();
    card.detectChanges();
    expect(language()).toBe('ru');
    expect(buttons(fixture).map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(card.nativeElement.textContent).toContain('Пока нет отзывов');
    expect(card.nativeElement.textContent).toContain('Стандартный номер');
    expect(card.nativeElement.textContent).toContain('Рабочий стол');
    expect(card.nativeElement.textContent).toContain('Смотреть номер');

    buttons(fixture)[0].click(); // Kazakh
    card.detectChanges();
    expect(card.nativeElement.textContent).toContain('Әзірге пікір жоқ');
    expect(card.nativeElement.textContent).toContain('Стандартты бөлме');

    buttons(fixture)[2].click(); // back to English
    card.detectChanges();
    expect(card.nativeElement.textContent).toContain('No reviews yet');
  });
});
