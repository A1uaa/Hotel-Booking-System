import { Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { forkJoin } from 'rxjs';
import { RoomImage, RoomType } from '../../core/api';
import { imageFallback } from '../../shared/photos';
import { money, statusLabel } from '../../shared/stay';
import { AdminApi, ManagedRoom, RoomStatus } from './admin-api';
import { StaffSession } from './admin-session';
import { mutation, resource } from './admin-state';

@Component({ imports: [ReactiveFormsModule], templateUrl: './admin-rooms.html' })
export class AdminRooms {
  private readonly api = inject(AdminApi);
  private readonly staff = inject(StaffSession);
  readonly can = () => this.staff.current()?.capabilities;
  readonly result = resource<{ rooms: ManagedRoom[]; types: RoomType[] }>();
  readonly action = mutation();
  readonly editing = signal<ManagedRoom | null>(null);
  readonly creating = signal(false);
  readonly photo = signal<File | null>(null);
  readonly money = money;
  readonly label = statusLabel;
  readonly fallback = imageFallback;
  readonly statuses: RoomStatus[] = ['available', 'maintenance', 'out_of_service'];
  readonly form = inject(FormBuilder).nonNullable.group({
    room_number: ['', [Validators.required, Validators.maxLength(20), Validators.pattern(/\S/)]],
    room_type: [0, [Validators.required, Validators.min(1)]],
    description: ['', [Validators.required, Validators.pattern(/\S/)]],
    price_per_night: ['', [Validators.required, Validators.pattern(/^\d{1,10}(\.\d{1,2})?$/)]],
    capacity: [1, [Validators.required, Validators.min(1), Validators.max(32767), Validators.pattern(/^\d+$/)]],
    status: ['available' as RoomStatus, Validators.required],
  });

  constructor() { this.load(); }
  load() { this.result.load(forkJoin({ rooms: this.api.rooms(), types: this.api.roomTypes() })); }
  add() {
    this.editing.set(null);
    this.creating.set(true);
    this.resetFeedback();
    this.form.reset({ room_type: this.result.data()?.types[0]?.id ?? 0 });
  }
  select(room: ManagedRoom) {
    this.creating.set(false);
    this.editing.set(room);
    this.resetFeedback();
    this.form.reset(room);
  }
  close() { this.creating.set(false); this.editing.set(null); this.photo.set(null); }
  private resetFeedback() { this.action.error.set(''); this.action.feedback.set(''); this.photo.set(null); }
  save() {
    this.form.markAllAsTouched();
    if (this.form.invalid) return;
    this.action.run(this.api.saveRoom(this.form.getRawValue(), this.editing()?.id), 'Room saved.', room => {
      this.creating.set(false);
      this.editing.set(room);
      this.form.reset(room);
      this.load();
    });
  }
  remove(room: ManagedRoom) {
    if (!window.confirm('Delete room ' + room.room_number + '? This also removes its photos.')) return;
    this.action.run(this.api.deleteRoom(room.id), 'Room deleted.', () => { this.close(); this.load(); });
  }
  deactivate(room: ManagedRoom) {
    if (!window.confirm('Mark room ' + room.room_number + ' out of service? Existing reservations will be kept.')) return;
    const { room_number, room_type, description, price_per_night, capacity } = room;
    this.action.run(this.api.saveRoom({
      room_number, room_type, description, price_per_night, capacity, status: 'out_of_service',
    }, room.id), 'Room marked out of service.', updated => {
      this.editing.set(updated);
      this.form.reset(updated);
      this.load();
    });
  }
  choose(event: Event) { this.photo.set((event.target as HTMLInputElement).files?.[0] ?? null); }
  upload(room: ManagedRoom, input: HTMLInputElement) {
    const image = this.photo();
    if (!image) return;
    this.action.run(this.api.upload(room.id, image), 'Photo uploaded.', saved => {
      this.editing.set({ ...room, images: [...room.images, saved] });
      this.photo.set(null);
      input.value = '';
      this.load();
    });
  }
  primary(room: ManagedRoom, photo: RoomImage) {
    this.action.run(this.api.primary(room.id, photo.id), 'Primary photo updated.', () => {
      this.editing.set({ ...room, images: room.images.map(item => ({ ...item, is_primary: item.id === photo.id })) });
      this.load();
    });
  }
  deletePhoto(room: ManagedRoom, photo: RoomImage) {
    if (!window.confirm('Remove this room photo?')) return;
    this.action.run(this.api.deletePhoto(room.id, photo.id), 'Photo removed.', () => {
      this.editing.set({ ...room, images: room.images.filter(item => item.id !== photo.id) });
      this.load();
    });
  }
}
