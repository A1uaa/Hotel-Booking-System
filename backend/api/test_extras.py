from decimal import Decimal

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from hotel.models import Booking, BookingExtra, Extra, ExtraPrice, Room, RoomType

from .test_payments import card
from .tests import inventory, stay

User = get_user_model()


class ExtrasTestCase(TestCase):
    """A Standard room (extras cost money) and a Suite (breakfast and parking are free bonuses)."""

    @classmethod
    def setUpTestData(cls):
        cls.standard_room = inventory()
        cls.suite = RoomType.objects.create(name="Suite", amenities=["Lounge"])
        cls.suite_room = Room.objects.create(
            room_type=cls.suite, room_number="301", description="Suite", price_per_night=60000, capacity=3,
        )
        cls.breakfast = Extra.objects.create(code="breakfast", name="Breakfast", unit=Extra.Unit.PER_GUEST_NIGHT)
        cls.parking = Extra.objects.create(code="parking", name="Parking", unit=Extra.Unit.PER_NIGHT)
        cls.transfer = Extra.objects.create(code="airport-transfer", name="Airport transfer", unit=Extra.Unit.PER_STAY)
        standard = cls.standard_room.room_type
        for extra, standard_price, suite_price, suite_included in (
            (cls.breakfast, 4500, 0, True), (cls.parking, 3000, 0, True), (cls.transfer, 12000, 8000, False),
        ):
            ExtraPrice.objects.create(extra=extra, room_type=standard, price=standard_price)
            ExtraPrice.objects.create(extra=extra, room_type=cls.suite, price=suite_price, included=suite_included)
        cls.guest = User.objects.create_user("guest", email="guest@example.com")

    def setUp(self):
        cache.clear()
        self.client = APIClient()
        self.client.force_login(self.guest)

    def book(self, room=None, extras=(), **kwargs):
        body = stay(room or self.standard_room, **kwargs) | {"extras": list(extras)}
        return self.client.post("/api/bookings/", body, format="json")


class RoomExtrasTests(ExtrasTestCase):
    def test_room_page_lists_extras_with_the_price_of_its_level(self):
        extras = {item["code"]: item for item in self.client.get(f"/api/rooms/{self.standard_room.pk}/").data["extras"]}
        self.assertEqual(set(extras), {"breakfast", "parking", "airport-transfer"})
        self.assertEqual((extras["breakfast"]["price"], extras["breakfast"]["included"]), ("4500.00", False))
        self.assertEqual(extras["breakfast"]["unit"], "per_guest_night")

    def test_top_rooms_get_free_bonuses_listed_first(self):
        extras = self.client.get(f"/api/rooms/{self.suite_room.pk}/").data["extras"]
        self.assertEqual([(item["code"], item["included"]) for item in extras],
                         [("breakfast", True), ("parking", True), ("airport-transfer", False)])
        self.assertEqual(extras[-1]["price"], "8000.00")

    def test_rooms_list_carries_extras_and_hides_inactive_ones(self):
        Extra.objects.filter(code="parking").update(is_active=False)
        rows = {row["id"]: row for row in self.client.get("/api/rooms/").data}
        codes = [item["code"] for item in rows[self.standard_room.pk]["extras"]]
        self.assertEqual(codes, ["breakfast", "airport-transfer"])

    def test_a_room_type_without_extras_has_an_empty_list(self):
        plain = Room.objects.create(
            room_type=RoomType.objects.create(name="Plain"), room_number="401", description="x",
            price_per_night=10000, capacity=1,
        )
        self.assertEqual(self.client.get(f"/api/rooms/{plain.pk}/").data["extras"], [])


