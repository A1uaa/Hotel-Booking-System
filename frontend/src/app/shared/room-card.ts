import { Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Room, RoomFilters } from '../core/api';
import { imageFallback, roomPhotosFor } from './photos';
import { money } from './stay';

@Component({
  selector: 'app-room-card',
  imports: [RouterLink],
  template: `
    <article class="room-card">
      <a class="card-image" [routerLink]="['/rooms', room().id]" [queryParams]="stay()" [attr.aria-label]="'View ' + room().room_type.name + ' ' + room().room_number">
        <img [src]="photo()" (error)="fallback($event)" loading="lazy" [alt]="room().room_type.name" />
      </a>
      <div class="card-body">
        <p class="eyebrow">Room {{ room().room_number }} · Up to {{ room().capacity }} {{ room().capacity === 1 ? 'guest' : 'guests' }}</p>
        <h3>{{ room().room_type.name }}</h3>
        <p>{{ room().description }}</p>
        <ul class="tags">@for (amenity of room().amenities; track $index) { <li>{{ amenity }}</li> }</ul>
        <div class="card-bottom">
          <span><strong>{{ money(room().price_per_night) }}</strong><small> / night</small></span>
          <a class="text-link" [routerLink]="['/rooms', room().id]" [queryParams]="stay()">View room <span aria-hidden="true">↗</span></a>
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
