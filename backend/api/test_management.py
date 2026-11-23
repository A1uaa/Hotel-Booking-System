from datetime import timedelta
from io import BytesIO
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import TestCase, override_settings
from django.utils import timezone
from PIL import Image
from rest_framework.test import APIClient

from hotel.models import Booking, Payment, Room, RoomImage, RoomType

User = get_user_model()
BASE = "/api/admin/"
PASSWORD = "A-local-hotel-test-47!"


class HotelManagementTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.staff = User.objects.create_superuser("manager", "manager@example.test", PASSWORD)
        cls.guest = User.objects.create_user(
            "guest", "guest@example.test", PASSWORD, first_name="Aida", last_name="Omar",
        )
        cls.room_type = RoomType.objects.create(name="Standard Room", description="Courtyard room")
        cls.room = Room.objects.create(
            room_number="101", room_type=cls.room_type, description="Twin room", price_per_night=24000, capacity=2,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_login(self.staff)
        self.today = timezone.localdate()

    def booking(self, room=None, start=0, end=2, status=Booking.Status.PENDING):
        return Booking.objects.create(
            user=self.guest, room=room or self.room,
            check_in=self.today + timedelta(days=start), check_out=self.today + timedelta(days=end),
            guest_count=2, price_per_night=24000, total_price=(end - start) * 24000, status=status,
        )

    def test_anonymous_and_guest_cannot_read_or_modify_admin_resources(self):
        client = APIClient()
        urls = ("me/", "dashboard/", "rooms/", "room-types/", "reservations/", "guests/", "front-desk/", "reports/")
        for user in (None, self.guest):
            if user:
                client.force_login(user)
            for url in urls:
                with self.subTest(user=user, url=url):
                    self.assertEqual(client.get(BASE + url).status_code, 403)
            self.assertEqual(client.post(BASE + "rooms/", {}, format="json").status_code, 403)
            self.assertEqual(client.delete(f"{BASE}rooms/{self.room.pk}/").status_code, 403)
        self.assertTrue(Room.objects.filter(pk=self.room.pk).exists())

    def test_staff_login_and_admin_writes_require_csrf(self):
        client = APIClient(enforce_csrf_checks=True)
        self.assertEqual(client.post(BASE + "login/").status_code, 403)
        token = client.get("/api/auth/csrf/").data["csrf_token"]
        denied = client.post(BASE + "login/", {"email": self.guest.email, "password": PASSWORD},
                             format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(denied.status_code, 403)
        self.assertEqual(client.get("/api/auth/me/").status_code, 403)
        login = client.post(BASE + "login/", {"email": self.staff.email, "password": PASSWORD},
                            format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(login.status_code, 200)
        self.assertTrue(login.data["capabilities"]["dashboard"])
        self.assertEqual(client.get(BASE + "me/").status_code, 200)
        url = f"{BASE}rooms/{self.room.pk}/"
        self.assertEqual(client.patch(url, {"capacity": 3}, format="json").status_code, 403)
        self.assertEqual(client.delete(url, HTTP_X_CSRFTOKEN=token).status_code, 403)
        token = client.get("/api/auth/csrf/").data["csrf_token"]
        self.assertEqual(client.patch(url, {"capacity": 3}, format="json", HTTP_X_CSRFTOKEN=token).status_code, 200)

    def test_staff_flag_and_endpoint_permissions_are_both_required(self):
        account = User.objects.create_user("limited", email="limited@example.test", is_staff=True)
        client = APIClient()
        client.force_login(account)
        self.assertEqual(client.get(BASE + "me/").status_code, 403)
        account.user_permissions.add(Permission.objects.get(content_type__app_label="hotel", codename="view_booking"))
        self.assertEqual(client.get(BASE + "me/").status_code, 200)
        self.assertEqual(client.get(BASE + "reservations/").status_code, 200)
        self.assertEqual(client.get(BASE + "guests/").status_code, 403)
        self.assertEqual(client.get(BASE + "dashboard/").status_code, 403)
        row = self.booking()
        self.assertEqual(client.post(f"{BASE}reservations/{row.pk}/status/", {"status": "confirmed"}).status_code, 403)
        account.is_staff = False
        account.save(update_fields=["is_staff"])
        self.assertEqual(client.get(BASE + "reservations/").status_code, 403)

    def test_room_crud_validation_and_customer_catalog(self):
        data = {"room_number": "102", "room_type": self.room_type.pk, "description": "Queen room",
                "price_per_night": "31500.00", "capacity": 2, "status": "available"}
        self.assertEqual(self.client.post(BASE + "rooms/", data | {"price_per_night": "-1"}, format="json").status_code, 400)
        response = self.client.post(BASE + "rooms/", data, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        pk = response.data["id"]
        self.assertFalse(response.data["has_history"])
        self.assertEqual(self.client.post(BASE + "rooms/", data, format="json").status_code, 400)
        self.assertEqual(len(self.client.get(BASE + "rooms/").data), 2)
        url = f"{BASE}rooms/{pk}/"
        self.assertEqual(self.client.get(url).data["room_number"], "102")
        update = self.client.patch(url, {"status": "maintenance", "price_per_night": "33000.00"}, format="json")
        self.assertEqual(update.data["price_per_night"], "33000.00")
        self.assertNotIn(pk, [room["id"] for room in self.client.get("/api/rooms/").data])
        self.assertEqual(self.client.delete(url).status_code, 204)
        self.assertFalse(Room.objects.filter(pk=pk).exists())

    def test_room_with_cancelled_history_must_be_deactivated(self):
        row = self.booking(status=Booking.Status.CANCELLED)
        url = f"{BASE}rooms/{self.room.pk}/"
        self.assertTrue(self.client.get(url).data["has_history"])
        self.assertEqual(self.client.delete(url).status_code, 409)
        self.assertEqual(self.client.patch(url, {"status": "out_of_service"}, format="json").status_code, 200)
        row.refresh_from_db()
        self.assertEqual(row.room_id, self.room.pk)
        self.assertEqual(row.status, Booking.Status.CANCELLED)

    def test_upload_set_primary_and_delete_photo(self):
        with TemporaryDirectory() as folder, override_settings(MEDIA_ROOT=folder):
            url = f"{BASE}rooms/{self.room.pk}/photos/"
            self.assertEqual(self.client.post(url, {"image": SimpleUploadedFile("bad.png", b"invalid")}).status_code, 400)
            stream = BytesIO()
            Image.new("RGB", (12, 12), "green").save(stream, format="PNG")
            ids = []
            for _ in range(2):
                response = self.client.post(url, {"image": SimpleUploadedFile("room.png", stream.getvalue())})
                self.assertEqual(response.status_code, 201, response.data)
                ids.append(response.data["id"])
                self.assertEqual(self.client.patch(url + str(ids[-1]) + "/", {"is_primary": True}, format="json").status_code, 200)
            self.assertEqual(RoomImage.objects.get(is_primary=True).pk, ids[-1])
            photo = RoomImage.objects.get(pk=ids[-1])
            storage, name = photo.image.storage, photo.image.name
            self.assertTrue(storage.exists(name))
            with self.captureOnCommitCallbacks(execute=True):
                self.assertEqual(self.client.delete(url + str(ids[-1]) + "/").status_code, 204)
            self.assertFalse(storage.exists(name))

    def test_status_transition_and_cancel_preserve_snapshot(self):
        row = self.booking()
        url = f"{BASE}reservations/{row.pk}/status/"
        self.assertEqual(self.client.post(url, {"status": "checked_in"}).status_code, 409)
        self.assertEqual(self.client.post(url, {"status": "confirmed"}).status_code, 200)
        self.assertEqual(self.client.post(url, {"status": "cancelled"}).status_code, 200)
        self.assertEqual(self.client.post(url, {"status": "confirmed"}).status_code, 409)
        row.refresh_from_db()
        self.assertEqual(row.status, Booking.Status.CANCELLED)
        self.assertEqual(row.total_price, 48000)

    def test_front_desk_validates_state_dates_and_duplicates(self):
        row = self.booking(status=Booking.Status.CONFIRMED)
        desk = f"{BASE}front-desk/{row.pk}/"
        self.assertEqual(self.client.get(BASE + "front-desk/").data["arrivals"][0]["id"], row.pk)
        with patch("api.management_views.timezone.localdate", return_value=self.today - timedelta(days=1)):
            self.assertEqual(self.client.post(desk + "check-in/").status_code, 409)
        self.assertEqual(self.client.post(desk + "check-in/").data["status"], "checked_in")
        self.assertEqual(self.client.post(desk + "check-in/").status_code, 409)
        self.assertEqual(self.client.post(desk + "check-out/").status_code, 409)
        with patch("api.management_views.timezone.localdate", return_value=row.check_out):
            self.assertEqual(self.client.get(BASE + "front-desk/").data["departures"][0]["id"], row.pk)
            self.assertEqual(self.client.post(desk + "check-out/").data["status"], "checked_out")
            self.assertEqual(self.client.post(desk + "check-out/").status_code, 409)

    def test_guest_and_reservation_search_preserve_private_auth_fields(self):
        row = self.booking()
        matches = self.client.get(BASE + "guests/", {"q": "aida omar"}).data
        self.assertEqual([item["id"] for item in matches], [self.guest.pk])
        record = self.client.get(f"{BASE}guests/{self.guest.pk}/").data
        self.assertEqual(set(record["guest"]), {"id", "name", "email", "date_joined"})
        self.assertEqual(record["bookings"][0]["id"], row.pk)
        for query in ("Aida Omar", self.guest.email, self.room.room_number, f"#{row.pk}"):
            result = self.client.get(BASE + "reservations/", {"q": query, "status": "pending", "date": self.today})
            self.assertEqual([item["id"] for item in result.data], [row.pk])

    def test_real_statistics_and_paid_completed_revenue_without_double_counting(self):
        self.booking(start=-4, end=-2, status=Booking.Status.CHECKED_OUT)
        paid = self.booking(start=-2, end=0, status=Booking.Status.CHECKED_OUT)
        Payment.objects.create(booking=paid, amount=23000, status=Payment.Status.PAID, payment_method="cash")
        self.booking(start=0, end=2, status=Booking.Status.CHECKED_IN)
        Room.objects.create(room_number="102", room_type=self.room_type, price_per_night=22000, capacity=2)
        metrics = self.client.get(BASE + "dashboard/").data
        self.assertEqual(metrics["date"], self.today)
        self.assertEqual([metrics[key] for key in (
            "total_rooms", "available_rooms", "occupied_rooms", "arrivals", "departures", "active_reservations",
        )], [2, 1, 1, 1, 1, 1])
        self.assertEqual(metrics["revenue"], "71000.00")
        report = self.client.get(BASE + "reports/", {"start": self.today - timedelta(days=2), "end": self.today}).data
        self.assertEqual(report["bookings"], 2)
        self.assertEqual(report["occupied_nights"], 3)
        self.assertEqual(report["capacity_nights"], 6)
        self.assertEqual(report["occupancy_percent"], 50)
        self.assertEqual(report["revenue"], "71000.00")
        self.assertEqual(report["popular_room_types"], [{"name": "Standard Room", "bookings": 2}])
        self.assertEqual(self.client.get(BASE + "reports/", {"start": self.today, "end": "2000-01-01"}).status_code, 400)
