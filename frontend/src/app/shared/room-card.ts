import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Room, RoomFilters } from '../core/api';
import { ContentPipe, TranslatePipe } from '../core/i18n';
import { imageFallback, roomPhotosFor } from './photos';
import { Stars } from './stars';
import { money } from './stay';

@Component({
  selector: 'app-room-card',
  imports: [RouterLink, Stars, TranslatePipe, ContentPipe],
  template: `
    <article class="room-card">
      <a class="card-image" [routerLink]="['/rooms', room().id]" [queryParams]="stay()" [attr.aria-label]="'card.viewAria' | t: { name: (room().room_type.name | content), number: room().room_number }">
        <img [src]="photo()" (error)="fallback($event)" loading="lazy" [alt]="room().room_type.name | content" />
      </a>
      <div class="card-body">
        <p class="eyebrow">{{ 'common.room' | t: { number: room().room_number } }} · {{ 'common.upTo' | t: { count: room().capacity } }}</p>
        <h3>{{ room().room_type.name | content }}</h3>
        @if (room().rating_count) {
          <p class="room-rating"><app-stars [value]="room().rating_average ?? 0" /> <strong>{{ room().rating_average }}</strong> <small class="muted">({{ 'reviews.count' | t: { count: room().rating_count ?? 0 } }})</small></p>
        } @else { <p class="room-rating muted"><small>{{ 'reviews.none' | t }}</small></p> }
        <p>{{ room().description | content }}</p>
        <ul class="tags">@for (amenity of room().amenities; track $index) { <li>{{ amenity | content }}</li> }</ul>
        <div class="card-bottom">
          <span><strong>{{ money(room().price_per_night) }}</strong><small> {{ 'common.night' | t }}</small></span>
          <a class="text-link" [routerLink]="['/rooms', room().id]" [queryParams]="stay()">{{ 'card.viewRoom' | t }} <span aria-hidden="true">↗</span></a>
        </div>
      </div>
    </article>
  `,
})
export class RoomCard {
  readonly room = input.required<Room>();
  readonly stay = input<RoomFilters>({});
  readonly photo = computed(() => roomPhotosFor(this.room())[0]);
  readonly fallback = imageFallback;
  readonly money = money;
}
