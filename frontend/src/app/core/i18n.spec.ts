import { content, language, LANGUAGES, setLanguage, translate } from './i18n';
import { EN } from './i18n-en';
import { KK } from './i18n-kk';
import { RU } from './i18n-ru';

describe('i18n', () => {
  afterEach(() => setLanguage('en'));

  it('starts in English and returns the English text', () => {
    expect(language()).toBe('en');
    expect(translate('nav.home')).toBe('Home');
  });

  it('switches the language and remembers the choice', () => {
    setLanguage('kk');
    expect(language()).toBe('kk');
    expect(translate('nav.home')).toBe('Басты бет');
    expect(localStorage.getItem('koktem.language')).toBe('kk');
    setLanguage('ru');
    expect(translate('nav.home')).toBe('Главная');
  });

  it('fills placeholders and keeps unknown ones', () => {
    expect(translate('bk.res', { id: 7 })).toBe('Reservation #7');
    expect(translate('bk.res')).toBe('Reservation #{id}');
  });

  it('picks the plural form of each language', () => {
    expect(translate('reviews.count', { count: 1 })).toBe('1 review');
    expect(translate('reviews.count', { count: 3 })).toBe('3 reviews');
    setLanguage('ru');
    expect(translate('reviews.count', { count: 1 })).toBe('1 отзыв');
    expect(translate('reviews.count', { count: 3 })).toBe('3 отзыва');
    expect(translate('reviews.count', { count: 5 })).toBe('5 отзывов');
    expect(translate('reviews.count', { count: 21 })).toBe('21 отзыв');
    setLanguage('kk');
    expect(translate('reviews.count', { count: 5 })).toBe('5 пікір');
  });

  it('shows the key when a text does not exist', () => {
    expect(translate('does.not.exist')).toBe('does.not.exist');
  });

  it('translates the hotel content and leaves unknown text alone', () => {
    expect(content('Standard Room')).toBe('Standard Room');
    setLanguage('ru');
    expect(content('Standard Room')).toBe('Стандартный номер');
    expect(content('Rooftop pool')).toBe('Rooftop pool');
    setLanguage('kk');
    expect(content('Wi-Fi')).toBe('Wi-Fi');
    expect(content('Bathtub')).toBe('Ванна');
  });

  it('has every English text in Russian and Kazakh with the same placeholders', () => {
    const names = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join();
    for (const [lang, table] of [['ru', RU], ['kk', KK]] as const) {
      for (const [key, text] of Object.entries(EN)) {
        expect(table[key], lang + ' ' + key).toBeTruthy();
        expect(names(table[key] ?? ''), lang + ' ' + key).toBe(names(text));
      }
    }
  });

  it('has all four Russian plural forms wherever English has a plural', () => {
    for (const key of Object.keys(EN).filter(key => key.endsWith('.one'))) {
      const base = key.slice(0, -4);
      for (const form of ['one', 'few', 'many', 'other']) expect(RU[`${base}.${form}`], base + form).toBeTruthy();
    }
  });

  it('offers Kazakh, Russian and English', () => {
    expect([...LANGUAGES]).toEqual(['kk', 'ru', 'en']);
  });
});
