import { DOCUMENT } from '@angular/common';
import { Component, effect, afterEveryRender, inject } from '@angular/core';
import { language } from './core/i18n';
import { Router, RouterOutlet } from '@angular/router';

@Component({ selector: 'app-root', imports: [RouterOutlet], templateUrl: './app.html' })
export class App {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  // Tells browsers and screen readers which language the page is in.
  constructor() {
    effect(() => { this.document.documentElement.lang = language(); });
    let appliedUrl = "";
    afterEveryRender(() => {
      const url = this.router.url;
      const fragment = this.router.parseUrl(url).fragment;
      if (!fragment) { appliedUrl = ""; return; }
      if (appliedUrl === url) return;
      const target = this.document.getElementById(fragment);
      if (target) {
        target.scrollIntoView({block: "start"});
        appliedUrl = url;
      }
    });
  }
}
