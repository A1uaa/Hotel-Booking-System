import { MEMBER } from './i18n-member';
import { Pipe, PipeTransform, signal } from '@angular/core';
import { CONTENT } from './i18n-content';
import { EN } from './i18n-en';
import { KK } from './i18n-kk';
import { RU } from './i18n-ru';

export type Lang = 'kk' | 'ru' | 'en';
export const LANGUAGES: readonly Lang[] = ['kk', 'ru', 'en'];
/** Locale used for dates and numbers in each language. */
export const LOCALES: Record<Lang, string> = { kk: 'kk-KZ', ru: 'ru-KZ', en: 'en-KZ' };

const STORAGE_KEY = 'koktem.language';
const TABLES: Record<Lang, Record<string, string>> = { en: EN, ru: RU, kk: KK };

function stored(): Lang {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'kk' || value === 'ru' || value === 'en') return value;
  } catch { /* storage can be blocked; fall back to English */ }
  return 'en';
}

/** The language of the site. Anything that reads it is refreshed when the visitor switches. */
export const language = signal<Lang>(stored());

export function setLanguage(lang: Lang) {
  language.set(lang);
  try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* not remembered, still switched */ }
}

export type Params = Record<string, string | number>;

/**
 * Looks a text up in the current language. `{name}` placeholders are filled from `params`.
 * When `params.count` is a number the plural form `key.one|few|many|other` is used.
 */
export function translate(key: string, params: Params = {}): string {
  const lang = language();
  const table = {...TABLES[lang], ...MEMBER[lang]};
  const count = params['count'];
  const plural = typeof count === 'number'
    ? table[`${key}.${new Intl.PluralRules(lang).select(count)}`] ?? table[`${key}.other`] : undefined;
  const text: string = plural ?? table[key] ?? EN[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (match, name: string) => name in params ? String(params[name]) : match);
}

/** Text that comes from the hotel database (room types, descriptions, amenities). */
export function content(text: string): string {
  return CONTENT[language()][text] ?? text;
}

// Impure on purpose: the pipes must run again when the language changes.
@Pipe({ name: 't', pure: false })
export class TranslatePipe implements PipeTransform {
  transform(key: string, params?: Params): string { return translate(key, params); }
}

@Pipe({ name: 'content', pure: false })
export class ContentPipe implements PipeTransform {
  transform(text: string): string { return content(text); }
}
