from datetime import timedelta
from decimal import Decimal

from django.contrib.auth import get_user_model
from django.core.exceptions import ValidationError
from django.db import IntegrityError, transaction
from django.db.models import ProtectedError
from django.test import TestCase
from django.utils import timezone

from .models import Booking, Payment, Room, RoomImage, RoomType


class HotelModelTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.user = get_user_model().objects.create_user(username="guest")
        cls.room_type = RoomType.objects.create(name="Standard Room")
        cls.room = Room.objects.create(
            room_number="101", room_type=cls.room_type, description="Twin room",
            price_per_night=Decimal("28000.00"), capacity=2,
        )

    def booking(self, **overrides):
        today = timezone.localdate()
        values = {
            "user": self.user,
            "room": self.room,
            "check_in": today,
            "check_out": today + timedelta(days=2),
            "guest_count": 2,
            "price_per_night": Decimal("28000.00"),
            "total_price": Decimal("56000.00"),
        }
        return Booking(**(values | overrides))

    def test_room_number_is_unique(self):
        with self.assertRaises(IntegrityError), transaction.atomic():
            Room.objects.create(
                room_number=self.room.room_number, room_type=self.room_type,
                price_per_night=Decimal("10000.00"), capacity=1,
            )

    def test_valid_booking_dates(self):
        booking = self.booking()
        booking.full_clean()
        booking.save()
        self.assertEqual(Booking.objects.get(pk=booking.pk).status, Booking.Status.PENDING)

    def test_checkout_must_follow_checkin(self):
        today = timezone.localdate()
        for checkout in (today, today - timedelta(days=1)):
            with self.subTest(checkout=checkout), self.assertRaises(ValidationError):
                self.booking(check_out=checkout).full_clean()

    def test_new_booking_rejects_past_checkin(self):
        booking = self.booking(check_in=timezone.localdate() - timedelta(days=1))
        with self.assertRaises(ValidationError) as error:
            booking.full_clean()
        self.assertIn("check_in", error.exception.message_dict)

    def test_existing_booking_can_be_updated_after_checkin(self):
        booking = self.booking(check_in=timezone.localdate() - timedelta(days=1))
        # Represents a reservation made before its check-in date.
        booking.save()
        booking.status = Booking.Status.CHECKED_IN
        booking.full_clean()

    def test_booking_rejects_excess_guests(self):
        with self.assertRaises(ValidationError) as error:
            self.booking(guest_count=3).full_clean()
        self.assertIn("guest_count", error.exception.message_dict)

    def test_negative_prices_are_rejected(self):
        booking = self.booking(price_per_night=Decimal("-1"), total_price=Decimal("-1"))
        with self.assertRaises(ValidationError) as error:
            booking.full_clean()
        self.assertIn("price_per_night", error.exception.message_dict)
        self.assertIn("total_price", error.exception.message_dict)
        with self.assertRaises(IntegrityError), transaction.atomic():
            booking.save()
        with self.assertRaises(IntegrityError), transaction.atomic():
            Room.objects.filter(pk=self.room.pk).update(price_per_night=Decimal("-1"))

    def test_foreign_key_relationships(self):
        booking = self.booking()
        booking.save()
        payment = Payment.objects.create(booking=booking, amount=booking.total_price, payment_method="cash")
        image = RoomImage.objects.create(room=self.room, image="rooms/front.jpg", is_primary=True)
        self.assertEqual(self.room_type.rooms.get(), self.room)
        self.assertEqual(self.room.images.get(), image)
        self.assertEqual(self.room.bookings.get(), booking)
        self.assertEqual(self.user.bookings.get(), booking)
        self.assertEqual(booking.payments.get(), payment)
        with self.assertRaises(ProtectedError):
            self.room.delete()
