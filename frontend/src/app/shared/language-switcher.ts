import { Component } from '@angular/core';
import { Lang, language, LANGUAGES, setLanguage, TranslatePipe } from '../core/i18n';

/** Three flag buttons: Kazakh, Russian and English. The choice is remembered in the browser. */
@Component({
  selector: 'app-language-switcher',
  imports: [TranslatePipe],
  template: `
    <div class="language-switcher" role="group" [attr.aria-label]="'lang.label' | t">
      @for (lang of languages; track lang) {
        <button type="button" [class.active]="current() === lang" [attr.aria-pressed]="current() === lang"
          [attr.lang]="lang" [attr.aria-label]="names[lang]" [attr.title]="names[lang]" (click)="choose(lang)">
          @switch (lang) {
            @case ('kk') {
              <svg viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#00afca" />
                <circle cx="15" cy="9" r="3.4" fill="#fec50c" />
                <g stroke="#fec50c" stroke-width="1" stroke-linecap="round"><path d="M15 3.2v1.4M15 13.4v1.4M9.2 9H7.8M22.2 9h-1.4M10.9 4.9l1 1M18.1 12.1l1 1M19.1 4.9l-1 1M11.9 12.1l-1 1" /></g>
                <path d="M3.5 17.2h23" stroke="#fec50c" stroke-width="1.1" stroke-linecap="round" /></svg>
            }
            @case ('ru') {
              <svg viewBox="0 0 30 20" aria-hidden="true"><rect width="30" height="20" fill="#fff" />
                <rect y="6.67" width="30" height="6.67" fill="#0039a6" /><rect y="13.33" width="30" height="6.67" fill="#d52b1e" /></svg>
            }
            @case ('en') {
              <svg viewBox="0 0 60 40" aria-hidden="true"><rect width="60" height="40" fill="#012169" />
                <path d="M0 0l60 40M60 0L0 40" stroke="#fff" stroke-width="8" />
                <path d="M0 0l60 40M60 0L0 40" stroke="#c8102e" stroke-width="3" />
                <path d="M30 0v40M0 20h60" stroke="#fff" stroke-width="13" />
                <path d="M30 0v40M0 20h60" stroke="#c8102e" stroke-width="7" /></svg>
            }
          }
        </button>
      }
    </div>
  `,
})
export class LanguageSwitcher {
  readonly languages = LANGUAGES;
  readonly current = language;
  // Each language is named in itself so a visitor can always find theirs.
  readonly names: Record<Lang, string> = { kk: 'Қазақша', ru: 'Русский', en: 'English' };
  choose(lang: Lang) { setLanguage(lang); }
}
