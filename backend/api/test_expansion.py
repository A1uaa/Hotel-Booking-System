from datetime import timedelta, datetime, timezone as dt_timezone
from io import BytesIO
from tempfile import TemporaryDirectory
from unittest.mock import patch
from django.contrib.auth import get_user_model
from django.db import IntegrityError, transaction
from django.test import TestCase, override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient
from hotel.models import AuditLog, Booking, Favorite, Notification, Payment, Review, UserProfile, Room
from .tests import inventory

User = get_user_model()

class ExpansionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.room = inventory()
        cls.user = User.objects.create_user("expansion", "expansion@example.test", "Strong-test-oak-47!")
        cls.other = User.objects.create_user("other-expansion")
        cls.staff = User.objects.create_superuser("staff-expansion", "staff@example.test", "Strong-test-oak-47!")

    def setUp(self):
        self.client = APIClient()
        self.client.force_login(self.user)
        self.today = timezone.localdate()

    def stay(self, status="checked_out", user=None, offset=-5):
        return Booking.objects.create(
            user=user or self.user, room=self.room, check_in=self.today+timedelta(days=offset),
            check_out=self.today+timedelta(days=offset+2), guest_count=1,
            price_per_night=10000,total_price=20000,status=status,
        )

    def test_review_requires_owner_completed_stay_and_matching_room(self):
        url=f"/api/rooms/{self.room.pk}/reviews/"
        stay=self.stay(status="pending")
        self.assertEqual(APIClient().post(url, {"booking":stay.pk,"rating":5}).status_code,403)
        for status in ("pending","confirmed","checked_in","cancelled"):
            Booking.objects.filter(pk=stay.pk).update(status=status)
            self.assertEqual(self.client.post(url, {"booking":stay.pk,"rating":5}).status_code,400)
        Booking.objects.filter(pk=stay.pk).update(status="checked_out")
        stranger=APIClient(); stranger.force_login(self.other)
        self.assertEqual(stranger.post(url, {"booking":stay.pk,"rating":5}).status_code,404)
        other_room=Room.objects.create(room_type=self.room.room_type,room_number="extra",price_per_night=100,capacity=1)
        self.assertEqual(self.client.post(f"/api/rooms/{other_room.pk}/reviews/", {"booking":stay.pk,"rating":5}).status_code,404)
        response=self.client.post(url,{"booking":stay.pk,"rating":5,"user":self.other.pk,"verified_stay":False})
        self.assertEqual(response.status_code,201,response.data)
        self.assertTrue(response.data["review"]["verified_stay"])
        self.assertEqual(self.client.post(url,{"booking":stay.pk,"rating":1}).status_code,409)
        review=Review.objects.get(booking=stay)
        self.assertEqual(stranger.patch(f"/api/account/reviews/{review.pk}/",{"rating":2}).status_code,404)
        self.assertEqual(stranger.delete(f"/api/account/reviews/{review.pk}/").status_code,404)
        self.assertEqual(self.client.patch(f"/api/account/reviews/{review.pk}/",{"rating":4,"booking":999}).status_code,200)
        review.refresh_from_db();self.assertEqual(review.booking_id,stay.pk)
        self.assertEqual(self.client.delete(f"/api/account/reviews/{review.pk}/").status_code,204)

    def test_multiple_completed_stays_have_separate_reviews_and_legacy_is_unverified(self):
        for offset in (-10,-5):
            stay=self.stay(offset=offset)
            self.assertEqual(self.client.post(f"/api/rooms/{self.room.pk}/reviews/",{"booking":stay.pk,"rating":5}).status_code,201)
        legacy=Review.objects.create(room=self.room,user=self.user,rating=2)
        data=self.client.get(f"/api/rooms/{self.room.pk}/reviews/").data
        self.assertFalse(next(row for row in data["reviews"] if row["id"]==legacy.pk)["verified_stay"])

    def test_profile_existing_user_and_privilege_fields(self):
        url="/api/account/profile/"
        self.assertEqual(APIClient().get(url).status_code,403)
        self.assertEqual(self.client.get(url).data["email"],self.user.email)
        self.assertTrue(UserProfile.objects.filter(user=self.user).exists())
        updated=self.client.patch(url,{"first_name":"Aida","phone":"+7 700 123 45 67","preferred_language":"kk","is_staff":True,"email":"other@test.com"})
        self.assertEqual(updated.status_code,200)
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_staff);self.assertEqual(self.user.email,"expansion@example.test")
        self.assertEqual(self.client.get(url).data["first_name"],"Aida")
        self.assertEqual(self.client.get(f"/api/account/profile/{self.other.pk}/").status_code,404)

    def test_profile_photo_valid_invalid_size_replace_remove(self):
        with TemporaryDirectory() as folder, override_settings(MEDIA_ROOT=folder):
            stream=BytesIO();Image.new("RGB",(10,10),"green").save(stream,format="PNG")
            url="/api/account/profile/photo/"
            invalid=SimpleUploadedFile("not.jpg",b"not-an-image")
            self.assertEqual(self.client.post(url,{"photo":invalid}).status_code,400)
            big=SimpleUploadedFile("large.png",b"0"*(5*1024*1024+1))
            self.assertEqual(self.client.post(url,{"photo":big}).status_code,400)
            self.assertEqual(self.client.post(url,{"photo":SimpleUploadedFile("room.png",stream.getvalue())}).status_code,200)
            profile=UserProfile.objects.get(user=self.user)
            old=profile.photo.name;storage=profile.photo.storage
            self.assertTrue(storage.exists(old))
            with self.captureOnCommitCallbacks(execute=True):
                self.assertEqual(self.client.post(url,{"photo":SimpleUploadedFile("new.png",stream.getvalue())}).status_code,200)
            self.assertFalse(storage.exists(old))
            profile.refresh_from_db();new=profile.photo.name
            with self.captureOnCommitCallbacks(execute=True):
                self.assertEqual(self.client.delete(url).status_code,200)
            self.assertFalse(storage.exists(new))
            self.assertIsNone(self.client.get("/api/account/profile/").data["photo"])

    def test_favorites_are_unique_persistent_and_owned(self):
        url=f"/api/account/favorites/{self.room.pk}/"
        self.assertEqual(APIClient().post(url).status_code,403)
        for _ in range(2):self.assertEqual(self.client.post(url).status_code,200)
        self.assertEqual(Favorite.objects.count(),1)
        stranger=APIClient();stranger.force_login(self.other)
        self.assertEqual(stranger.get("/api/account/favorites/").data,[])
        stranger.delete(url);self.assertTrue(Favorite.objects.filter(user=self.user).exists())
        self.assertEqual(self.client.get("/api/account/favorites/").data[0]["id"],self.room.pk)
        self.assertEqual(self.client.delete(url).status_code,204)

    def test_password_checks_hashing_and_session(self):
        url="/api/account/password/"
        body={"current_password":"Strong-test-oak-47!","new_password":"Different-forest-secret-27!","confirmation":"Different-forest-secret-27!"}
        self.assertEqual(self.client.post(url,body|{"current_password":"wrong"}).status_code,400)
        self.assertEqual(self.client.post(url,body|{"confirmation":"wrong"}).status_code,400)
        self.assertEqual(self.client.post(url,body|{"new_password":"123","confirmation":"123"}).status_code,400)
        self.assertEqual(self.client.post(url,body).status_code,200)
        self.user.refresh_from_db();self.assertTrue(self.user.check_password(body["new_password"]))
        self.assertNotEqual(self.user.password,body["new_password"])
        self.assertEqual(self.client.get("/api/auth/me/").status_code,200)

    def test_payments_and_notifications_are_owned_and_repeat_actions_do_not_duplicate_events(self):
        stay=self.stay(status="pending")
        payment=Payment.objects.create(booking=stay,amount=100,status="paid",payment_method="Cash",method="cash")
        owned=self.client.get("/api/account/payments/").data
        self.assertEqual(owned["payments"][0]["id"],payment.pk)
        stranger=APIClient();stranger.force_login(self.other)
        self.assertEqual(stranger.get("/api/account/payments/").data["payments"],[])
        data=self.client.get("/api/account/notifications/").data
        self.assertEqual(data["unread"],len(data["results"]))
        pk=data["results"][0]["id"]
        self.assertEqual(stranger.post(f"/api/account/notifications/{pk}/read/").status_code,404)
        self.assertEqual(self.client.post(f"/api/account/notifications/{pk}/read/").status_code,200)
        self.client.post("/api/account/notifications/read-all/")
        self.assertEqual(self.client.get("/api/account/notifications/").data["unread"],0)
        before=Notification.objects.count()
        payment.save()
        self.assertEqual(Notification.objects.count(),before)

    def test_successful_admin_actions_audit_and_failed_actions_rollback(self):
        self.client.force_login(self.staff)
        url=f"/api/admin/rooms/{self.room.pk}/"
        self.assertEqual(self.client.patch(url,{"price_per_night":"12345"}).status_code,200)
        self.assertTrue(AuditLog.objects.filter(action="room.price",administrator=self.staff).exists())
        before=AuditLog.objects.count()
        self.assertEqual(self.client.patch(url,{"capacity":0}).status_code,400)
        self.assertEqual(AuditLog.objects.count(),before)
        self.assertEqual(self.client.delete(url).status_code,204)
        self.assertTrue(AuditLog.objects.filter(entity_id=str(self.room.pk),action="room.deleted").exists())
        logs=self.client.get("/api/admin/activity/").data
        self.assertTrue(logs["count"]>0)
        self.assertEqual(self.client.patch("/api/admin/activity/",{}).status_code,405)
        self.assertNotIn("password",str(logs))
        self.client.force_login(self.user)
        self.assertEqual(self.client.get("/api/admin/activity/").status_code,403)

    def test_dashboard_selected_dates_boundaries_cancelled_and_overdue(self):
        stay=self.stay(status="pending",offset=0)
        self.client.force_login(self.staff)
        url="/api/admin/dashboard/"
        data=self.client.get(url).data
        self.assertEqual((data["available_rooms"],data["reserved_rooms"]),(0,1))
        future=self.today+timedelta(days=3)
        self.assertEqual(self.client.get(url,{"date":future}).data["available_rooms"],1)
        Booking.objects.filter(pk=stay.pk).update(status="cancelled")
        self.assertEqual(self.client.get(url).data["available_rooms"],1)
        Booking.objects.filter(pk=stay.pk).update(status="checked_in")
        with patch("api.management_views.timezone.localdate",return_value=future):
            self.assertEqual(self.client.get(url).data["available_rooms"],0)
        Booking.objects.filter(pk=stay.pk).update(status="checked_out")
        self.assertEqual(self.client.get(url,{"date":future}).data["available_rooms"],1)
        for status in ("maintenance","out_of_service"):
            Room.objects.filter(pk=self.room.pk).update(status=status)
            data=self.client.get(url).data
            self.assertEqual(data["available_rooms"],0);self.assertEqual(data["out_of_service_rooms"],1)

    def test_hotel_date_almaty_midnight(self):
        with patch("django.utils.timezone.now",return_value=datetime(2026,11,25,20,0,tzinfo=dt_timezone.utc)):
            self.assertEqual(str(self.client.get("/api/hotel-date/").data["date"]),"2026-11-26")


    def test_payment_replay_is_idempotent_for_cash_and_staff_partial_receipts(self):
        stay=self.stay(status="pending",offset=2)
        url=f"/api/bookings/{stay.pk}/pay/"
        for _ in range(2):
            response=self.client.post(url,{"method":"cash"},format="json",HTTP_IDEMPOTENCY_KEY="cash-attempt-123")
            self.assertEqual(response.status_code,201,response.data)
        self.assertEqual(stay.payments.count(),1)
        self.client.force_login(self.staff)
        url=f"/api/admin/reservations/{stay.pk}/payments/"
        for _ in range(2):
            response=self.client.post(url,{"method":"cash","amount":"5000","note":""},HTTP_IDEMPOTENCY_KEY="staff-attempt-123")
            self.assertEqual(response.status_code,201,response.data)
        self.assertEqual(stay.payments.filter(status="paid").count(),1)

    def test_failed_payment_is_saved_once_and_emits_notifications(self):
        from .test_payments import card
        stay=self.stay(status="pending",offset=2)
        url=f"/api/bookings/{stay.pk}/pay/"
        data=card() | {"card_number":"4000000000000002"}
        for _ in range(2):
            result=self.client.post(url,data,format="json",HTTP_IDEMPOTENCY_KEY="decline-attempt-123")
            self.assertEqual(result.status_code,402,result.data)
        self.assertEqual(stay.payments.filter(status="failed").count(),1)
        self.assertEqual(Notification.objects.filter(recipient=self.user,kind="payment.failed").count(),1)

    def test_completed_stay_emits_review_notification_once_and_admin_refund_is_audited(self):
        stay=self.stay(status="checked_in",offset=-2)
        self.client.force_login(self.staff)
        url=f"/api/admin/front-desk/{stay.pk}/check-out/"
        self.assertEqual(self.client.post(url).status_code,200)
        self.assertEqual(self.client.post(url).status_code,409)
        self.assertEqual(Notification.objects.filter(recipient=self.user,kind="review.available").count(),1)
        self.assertEqual(AuditLog.objects.filter(action="booking.checked_out").count(),1)

    def test_staff_cancellation_updates_payment_history_and_notifications(self):
        stay=self.stay(status="confirmed",offset=2)
        payment=Payment.objects.create(booking=stay,amount=10000,status="paid",method="cash",payment_method="Cash")
        self.client.force_login(self.staff)
        result=self.client.post(f"/api/admin/reservations/{stay.pk}/status/",{"status":"cancelled"})
        self.assertEqual(result.status_code,200)
        payment.refresh_from_db()
        self.assertEqual(payment.status,"refunded")
        self.assertTrue(AuditLog.objects.filter(action="payment.refunded").exists())
        self.assertTrue(Notification.objects.filter(recipient=self.user,kind="payment.refunded").exists())

    def test_review_unique_constraint_and_hidden_ratings(self):
        stay=self.stay()
        review=Review.objects.create(booking=stay,user=self.user,room=self.room,rating=5)
        with self.assertRaises(IntegrityError),transaction.atomic():
            Review.objects.create(booking=stay,user=self.user,room=self.room,rating=3)
        self.client.force_login(self.staff)
        self.client.post(f"/api/admin/reviews/{review.pk}/visibility/",{"hidden":True})
        public=self.client.get(f"/api/rooms/{self.room.pk}/reviews/").data
        self.assertEqual(public["count"],0)
        self.assertTrue(AuditLog.objects.filter(action="review.hidden").exists())
        self.client.post(f"/api/admin/reviews/{review.pk}/visibility/",{"hidden":False})
        self.assertEqual(self.client.get(f"/api/rooms/{self.room.pk}/reviews/").data["count"],1)
        self.client.delete(f"/api/admin/reviews/{review.pk}/")
        self.assertTrue(AuditLog.objects.filter(action="review.deleted",entity_id=str(review.pk)).exists())

    def test_password_change_expires_other_sessions(self):
        other_session=APIClient();other_session.force_login(self.user)
        result=self.client.post("/api/account/password/",{
            "current_password":"Strong-test-oak-47!","new_password":"Different-tree-house-47!",
            "confirmation":"Different-tree-house-47!",
        })
        self.assertEqual(result.status_code,200)
        self.assertEqual(self.client.get("/api/auth/me/").status_code,200)
        self.assertEqual(other_session.get("/api/auth/me/").status_code,403)

    def test_new_account_writes_are_csrf_protected(self):
        client=APIClient(enforce_csrf_checks=True);client.force_login(self.user)
        for path in ("profile/","password/","favorites/"+str(self.room.pk)+"/","notifications/read-all/"):
            response=client.post("/api/account/"+path,{},format="json")
            self.assertEqual(response.status_code,403)
