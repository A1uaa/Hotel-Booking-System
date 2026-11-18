import { Component, effect } from '@angular/core';
import { language } from './core/i18n';
import { RouterOutlet } from '@angular/router';

@Component({ selector: 'app-root', imports: [RouterOutlet], templateUrl: './app.html' })
export class App {
  // Tells browsers and screen readers which language the page is in.
  constructor() { effect(() => { document.documentElement.lang = language(); }); }
}
