import sqlite3
from decimal import ROUND_HALF_UP, Decimal
from functools import wraps

from django.core.exceptions import ValidationError as ModelValidationError
from django.db import OperationalError, transaction
from django.db.models import DecimalField, Exists, OuterRef, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from hotel.models import Booking, Payment, Room


class Conflict(APIException):
    status_code = 409
    default_detail = "The room is already booked for those dates."
    default_code = "conflict"


class DatabaseBusy(APIException):
    status_code = 503
    default_detail = "The database is busy. Please try again."
    default_code = "database_busy"


def handle_database_contention(view):
    @wraps(view)
    def wrapped(*args, **kwargs):
        try:
            return view(*args, **kwargs)
        except OperationalError as exc:
            code = getattr(exc.__cause__, "sqlite_errorcode", 0)
            if (code & 0xff) in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
                raise DatabaseBusy() from exc
            raise
    return wrapped


@transaction.atomic
def create_booking(user, *, room, check_in, check_out, guest_count):
    room = get_object_or_404(Room, pk=room)
    if room.status != Room.Status.AVAILABLE:
        raise Conflict("This room is unavailable for booking.")
    if Booking.overlapping(check_in, check_out).filter(room=room).exists():
        raise Conflict()

    booking = Booking(
        user=user, room=room, check_in=check_in, check_out=check_out,
        guest_count=guest_count, price_per_night=room.price_per_night,
        total_price=room.price_per_night * (check_out - check_in).days,
    )
    try:
        booking.full_clean()
    except ModelValidationError as exc:
        raise ValidationError(exc.message_dict) from exc
    booking.save()
    return booking


@transaction.atomic
def cancel_booking(bookings, pk):
    booking = get_object_or_404(bookings, pk=pk)
    if booking.status == Booking.Status.CANCELLED:
        return booking
    if booking.status not in (Booking.Status.PENDING, Booking.Status.CONFIRMED):
        raise Conflict("Only pending or confirmed bookings can be cancelled.")
    booking.status = Booking.Status.CANCELLED
    booking.save(update_fields=["status", "updated_at"])
    # A cancelled stay gives the money back (simulated) and closes any open pay-at-hotel request.
    now = timezone.now()
    booking.payments.filter(status=Payment.Status.PAID).update(status=Payment.Status.REFUNDED, updated_at=now)
    booking.payments.filter(status=Payment.Status.PENDING).update(status=Payment.Status.CANCELLED, updated_at=now)
    return booking


# ---------------------------------------------------------------------------
# Payments
#
# A booking's payments form a small ledger. Only rows with status "paid" count
# towards the booking; the balance is total_price minus that sum.
#   card        - the full balance, paid online now.
#   prepayment  - PREPAYMENT_PERCENT of the total paid online now; the rest is due at the hotel.
#   cash        - "pay at the hotel": a pending row that staff settle when the money is received.
# The gateway is simulated: no real money moves and no card data is stored.
# ---------------------------------------------------------------------------
DECLINED_TEST_CARD = "4000000000000002"
PREPAYMENT_PERCENT = 30
CENT = Decimal("0.01")
ZERO = Decimal("0.00")
MONEY = DecimalField(max_digits=12, decimal_places=2)


def with_payment_totals(bookings):
    """Annotate bookings with payment facts so lists do not need a query per row."""
    paid = (
        Payment.objects.filter(booking=OuterRef("pk"), status=Payment.Status.PAID)
        .order_by().values("booking").annotate(total=Sum("amount")).values("total")
    )
    return bookings.annotate(
        paid_amount=Coalesce(Subquery(paid, output_field=MONEY), Value(ZERO, output_field=MONEY)),
        has_pending_cash=Exists(Payment.objects.filter(
            booking=OuterRef("pk"), status=Payment.Status.PENDING, method=Payment.Method.CASH)),
        has_refund=Exists(Payment.objects.filter(booking=OuterRef("pk"), status=Payment.Status.REFUNDED)),
    )


def paid_total(booking):
    return booking.payments.filter(status=Payment.Status.PAID).aggregate(
        total=Sum("amount", default=ZERO))["total"]


def prepayment_amount(booking):
    return (booking.total_price * PREPAYMENT_PERCENT / 100).quantize(CENT, rounding=ROUND_HALF_UP)


def payment_summary(booking):
    """Paid amount, balance and a single guest-facing payment state for one booking."""
    paid = getattr(booking, "paid_amount", None)
    if paid is None:
        paid = paid_total(booking)
    pending_cash = getattr(booking, "has_pending_cash", None)
    if pending_cash is None:
        pending_cash = booking.payments.filter(
            status=Payment.Status.PENDING, method=Payment.Method.CASH).exists()
    refunded = getattr(booking, "has_refund", None)
    if refunded is None:
        refunded = booking.payments.filter(status=Payment.Status.REFUNDED).exists()

    paid = Decimal(paid)
    if booking.status == Booking.Status.CANCELLED:
        balance, state = ZERO, ("refunded" if refunded else "unpaid")
    else:
        balance = max(booking.total_price - paid, ZERO)
        if balance == 0:
            state = "paid"
        elif pending_cash:
            state = "pay_at_hotel"
        elif paid > 0:
            state = "partial"
        else:
            state = "unpaid"
    return {
        "paid_amount": paid, "balance_due": balance, "payment_status": state,
        "prepayment_amount": min(prepayment_amount(booking), balance) if balance else ZERO,
    }


