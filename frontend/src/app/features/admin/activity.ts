import { Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { HotelApi } from '../../core/api';
import { TranslatePipe, language, LOCALES } from '../../core/i18n';
import { resource } from './admin-state';

interface AuditPage {
  count:number;page:number;results:{id:number;administrator:string;action:string;entity:string;description:string;created_at:string}[];
}
@Component({
  imports:[ReactiveFormsModule,TranslatePipe],
  template:`<h1>{{ 'member.activity' | t }}</h1>
    <form class="staff-panel staff-filters" [formGroup]="form" (ngSubmit)="page=1; load()">
      <label>{{ 'member.search' | t }}<input formControlName="q" /></label>
      <label>{{ 'member.administrator' | t }} ID<input type="number" formControlName="administrator" min="1" /></label>
      <label>{{ 'member.action' | t }}<input formControlName="action" placeholder="room.created" /></label>
      <label>{{ 'member.from' | t }}<input type="date" formControlName="start" /></label>
      <label>{{ 'member.to' | t }}<input type="date" formControlName="end" /></label>
      <button class="button">{{ 'member.search' | t }}</button>
    </form>
    @if (result.loading()) { <p role="status">{{ 'member.loading' | t }}</p> }
    @if (result.error()) { <p role="alert" class="notice error">{{ result.error() }}</p> }
    @if (result.data(); as data) {
      <div class="staff-table-wrap"><table class="staff-table"><thead><tr>
        <th>{{ 'member.date' | t }}</th><th>{{ 'member.administrator' | t }}</th><th>{{ 'member.action' | t }}</th><th>{{ 'member.entity' | t }}</th><th>{{ 'member.description' | t }}</th>
      </tr></thead><tbody>@for (row of data.results; track row.id) {
        <tr><td>{{ date(row.created_at) }}</td><td>{{ row.administrator }}</td><td>{{ 'event.' + row.action | t }}</td><td>{{ row.entity }}</td><td>{{ 'event.' + row.description | t }}</td></tr>
      } @empty { <tr><td colspan="5">{{ 'member.empty' | t }}</td></tr> }</tbody></table></div>
      <div class="staff-actions"><button class="button outline" [disabled]="page <= 1 || result.loading()" (click)="page=page-1;load()">{{ 'member.previous' | t }}</button>
      <span>{{ page }}</span><button class="button outline" [disabled]="page*25 >= data.count || result.loading()" (click)="page=page+1;load()">{{ 'member.next' | t }}</button></div>
    }`,
})
export class ActivityPage {
  private readonly api=inject(HotelApi);
  readonly result=resource<AuditPage>();
  readonly form=inject(FormBuilder).nonNullable.group({q:'',administrator:'',action:'',start:'',end:''});
  page=1;
  constructor(){this.load();}
  load(){
    const filters=Object.fromEntries(Object.entries(this.form.getRawValue()).filter(([,v])=>v!==''));
    this.result.load(this.api.get<AuditPage>('admin/activity/',{...filters,page:this.page}));
  }
  date(value:string){return new Date(value).toLocaleString(LOCALES[language()],{timeZone:'Asia/Almaty'});}
}
