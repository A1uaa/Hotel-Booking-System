import { Avatar } from '../../shared/avatar';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { Member } from '../../core/member';
import { TranslatePipe, language, setLanguage } from '../../core/i18n';
import { resource, mutation } from '../admin/admin-state';

@Component({
  imports: [Avatar, ReactiveFormsModule, TranslatePipe],
  template: `<article class="panel">
    <h1>{{ 'member.' + mode | t }}</h1>
    @if (result.loading()) { <p role="status">{{ 'member.loading' | t }}</p> }
    @if (result.error()) { <p role="alert" class="notice error">{{ result.error() }}</p><button class="button outline" (click)="load()">{{ 'bk.retry' | t }}</button> }
    @if (mode === 'profile' && result.data(); as profile) {
      <p>{{ profile.email }} · {{ profile.role }}</p>
      <div class="avatar-editor">
        <app-avatar [large]="true" [photo]="preview() || member.profile()?.photo" />
        <label>{{ 'member.photo' | t }}<input #photoInput type="file" accept="image/jpeg,image/png,image/webp" (change)="select($event)" /></label>
        <button class="button outline" [disabled]="!file() || action.saving()" (click)="upload(photoInput)">{{ 'member.upload' | t }}</button>
        <button class="plain-button" [disabled]="!member.profile()?.photo || action.saving()" (click)="remove()">{{ 'member.remove' | t }}</button>
      </div>
      <form class="form-stack" [formGroup]="form" (ngSubmit)="save()">
        <label>{{ 'member.first' | t }}<input formControlName="first_name" maxlength="150" autocomplete="given-name" /></label>
        <label>{{ 'member.last' | t }}<input formControlName="last_name" maxlength="150" autocomplete="family-name" /></label>
        <label>{{ 'member.phone' | t }}<input formControlName="phone" maxlength="30" autocomplete="tel" /></label>
        <button class="button" [disabled]="action.saving()">{{ 'member.save' | t }}</button>
      </form>
    }
    @if (mode === 'preferences') {
      <form class="form-stack" (submit)="$event.preventDefault(); preferences()">
        <label>{{ 'member.language' | t }}<select [value]="lang()" (change)="lang.set($any($event.target).value)">
          <option value="en">English</option><option value="ru">Русский</option><option value="kk">Қазақша</option>
        </select></label><button class="button" [disabled]="action.saving()">{{ 'member.save' | t }}</button>
      </form>
    }
    @if (mode === 'security') {
      <form class="form-stack" [formGroup]="password" (ngSubmit)="changePassword()">
        @for (field of ['current_password','new_password','confirmation']; track field) {
          <label>{{ 'member.' + field | t }}<input [type]="show() ? 'text' : 'password'" [formControlName]="field" [attr.autocomplete]="field === 'current_password' ? 'current-password' : 'new-password'" /></label>
        }
        <button class="plain-button" type="button" (click)="show.set(!show())">{{ (show() ? 'member.hide' : 'member.show') | t }}</button>
        <button class="button" [disabled]="action.saving()">{{ 'member.save' | t }}</button>
      </form>
    }
    @if (action.error()) { <p class="notice error" role="alert">{{ action.error() }}</p> }
    @if (action.feedback()) { <p class="notice success" role="status">{{ 'member.saved' | t }}</p> }
  </article>`,
})
export class ProfilePage {
  readonly member = inject(Member);
  private readonly destroy = inject(DestroyRef);
  readonly mode = inject(ActivatedRoute).snapshot.data['mode'] as string || 'profile';
  readonly result = resource<import('../../core/member').Profile>();
  readonly action = mutation();
  readonly lang = signal(language());
  readonly file = signal<File | null>(null);
  readonly preview = signal('');
  readonly show = signal(false);
  readonly form = inject(FormBuilder).nonNullable.group({first_name:'',last_name:'',phone:''});
  readonly password = inject(FormBuilder).nonNullable.group({current_password:'',new_password:'',confirmation:''});
  constructor() { this.load(); this.destroy.onDestroy(() => this.clearPreview()); }
  load() {
    this.result.load(this.member.loadProfile().pipe(tap(profile => {
      this.form.patchValue(profile); this.lang.set(profile.preferred_language);
      setLanguage(profile.preferred_language);
    })));
  }
  save() { this.action.run(this.member.saveProfile(this.form.getRawValue()), 'saved', () => {}); }
  preferences() { this.action.run(this.member.saveProfile({preferred_language:this.lang()}), 'saved', () => setLanguage(this.lang())); }
  changePassword() {
    this.action.run(this.member.api.post('account/password/', this.password.getRawValue()), 'saved', () => this.password.reset());
  }
  select(event: Event) {
    this.clearPreview();
    this.file.set((event.target as HTMLInputElement).files?.[0] ?? null);
    if (this.file()) this.preview.set(URL.createObjectURL(this.file()!));
  }
  upload(input: HTMLInputElement) {
    if (!this.file()) return;
    this.action.run(this.member.photo(this.file()!), 'saved', () => { this.clearPreview(); this.file.set(null); input.value=''; });
  }
  remove() { this.action.run(this.member.removePhoto(), 'saved', () => this.clearPreview()); }
  private clearPreview() { if (this.preview()) URL.revokeObjectURL(this.preview()); this.preview.set(''); }
}
import { tap } from 'rxjs';