def method_label(method, card_number=None):
    last_four = (card_number or "")[-4:]
    if method == Payment.Method.CARD:
        return "Card ending " + last_four
    if method == Payment.Method.PREPAYMENT:
        return "Prepayment, card ending " + last_four
    return "Cash at hotel"


def _close_pending(booking, *, only_cash=False):
    pending = booking.payments.filter(status=Payment.Status.PENDING)
    if only_cash:
        pending = pending.filter(method=Payment.Method.CASH)
    pending.update(status=Payment.Status.CANCELLED, updated_at=timezone.now())


def _confirm(booking):
    if booking.status == Booking.Status.PENDING:
        booking.status = Booking.Status.CONFIRMED
        booking.save(update_fields=["status", "updated_at"])


@transaction.atomic
def pay_booking(bookings, pk, *, method=Payment.Method.CARD, card_number=None):
    booking = get_object_or_404(bookings, pk=pk)
    if booking.status not in (Booking.Status.PENDING, Booking.Status.CONFIRMED):
        raise Conflict("Only pending or confirmed bookings can be paid.")
    paid = paid_total(booking)
    due = booking.total_price - paid
    if due <= 0:
        raise Conflict("This booking has already been paid.")

    if method == Payment.Method.CASH:
        if booking.payments.filter(status=Payment.Status.PENDING, method=Payment.Method.CASH).exists():
            raise Conflict("Payment at the hotel is already arranged for this booking.")
        # The room is held for the guest; staff record the cash when it is received.
        payment = Payment.objects.create(
            booking=booking, amount=due, method=method,
            payment_method=method_label(method), status=Payment.Status.PENDING,
        )
        _confirm(booking)
        return payment

    amount = due
    if method == Payment.Method.PREPAYMENT:
        if paid > 0:
            raise Conflict("A prepayment can only be made before any other payment.")
        amount = min(prepayment_amount(booking), due)

    approved = card_number != DECLINED_TEST_CARD
    payment = Payment.objects.create(
        booking=booking, amount=amount, method=method,
        payment_method=method_label(method, card_number),
        status=Payment.Status.PAID if approved else Payment.Status.FAILED,
        paid_at=timezone.now() if approved else None,
    )
    if approved:
        # An earlier pay-at-hotel request is replaced by the online payment.
        _close_pending(booking, only_cash=True)
        _confirm(booking)
    return payment


# Staff-side payment handling -------------------------------------------------

PAYMENT_TRANSITIONS = {
    Payment.Status.PENDING: {Payment.Status.PAID, Payment.Status.CANCELLED},
    Payment.Status.PAID: {Payment.Status.REFUNDED},
}


def _append_note(payment, note):
    if note:
        joined = (payment.note + " | " + note) if payment.note else note
        payment.note = joined[-255:]


@transaction.atomic
def record_payment(booking_pk, *, method, amount, note, user):
    """Staff record money actually received (for example cash at the front desk)."""
    booking = get_object_or_404(Booking, pk=booking_pk)
    if booking.status == Booking.Status.CANCELLED:
        raise Conflict("A cancelled reservation cannot take payments.")
    due = booking.total_price - paid_total(booking)
    if due <= 0:
        raise Conflict("This booking has already been paid.")
    if amount > due:
        raise Conflict(f"The amount exceeds the balance due ({due:.2f}).")
    payment = Payment.objects.create(
        booking=booking, amount=amount, method=method, status=Payment.Status.PAID,
        payment_method=f"{Payment.Method(method).label} (recorded by staff)",
        note=note[:255], recorded_by=user, paid_at=timezone.now(),
    )
    if amount == due:
        _close_pending(booking)
    _confirm(booking)
    return payment


@transaction.atomic
def change_payment_status(pk, target, *, note, user):
    payment = get_object_or_404(Payment.objects.select_related("booking"), pk=pk)
    if target not in PAYMENT_TRANSITIONS.get(payment.status, set()):
        raise Conflict(f"Cannot change a {payment.get_status_display().lower()} payment to {Payment.Status(target).label.lower()}.")
    booking = payment.booking
    if target == Payment.Status.PAID:
        if booking.status == Booking.Status.CANCELLED:
            raise Conflict("A cancelled reservation cannot take payments.")
        if paid_total(booking) + payment.amount > booking.total_price:
            raise Conflict("Paid amounts would exceed the booking total.")
        payment.paid_at = timezone.now()
        payment.recorded_by = user
    payment.status = target
    _append_note(payment, note)
    payment.save()
    if target == Payment.Status.PAID:
        _confirm(booking)
    return payment
