import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { API_BASE } from '../../core/api';
import { Member, Profile } from '../../core/member';
import { MEMBER } from '../../core/i18n-member';
import { setLanguage, translate } from '../../core/i18n';
import { ProfilePage } from './profile';
import { HistoryPage } from './history';

const profile:Profile = {
  id:4,email:'guest@example.test',first_name:'Aida',last_name:'Omar',phone:'+7 700 123 4567',
  preferred_language:'en',photo:null,role:'Guest',
};

describe('Member account',()=>{
  let http:HttpTestingController;
  function setup(mode:string){
    TestBed.configureTestingModule({providers:[
      provideHttpClient(),provideHttpClientTesting(),provideRouter([]),
      {provide:API_BASE,useValue:'/api/'},
      {provide:ActivatedRoute,useValue:{snapshot:{data:{mode}}}},
    ]});
    http=TestBed.inject(HttpTestingController);
  }
  afterEach(()=>{http.verify();setLanguage('en');});
  it('loads the existing account and saves only editable profile information',()=>{
    setup('profile');
    const fixture=TestBed.createComponent(ProfilePage);fixture.detectChanges();
    const get=http.expectOne('/api/account/profile/');
    expect(get.request.withCredentials).toBe(true);get.flush(profile);fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain(profile.email);
    fixture.componentInstance.form.controls.first_name.setValue('Dana');
    fixture.componentInstance.save();
    http.expectOne('/api/auth/csrf/').flush({csrf_token:'profile-token'});
    const update=http.expectOne('/api/account/profile/');
    expect(update.request.method).toBe('PATCH');
    expect(update.request.body).toEqual({first_name:'Dana',last_name:'Omar',phone:profile.phone});
    update.flush({...profile,first_name:'Dana'});
    expect(TestBed.inject(Member).profile()?.first_name).toBe('Dana');
  });
  it('saves the language on the backend and updates the existing translation system',()=>{
    setup('preferences');
    const fixture=TestBed.createComponent(ProfilePage);
    http.expectOne('/api/account/profile/').flush(profile);
    fixture.componentInstance.lang.set('kk');fixture.componentInstance.preferences();
    http.expectOne('/api/auth/csrf/').flush({csrf_token:'language-token'});
    const update=http.expectOne('/api/account/profile/');
    expect(update.request.body).toEqual({preferred_language:'kk'});
    update.flush({...profile,preferred_language:'kk'});fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Баптаулар');
  });
  it('uses multipart upload and CSRF for profile photos',()=>{
    setup('profile');
    const member=TestBed.inject(Member);
    const image=new File(['test-image'],'avatar.png',{type:'image/png'});
    member.photo(image).subscribe();
    http.expectOne('/api/auth/csrf/').flush({csrf_token:'photo-token'});
    const upload=http.expectOne('/api/account/profile/photo/');
    expect(upload.request.body.get('photo')).toBe(image);
    expect(upload.request.headers.get('X-CSRFToken')).toBe('photo-token');
    upload.flush({...profile,photo:'http://localhost:8000/media/profiles/avatar.png'});
    expect(member.profile()?.photo).toContain('/media/profiles/');
  });
  it('keeps password errors visible and never reports a failed change as saved',()=>{
    setup('security');
    const fixture=TestBed.createComponent(ProfilePage);
    http.expectOne('/api/account/profile/').flush(profile);
    fixture.componentInstance.password.setValue({current_password:'bad',new_password:'new',confirmation:'new'});
    fixture.componentInstance.changePassword();
    http.expectOne('/api/auth/csrf/').flush({csrf_token:'security-token'});
    http.expectOne('/api/account/password/').flush({current_password:['The current password is incorrect.']},{status:400,statusText:'Bad Request'});
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('current password');
    expect(fixture.componentInstance.action.feedback()).toBe('');
  });
  it('loads payment history with backend filters',()=>{
    setup('payments');
    const fixture=TestBed.createComponent(HistoryPage);
    http.expectOne('/api/account/payments/').flush({payments:[],bookings:[]});
    fixture.componentInstance.paymentStatus='refunded';fixture.componentInstance.load();
    const filter=http.expectOne('/api/account/payments/?status=refunded');
    expect(filter.request.withCredentials).toBe(true);
    filter.flush({payments:[],bookings:[]});
  });
  it('removes a favorite only after backend success then reloads persistent favorites',()=>{
    setup('favorites');
    const fixture=TestBed.createComponent(HistoryPage);
    http.expectOne('/api/account/favorites/').flush([]);
    fixture.componentInstance.removeFavorite(3);
    http.expectOne('/api/auth/csrf/').flush({csrf_token:'favorite-token'});
    const remove=http.expectOne('/api/account/favorites/3/');
    expect(remove.request.method).toBe('DELETE');
    remove.flush(null,{status:204,statusText:'No Content'});
    http.expectOne('/api/account/favorites/').flush([]);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("You haven't saved any rooms yet.");
  });
  it('marks notifications read and refreshes the unread state',()=>{
    setup('notifications');
    const fixture=TestBed.createComponent(HistoryPage);
    http.expectOne('/api/account/notifications/').flush({unread:1,results:[]});
    fixture.componentInstance.read();
    http.expectOne('/api/auth/csrf/').flush({csrf_token:'notice-token'});
    http.expectOne('/api/account/notifications/read-all/').flush({status:'ok'});
    http.expectOne('/api/account/notifications/').flush({unread:0,results:[]});
    expect(fixture.componentInstance.notices.data()?.unread).toBe(0);
  });
  it('provides all new labels and event messages in every supported language',()=>{
    setup('profile');
    for(const key of Object.keys(MEMBER['en'])){
      expect(MEMBER['ru'][key],key).toBeTruthy();
      expect(MEMBER['kk'][key],key).toBeTruthy();
    }
    setLanguage('ru');
    expect(translate('member.reviewHint')).toContain('завершения проживания');
  });
});