class BookingWithExtrasTests(ExtrasTestCase):
    def test_booking_without_extras_costs_only_the_room(self):
        response = self.book()
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual((response.data["total_price"], response.data["extras"]), ("56000.00", []))

    def test_extras_are_priced_per_stay_per_night_and_per_guest_night(self):
        # 2 nights, 2 guests: room 56,000 + breakfast 4,500 x 2 x 2 + parking 3,000 x 2 + transfer 12,000.
        response = self.book(extras=["breakfast", "parking", "airport-transfer"])
        self.assertEqual(response.status_code, 201, response.data)
        amounts = {item["name"]: item["amount"] for item in response.data["extras"]}
        self.assertEqual(amounts, {"Breakfast": "18000.00", "Parking": "6000.00", "Airport transfer": "12000.00"})
        self.assertEqual(response.data["total_price"], "92000.00")
        self.assertFalse(any(item["included"] for item in response.data["extras"]))

    def test_the_number_of_guests_changes_only_the_per_guest_extras(self):
        response = self.book(extras=["breakfast", "parking"], guests=1)
        self.assertEqual(response.data["total_price"], str(Decimal("56000") + 9000 + 6000) + ".00")

    def test_top_rooms_include_free_extras_without_being_asked(self):
        response = self.book(room=self.suite_room)
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["total_price"], "120000.00")
        self.assertEqual({(item["name"], item["included"], item["amount"]) for item in response.data["extras"]},
                         {("Breakfast", True, "0.00"), ("Parking", True, "0.00")})

    def test_ticking_an_included_extra_is_free_and_not_doubled(self):
        response = self.book(room=self.suite_room, extras=["breakfast", "airport-transfer"])
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["total_price"], "128000.00")
        self.assertEqual(sorted(item["name"] for item in response.data["extras"]),
                         ["Airport transfer", "Breakfast", "Parking"])
        self.assertEqual(BookingExtra.objects.filter(booking_id=response.data["id"]).count(), 3)

    def test_unknown_inactive_or_foreign_extras_are_rejected(self):
        Extra.objects.filter(code="parking").update(is_active=False)
        ExtraPrice.objects.filter(extra=self.transfer, room_type=self.standard_room.room_type).delete()
        for codes in (["spa"], ["parking"], ["airport-transfer"], ["breakfast", "spa"]):
            response = self.book(extras=codes)
            self.assertEqual(response.status_code, 400, codes)
            self.assertIn("extras", response.data)
        self.assertEqual(Booking.objects.count(), 0)

    def test_extras_must_be_a_list_of_codes(self):
        for value in ("breakfast", [1.5], ["bad code"], ["x"] * 21):
            body = stay(self.standard_room) | {"extras": value}
            self.assertEqual(self.client.post("/api/bookings/", body, format="json").status_code, 400, value)

    def test_a_client_cannot_send_its_own_extra_price(self):
        body = stay(self.standard_room) | {"extras": [{"code": "breakfast", "price": "1"}]}
        self.assertEqual(self.client.post("/api/bookings/", body, format="json").status_code, 400)

    def test_later_price_changes_do_not_alter_an_existing_booking(self):
        booking_id = self.book(extras=["breakfast"]).data["id"]
        ExtraPrice.objects.filter(extra=self.breakfast).update(price=99999)
        self.breakfast.name = "Renamed"
        self.breakfast.save()
        data = self.client.get(f"/api/bookings/{booking_id}/").data
        self.assertEqual(data["total_price"], "74000.00")
        self.assertEqual([(item["name"], item["amount"]) for item in data["extras"]], [("Breakfast", "18000.00")])

    def test_deleting_an_extra_keeps_the_booking_line(self):
        booking_id = self.book(extras=["airport-transfer"]).data["id"]
        self.transfer.delete()
        data = self.client.get(f"/api/bookings/{booking_id}/").data
        self.assertEqual([item["name"] for item in data["extras"]], ["Airport transfer"])
        self.assertEqual(data["total_price"], "68000.00")

    def test_booking_list_shows_each_bookings_extras(self):
        self.book(extras=["breakfast"])
        self.book(room=self.suite_room, start=5, end=7)
        rows = self.client.get("/api/bookings/").data
        self.assertEqual(sorted(len(row["extras"]) for row in rows), [1, 2])

    def test_the_overlap_check_still_runs_with_extras(self):
        self.assertEqual(self.book(extras=["breakfast"]).status_code, 201)
        self.assertEqual(self.book(extras=["breakfast"]).status_code, 409)
        self.assertEqual(BookingExtra.objects.count(), 1)


class ExtrasAndPaymentTests(ExtrasTestCase):
    def test_card_payment_covers_the_extras_too(self):
        booking_id = self.book(extras=["breakfast", "parking"]).data["id"]
        response = self.client.post(f"/api/bookings/{booking_id}/pay/", {"method": "card"} | card(), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["payment"]["amount"], "80000.00")
        self.assertEqual(response.data["booking"]["balance_due"], "0.00")
        self.assertEqual(len(response.data["booking"]["extras"]), 2)

    def test_prepayment_is_a_share_of_the_total_with_extras(self):
        booking_id = self.book(extras=["breakfast", "parking"]).data["id"]
        response = self.client.post(f"/api/bookings/{booking_id}/pay/", {"method": "prepayment"} | card(), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["payment"]["amount"], "24000.00")


class StaffAndSeedTests(ExtrasTestCase):
    def test_staff_see_the_extras_of_a_reservation(self):
        booking_id = self.book(extras=["breakfast"]).data["id"]
        staff = User.objects.create_user("desk", email="desk@example.com", is_staff=True)
        staff.user_permissions.add(Permission.objects.get(codename="view_booking"))
        client = APIClient()
        client.force_login(staff)
        rows = client.get("/api/admin/reservations/").data
        row = next(item for item in rows if item["id"] == booking_id)
        self.assertEqual([item["name"] for item in row["extras"]], ["Breakfast"])

    def test_seeding_creates_tiered_extras_once_and_keeps_staff_changes(self):
        Extra.objects.all().delete()
        call_command("seed_hotel", verbosity=0)
        breakfast = Extra.objects.get(code="breakfast")
        prices = {price.room_type.name: (price.price, price.included) for price in breakfast.prices.all()}
        self.assertEqual(prices, {
            "Standard Room": (Decimal("4500.00"), False), "Deluxe Room": (Decimal("3500.00"), False),
            "Executive Suite": (Decimal("0.00"), True),
        })
        ExtraPrice.objects.filter(extra=breakfast, room_type__name="Standard Room").update(price=5000)
        call_command("seed_hotel", verbosity=0)
        self.assertEqual(ExtraPrice.objects.get(extra=breakfast, room_type__name="Standard Room").price, Decimal("5000.00"))
        self.assertEqual(Extra.objects.count(), 4)
