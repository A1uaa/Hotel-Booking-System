from datetime import timedelta

from django.contrib.auth import get_user_model
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from hotel.models import Booking, Room

from .tests import PASSWORD, inventory

User = get_user_model()


def day(offset):
    return timezone.localdate() + timedelta(days=offset)


class RoomAvailabilityTests(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.room = inventory()
        self.guest = User.objects.create_user(username="guest", email="guest@example.com", password=PASSWORD)
        self.url = f"/api/rooms/{self.room.pk}/availability/"

    def book(self, start, end, status=Booking.Status.CONFIRMED, room=None):
        room = room or self.room
        # Created directly so past stays can be stored; the database trigger still guards overlaps.
        return Booking.objects.create(
            user=self.guest, room=room, check_in=day(start), check_out=day(end), guest_count=1,
            price_per_night=room.price_per_night, total_price=room.price_per_night * (end - start), status=status,
        )

    def test_lists_upcoming_stays_in_order_without_guest_details(self):
        self.book(10, 12)
        self.book(3, 5, status=Booking.Status.PENDING)
        response = self.client.get(self.url)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["room"], self.room.pk)
        self.assertTrue(response.data["bookable"])
        self.assertEqual(
            [dict(item) for item in response.data["booked"]],
            [{"check_in": day(3), "check_out": day(5)}, {"check_in": day(10), "check_out": day(12)}],
        )
        self.assertNotIn(self.guest.email, response.content.decode())

    def test_leaves_out_cancelled_finished_and_other_rooms(self):
        other = Room.objects.create(
            room_type=self.room.room_type, room_number="102", description="Other", price_per_night=30000, capacity=2,
        )
        self.book(4, 6, status=Booking.Status.CANCELLED)
        self.book(-5, -2, status=Booking.Status.CHECKED_OUT)
        self.book(4, 6, room=other)
        self.assertEqual(self.client.get(self.url).data["booked"], [])

    def test_keeps_a_stay_that_is_in_progress(self):
        self.book(-1, 2, status=Booking.Status.CHECKED_IN)
        booked = self.client.get(self.url).data["booked"]
        self.assertEqual([dict(item) for item in booked], [{"check_in": day(-1), "check_out": day(2)}])

    def test_check_out_day_is_free_for_the_next_guest(self):
        self.book(2, 4)
        free = self.client.get(f"/api/rooms/{self.room.pk}/", {"check_in": day(4), "check_out": day(5)})
        busy = self.client.get(f"/api/rooms/{self.room.pk}/", {"check_in": day(3), "check_out": day(5)})
        self.assertTrue(free.data["available"])
        self.assertFalse(busy.data["available"])

    def test_room_out_of_service_is_not_bookable(self):
        self.room.status = Room.Status.MAINTENANCE
        self.room.save()
        self.assertFalse(self.client.get(self.url).data["bookable"])

    def test_unknown_room_returns_404(self):
        self.assertEqual(self.client.get("/api/rooms/99999/availability/").status_code, 404)

    def test_post_is_not_allowed(self):
        self.assertEqual(self.client.post(self.url, {}, format="json").status_code, 405)
