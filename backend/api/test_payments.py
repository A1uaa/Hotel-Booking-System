from datetime import timedelta
from decimal import Decimal
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Permission
from django.core.cache import cache
from django.db import IntegrityError, transaction
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from hotel.models import Booking, Payment

from .services import DECLINED_TEST_CARD
from .throttles import PaymentThrottle
from .tests import inventory, stay

User = get_user_model()
GOOD_CARD = "4242 4242 4242 4242"


def card(**fields):
    year = (timezone.localdate() + timedelta(days=730)).year % 100
    return {"card_holder": "Aida Test", "card_number": GOOD_CARD, "expiry": f"12/{year:02d}", "cvv": "123"} | fields


class PaymentTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.room = inventory()
        cls.user = User.objects.create_user("owner")
        cls.other = User.objects.create_user("other")

    def setUp(self):
        cache.clear()  # payment attempts are rate limited per user
        self.client = APIClient()
        self.client.force_login(self.user)
        self.booking_id = self.client.post("/api/bookings/", stay(self.room), format="json").data["id"]
        self.url = f"/api/bookings/{self.booking_id}/pay/"

    def test_successful_payment_confirms_booking_and_keeps_only_last_four(self):
        response = self.client.post(self.url, card(), format="json")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.data["booking"]["status"], "confirmed")
        payment = Payment.objects.get()
        self.assertEqual((payment.status, payment.amount), ("paid", Booking.objects.get().total_price))
        self.assertEqual(payment.payment_method, "Card ending 4242")
        self.assertNotIn("4242 4242", str(response.data))

    def test_declined_card_records_failure_and_keeps_booking_pending(self):
        response = self.client.post(self.url, card(card_number=DECLINED_TEST_CARD), format="json")
        self.assertEqual(response.status_code, 402)
        self.assertEqual(Payment.objects.get().status, "failed")
        self.assertEqual(Booking.objects.get().status, "pending")
        self.assertEqual(self.client.post(self.url, card(), format="json").status_code, 201)

    def test_invalid_card_details_are_rejected_without_a_payment_record(self):
        for bad in (
            {"card_number": "4242 4242 4242 4241"}, {"card_number": "abcd"},
            {"expiry": "13/30"}, {"expiry": "01/20"}, {"cvv": "12"},
        ):
            self.assertEqual(self.client.post(self.url, card(**bad), format="json").status_code, 400, bad)
        self.assertFalse(Payment.objects.exists())

    def test_paying_twice_is_a_conflict(self):
        self.assertEqual(self.client.post(self.url, card(), format="json").status_code, 201)
        self.assertEqual(self.client.post(self.url, card(), format="json").status_code, 409)
        self.assertEqual(Payment.objects.count(), 1)

    def test_only_the_owner_can_pay_or_list_payments(self):
        stranger = APIClient()
        self.assertEqual(stranger.post(self.url, card(), format="json").status_code, 403)
        stranger.force_login(self.other)
        self.assertEqual(stranger.post(self.url, card(), format="json").status_code, 404)
        self.assertEqual(stranger.get(f"/api/bookings/{self.booking_id}/payments/").status_code, 404)

    def test_cancelling_a_paid_booking_refunds_the_payment(self):
        self.client.post(self.url, card(), format="json")
        self.assertEqual(self.client.post(f"/api/bookings/{self.booking_id}/cancel/").status_code, 200)
        self.assertEqual(Payment.objects.get().status, "refunded")
        listed = self.client.get(f"/api/bookings/{self.booking_id}/payments/").data
        self.assertEqual([item["status"] for item in listed], ["refunded"])

    def test_payment_response_is_never_cached(self):
        self.assertEqual(self.client.post(self.url, card(), format="json")["Cache-Control"], "no-store")

    def test_card_details_must_be_sent_as_json(self):
        response = self.client.post(self.url, card(), format="multipart")
        self.assertEqual(response.status_code, 415)
        self.assertFalse(Payment.objects.exists())

    def test_payment_attempts_are_rate_limited(self):
        with patch.dict(PaymentThrottle.THROTTLE_RATES, {"payments": "2/min"}):
            codes = [self.client.post(self.url, card(card_number="4242 4242 4242 4241"), format="json").status_code
                     for _ in range(3)]
        self.assertEqual(codes, [400, 400, 429])

    def test_unknown_method_is_rejected(self):
        self.assertEqual(self.client.post(self.url, card(method="bitcoin"), format="json").status_code, 400)

    def test_cash_reserves_the_room_and_stays_pending_until_staff_receive_it(self):
        response = self.client.post(self.url, {"method": "cash"}, format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["booking"]["status"], "confirmed")
        self.assertEqual(response.data["booking"]["payment_status"], "pay_at_hotel")
        self.assertEqual(response.data["booking"]["balance_due"], "56000.00")
        payment = Payment.objects.get()
        self.assertEqual((payment.method, payment.status, payment.amount), ("cash", "pending", Decimal("56000")))
        self.assertEqual(self.client.post(self.url, {"method": "cash"}, format="json").status_code, 409)

    def test_cash_needs_no_card_details_and_never_stores_them(self):
        response = self.client.post(self.url, {"method": "cash", "cvv": "123", "card_holder": "x"}, format="json")
        self.assertEqual(response.status_code, 201)
        payment = Payment.objects.get()
        self.assertEqual((payment.payment_method, payment.note), ("Cash at hotel", ""))

    def test_card_method_requires_every_card_field(self):
        response = self.client.post(self.url, {"method": "card", "card_number": GOOD_CARD}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(set(response.data), {"card_holder", "expiry", "cvv"})

    def test_paying_by_card_replaces_a_pay_at_hotel_request(self):
        self.client.post(self.url, {"method": "cash"}, format="json")
        self.assertEqual(self.client.post(self.url, card(), format="json").status_code, 201)
        self.assertEqual(sorted(Payment.objects.values_list("status", flat=True)), ["cancelled", "paid"])
        self.assertEqual(self.client.get(f"/api/bookings/{self.booking_id}/").data["payment_status"], "paid")

    def test_prepayment_takes_thirty_percent_and_leaves_a_balance(self):
        response = self.client.post(self.url, card(method="prepayment"), format="json")
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(response.data["payment"]["amount"], "16800.00")
        self.assertEqual(response.data["payment"]["method"], "prepayment")
        self.assertEqual(response.data["booking"]["status"], "confirmed")
        self.assertEqual(response.data["booking"]["paid_amount"], "16800.00")
        self.assertEqual(response.data["booking"]["balance_due"], "39200.00")
        self.assertEqual(response.data["booking"]["payment_status"], "partial")
        # A second prepayment is refused, but the balance can be paid by card or arranged for the hotel.
        self.assertEqual(self.client.post(self.url, card(method="prepayment"), format="json").status_code, 409)
        rest = self.client.post(self.url, card(), format="json")
        self.assertEqual((rest.status_code, rest.data["payment"]["amount"]), (201, "39200.00"))
        self.assertEqual(rest.data["booking"]["payment_status"], "paid")
        self.assertEqual(self.client.post(self.url, card(), format="json").status_code, 409)

    def test_balance_after_prepayment_can_be_left_for_the_hotel(self):
        self.client.post(self.url, card(method="prepayment"), format="json")
        response = self.client.post(self.url, {"method": "cash"}, format="json")
        self.assertEqual((response.status_code, response.data["payment"]["amount"]), (201, "39200.00"))
        self.assertEqual(response.data["booking"]["payment_status"], "pay_at_hotel")

    def test_cancelling_refunds_paid_money_and_closes_pending_cash(self):
        self.client.post(self.url, card(method="prepayment"), format="json")
        self.client.post(self.url, {"method": "cash"}, format="json")
        cancelled = self.client.post(f"/api/bookings/{self.booking_id}/cancel/")
        self.assertEqual((cancelled.status_code, cancelled.data["payment_status"]), (200, "refunded"))
        self.assertEqual(sorted(Payment.objects.values_list("status", flat=True)), ["cancelled", "refunded"])
        self.assertEqual(self.client.post(self.url, card(), format="json").status_code, 409)

    def test_database_rejects_paid_amounts_above_the_booking_total(self):
        booking = Booking.objects.get()
        Payment.objects.create(booking=booking, amount=booking.total_price - 1, status="paid", payment_method="x")
        with self.assertRaises(IntegrityError), transaction.atomic():
            Payment.objects.create(booking=booking, amount=2, status="paid", payment_method="x")
        # Pending money does not count, but settling it later is still guarded.
        pending = Payment.objects.create(booking=booking, amount=2, status="pending", payment_method="x")
        pending.status = "paid"
        with self.assertRaises(IntegrityError), transaction.atomic():
            pending.save()


BASE = "/api/admin/"


class StaffPaymentTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.room = inventory()
        cls.guest = User.objects.create_user("owner", "owner@example.test", first_name="Aida", last_name="Omar")
        cls.staff = User.objects.create_superuser("manager", "manager@example.test", "A-local-hotel-test-47!")

    def setUp(self):
        cache.clear()
        self.guest_client = APIClient()
        self.guest_client.force_login(self.guest)
        self.booking_id = self.guest_client.post("/api/bookings/", stay(self.room), format="json").data["id"]
        self.client = APIClient()
        self.client.force_login(self.staff)

    def cash_payment(self):
        self.guest_client.post(f"/api/bookings/{self.booking_id}/pay/", {"method": "cash"}, format="json")
        return Payment.objects.get(status="pending")

    def test_guests_cannot_use_payment_management(self):
        for url in ("payments/", f"reservations/{self.booking_id}/payments/"):
            self.assertEqual(self.guest_client.get(BASE + url).status_code, 403)
        self.assertEqual(self.guest_client.post(
            f"{BASE}reservations/{self.booking_id}/payments/", {"method": "cash", "amount": "1"}, format="json").status_code, 403)

    def test_staff_without_payment_permissions_are_refused(self):
        clerk = User.objects.create_user("clerk", "clerk@example.test", is_staff=True)
        clerk.user_permissions.add(*Permission.objects.filter(codename__in=("view_booking", "view_payment")))
        client = APIClient()
        client.force_login(clerk)
        self.assertEqual(client.get(BASE + "payments/").status_code, 200)
        self.assertEqual(client.get(BASE + "me/").data["capabilities"]["recordPayment"], False)
        self.assertEqual(client.post(
            f"{BASE}reservations/{self.booking_id}/payments/", {"method": "cash", "amount": "1"}, format="json").status_code, 403)

    def test_list_filters_and_capabilities(self):
        payment = self.cash_payment()
        rows = self.client.get(BASE + "payments/", {"status": "pending", "method": "cash", "q": "owner@example.test"}).data
        self.assertEqual([row["id"] for row in rows], [payment.pk])
        self.assertEqual(rows[0]["guest"]["email"], "owner@example.test")
        self.assertEqual(self.client.get(BASE + "payments/", {"status": "paid"}).data, [])
        self.assertEqual(self.client.get(BASE + "payments/", {"status": "nonsense"}).status_code, 400)
        self.assertTrue(self.client.get(BASE + "me/").data["capabilities"]["changePayment"])

    def test_staff_mark_cash_received_and_refund(self):
        payment = self.cash_payment()
        url = f"{BASE}payments/{payment.pk}/status/"
        paid = self.client.post(url, {"status": "paid", "note": "Received at desk"}, format="json")
        self.assertEqual((paid.status_code, paid.data["status"]), (200, "paid"))
        self.assertEqual(paid.data["recorded_by_email"], "manager@example.test")
        self.assertIsNotNone(paid.data["paid_at"])
        booking = self.client.get(f"{BASE}reservations/{self.booking_id}/").data
        self.assertEqual((booking["payment_status"], booking["balance_due"]), ("paid", "0.00"))
        self.assertEqual(self.client.post(url, {"status": "paid"}, format="json").status_code, 409)
        refunded = self.client.post(url, {"status": "refunded"}, format="json")
        self.assertEqual(refunded.data["status"], "refunded")
        self.assertEqual(self.client.post(url, {"status": "paid"}, format="json").status_code, 409)

    def test_staff_can_void_a_pending_payment(self):
        payment = self.cash_payment()
        voided = self.client.post(f"{BASE}payments/{payment.pk}/status/", {"status": "cancelled"}, format="json")
        self.assertEqual(voided.data["status"], "cancelled")
        self.assertEqual(self.client.get(f"{BASE}reservations/{self.booking_id}/").data["payment_status"], "unpaid")

    def test_recording_payments_tracks_the_balance_and_blocks_overpayment(self):
        url = f"{BASE}reservations/{self.booking_id}/payments/"
        first = self.client.post(url, {"method": "cash", "amount": "20000", "note": "Deposit"}, format="json")
        self.assertEqual(first.status_code, 201, first.data)
        self.assertEqual(self.client.get(f"{BASE}reservations/{self.booking_id}/").data["balance_due"], "36000.00")
        self.assertEqual(self.client.post(url, {"method": "cash", "amount": "36000.01"}, format="json").status_code, 409)
        self.assertEqual(self.client.post(url, {"method": "cash", "amount": "0"}, format="json").status_code, 400)
        self.assertEqual(self.client.post(url, {"method": "cash", "amount": "36000"}, format="json").status_code, 201)
        self.assertEqual(self.client.post(url, {"method": "cash", "amount": "1"}, format="json").status_code, 409)
        self.assertEqual(len(self.client.get(url).data), 2)
        self.assertEqual(Booking.objects.get().status, "confirmed")

    def test_cancelled_reservations_take_no_payments(self):
        self.guest_client.post(f"/api/bookings/{self.booking_id}/cancel/")
        response = self.client.post(
            f"{BASE}reservations/{self.booking_id}/payments/", {"method": "cash", "amount": "100"}, format="json")
        self.assertEqual(response.status_code, 409)

    def test_dashboard_and_reports_show_payment_breakdown(self):
        self.cash_payment()
        self.assertEqual(self.client.get(BASE + "dashboard/").data["pending_payments"], 1)
        self.client.post(f"{BASE}reservations/{self.booking_id}/payments/", {"method": "cash", "amount": "10000"}, format="json")
        today = timezone.localdate()
        report = self.client.get(BASE + "reports/", {"start": today, "end": today}).data
        self.assertEqual(report["revenue_by_method"]["cash"], "10000.00")
        self.assertEqual(report["refunded"], "0.00")
