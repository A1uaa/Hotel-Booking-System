from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Barrier

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group
from django.db import IntegrityError, connections, transaction
from django.test import TestCase, TransactionTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from hotel.models import Booking, ContactMessage, Room, RoomType

User = get_user_model()
PASSWORD = "Iris-walks-at-midnight-27"


def inventory():
    standard = RoomType.objects.create(name="Standard", amenities=["Wi-Fi"])
    return Room.objects.create(
        room_type=standard, room_number="101", description="Courtyard room",
        price_per_night=28000, capacity=2,
    )


def stay(room, start=0, end=2, guests=2):
    today = timezone.localdate()
    return {
        "room": room.pk, "guest_count": guests,
        "check_in": (today + timedelta(days=start)).isoformat(),
        "check_out": (today + timedelta(days=end)).isoformat(),
    }


class AuthTests(TestCase):
    def setUp(self):
        self.client = APIClient(enforce_csrf_checks=True)
        self.credentials = {"email": "Guest@example.com", "password": PASSWORD}

    def csrf(self):
        response = self.client.get("/api/auth/csrf/", HTTP_ORIGIN="http://localhost:4200")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Access-Control-Allow-Credentials"], "true")
        self.assertIn("csrftoken", response.cookies)
        return response.data["csrf_token"]

    def test_registration_login_and_logout(self):
        token = self.csrf()
        response = self.client.post(
            "/api/auth/register/", self.credentials | {"role": "Admin"},
            format="json", HTTP_X_CSRFTOKEN=token, HTTP_ORIGIN="http://localhost:4200",
        )
        self.assertEqual(response.status_code, 201, response.data)
        user = User.objects.get(pk=response.data["id"])
        self.assertEqual(response.data["role"], "Guest")
        self.assertTrue(user.groups.filter(name="Guest").exists())
        self.assertFalse(user.is_staff)
        self.assertTrue(user.check_password(PASSWORD))
        self.assertNotEqual(user.password, PASSWORD)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 403)
        response = self.client.post(
            "/api/auth/login/", self.credentials | {"email": "GUEST@EXAMPLE.COM"},
            format="json", HTTP_X_CSRFTOKEN=token,
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertTrue(response.cookies["sessionid"]["httponly"])
        self.assertEqual(self.client.get("/api/auth/me/").data["id"], user.pk)
        self.assertEqual(self.client.get("/admin/hotel/room/").status_code, 302)
        self.assertEqual(self.client.post("/api/auth/logout/", HTTP_X_CSRFTOKEN=token).status_code, 403)
        self.assertEqual(self.client.post("/api/auth/logout/", HTTP_X_CSRFTOKEN=self.csrf()).status_code, 204)
        self.assertEqual(self.client.get("/api/auth/me/").status_code, 403)

    def test_duplicate_email_including_existing_mixed_case_email(self):
        User.objects.create_user(username="existing", email="GuEsT@EXAMPLE.COM")
        response = self.client.post("/api/auth/register/", self.credentials, format="json", HTTP_X_CSRFTOKEN=self.csrf())
        self.assertEqual(response.status_code, 409)
        self.assertEqual(User.objects.count(), 1)

    def test_invalid_credentials_and_registration_fields(self):
        token = self.csrf()
        for fields in ({"email": "invalid"}, {"password": "password"}):
            response = self.client.post(
                "/api/auth/register/", self.credentials | fields, format="json", HTTP_X_CSRFTOKEN=token,
            )
            self.assertEqual(response.status_code, 400)
        response = self.client.post("/api/auth/login/", self.credentials, format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.data["detail"], "Invalid email or password.")

    def test_admin_role_and_admin_access(self):
        user = User.objects.create_superuser("admin", "admin@example.com", PASSWORD)
        self.client.force_login(user)
        self.assertEqual(self.client.get("/api/auth/me/").data["role"], "Admin")
        self.assertEqual(self.client.get("/admin/hotel/room/").status_code, 200)
        group = Group.objects.create(name="Admin")
        user = User.objects.create_user("staff", is_staff=True)
        user.groups.add(group)
        self.client.force_login(user)
        self.assertEqual(self.client.get("/api/auth/me/").data["role"], "Admin")

    def test_csrf_for_anonymous_and_signed_in_writes(self):
        for endpoint in ("auth/login/", "auth/register/", "contact/"):
            response = self.client.post(f"/api/{endpoint}", {}, format="json")
            self.assertEqual(response.status_code, 403)
            self.assertIn("CSRF", response.data["detail"])
        self.client.force_login(User.objects.create_user("guest"))
        for endpoint in ("bookings/", "bookings/1/cancel/", "auth/logout/"):
            response = self.client.post(f"/api/{endpoint}", {}, format="json")
            self.assertEqual(response.status_code, 403)
            self.assertIn("CSRF", response.data["detail"])
        response = self.client.post(
            "/api/contact/", {}, format="json", HTTP_X_CSRFTOKEN=self.csrf(),
            HTTP_ORIGIN="http://untrusted.example",
        )
        self.assertEqual(response.status_code, 403)

    def test_contact_validation_and_persistence(self):
        token = self.csrf()
        data = {"name": "Aida", "email": "aida@example.com", "subject": "Parking", "message": "Is parking available?"}
        response = self.client.post("/api/contact/", data | {"email": "bad"}, format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 400)
        response = self.client.post("/api/contact/", data, format="json", HTTP_X_CSRFTOKEN=token)
        self.assertEqual(response.status_code, 201)
        self.assertEqual(ContactMessage.objects.get(pk=response.data["id"]).subject, "Parking")


class BookingTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.room = inventory()
        cls.user = User.objects.create_user("owner")
        cls.other = User.objects.create_user("other")

    def setUp(self):
        self.client = APIClient()
        self.client.force_login(self.user)

    def book(self, **fields):
        return self.client.post("/api/bookings/", stay(self.room) | fields, format="json")

    def test_room_listing_filters_and_detail_availability(self):
        extra = RoomType.objects.create(name="Suite")
        for number, price, capacity, room_type, status in (
            ("102", 27000, 1, self.room.room_type, Room.Status.AVAILABLE),
            ("103", 28000, 2, extra, Room.Status.AVAILABLE),
            ("104", 28000, 2, self.room.room_type, Room.Status.MAINTENANCE),
            ("105", 40000, 3, self.room.room_type, Room.Status.AVAILABLE),
            ("106", 28000, 2, self.room.room_type, Room.Status.OUT_OF_SERVICE),
        ):
            Room.objects.create(room_number=number, price_per_night=price, capacity=capacity, room_type=room_type, status=status)
        response = self.client.get("/api/rooms/", {
            "guests": 2, "room_type": self.room.room_type_id, "min_price": 27500, "max_price": 30000,
        })
        self.assertEqual([room["id"] for room in response.data], [self.room.pk])
        self.assertEqual(response.data[0]["amenities"], ["Wi-Fi"])
        dates = stay(self.room)
        self.assertEqual(self.book().status_code, 201)
        response = self.client.get("/api/rooms/", dates)
        self.assertNotIn(self.room.pk, [room["id"] for room in response.data])
        self.assertFalse(self.client.get(f"/api/rooms/{self.room.pk}/", dates).data["available"])
        self.assertEqual(self.client.get("/api/rooms/", {"check_in": dates["check_in"]}).status_code, 400)

    def test_create_snapshots_server_price(self):
        response = self.book(price_per_night="1.00", total_price="1.00", status="confirmed", user=self.other.pk)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["price_per_night"], "28000.00")
        self.assertEqual(response.data["total_price"], "56000.00")
        self.assertEqual(response.data["status"], "pending")
        self.assertEqual(Booking.objects.get().user, self.user)

    def test_overlap_and_adjacency(self):
        self.assertEqual(self.book().status_code, 201)
        self.assertEqual(self.book(**stay(self.room, 1, 3)).status_code, 409)
        self.assertEqual(self.book(**stay(self.room, 2, 4)).status_code, 201)

    def test_invalid_dates_capacity_and_room_status(self):
        for fields in (stay(self.room, -1, 1), stay(self.room, 1, 1), stay(self.room, 2, 1), {"guest_count": 3}):
            with self.subTest(fields=fields):
                self.assertEqual(self.book(**fields).status_code, 400)
        Room.objects.filter(pk=self.room.pk).update(status=Room.Status.MAINTENANCE)
        self.assertEqual(self.book().status_code, 409)
        self.assertFalse(Booking.objects.exists())

    def test_anonymous_and_other_users_cannot_access_bookings(self):
        self.assertEqual(self.book().status_code, 201)
        booking = Booking.objects.get()
        url = f"/api/bookings/{booking.pk}/"
        self.assertEqual(self.client.get(url).status_code, 200)
        self.client.force_login(self.other)
        self.assertEqual(self.client.get("/api/bookings/").data, [])
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertEqual(self.client.post(url + "cancel/").status_code, 404)
        anonymous = APIClient()
        self.assertEqual(anonymous.get("/api/bookings/").status_code, 403)
        self.assertEqual(anonymous.post("/api/bookings/", stay(self.room), format="json").status_code, 403)

    def test_cancellation_is_repeatable_and_releases_room(self):
        booking_id = self.book().data["id"]
        url = f"/api/bookings/{booking_id}/cancel/"
        for _ in range(2):
            self.assertEqual(self.client.post(url).data["status"], "cancelled")
        self.assertEqual(self.book().status_code, 201)
        active = Booking.objects.exclude(pk=booking_id).get()
        Booking.objects.filter(pk=active.pk).update(status=Booking.Status.CHECKED_IN)
        self.assertEqual(self.client.post(f"/api/bookings/{active.pk}/cancel/").status_code, 409)

    def test_database_rejects_overlap_on_direct_insert_and_update(self):
        self.assertEqual(self.book().status_code, 201)
        original = Booking.objects.get()
        with self.assertRaisesMessage(IntegrityError, "Overlapping hotel booking"), transaction.atomic():
            Booking.objects.create(
                room=self.room, user=self.other, check_in=original.check_in, check_out=original.check_out,
                guest_count=1, price_per_night=28000, total_price=56000,
            )
        self.assertEqual(self.book(**stay(self.room, 2, 4)).status_code, 201)
        with self.assertRaisesMessage(IntegrityError, "Overlapping hotel booking"), transaction.atomic():
            Booking.objects.exclude(pk=original.pk).update(check_in=original.check_in)


class ConcurrentBookingTests(TransactionTestCase):
    def test_competing_http_requests_cannot_double_book(self):
        room = inventory()
        users = [User.objects.create_user(name) for name in ("first", "second")]
        clients = [APIClient() for _ in users]
        for client, user in zip(clients, users):
            client.force_login(user)
        data = stay(room)
        gate = Barrier(2)

        def book(client):
            try:
                gate.wait(timeout=10)
                return client.post("/api/bookings/", data, format="json").status_code
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(book, clients))
        self.assertEqual(results.count(201), 1, results)
        self.assertEqual(Booking.objects.filter(room=room).count(), 1)
        loser = 1 - results.index(201)
        # Shared in-memory SQLite can return SQLITE_LOCKED immediately.
        if results[loser] == 503:
            self.assertEqual(clients[loser].post("/api/bookings/", data, format="json").status_code, 409)
        else:
            self.assertEqual(results[loser], 409)
