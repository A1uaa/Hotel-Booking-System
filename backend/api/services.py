import sqlite3
from decimal import ROUND_HALF_UP, Decimal
from functools import wraps

from django.core.exceptions import ValidationError as ModelValidationError
from django.db import IntegrityError, OperationalError, transaction
from django.db.models import Avg, Count, DecimalField, Exists, FloatField, IntegerField, OuterRef, Q, Subquery, Sum, Value
from django.db.models.functions import Coalesce
from django.shortcuts import get_object_or_404
from django.utils import timezone
from rest_framework.exceptions import APIException, ValidationError

from hotel.models import Booking, BookingExtra, Extra, ExtraPrice, Payment, Review, Room


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


def extra_amount(unit, unit_price, nights, guests):
    """What one extra costs for a stay: once, for every night, or for every guest on every night."""
    if unit == Extra.Unit.PER_NIGHT:
        return unit_price * nights
    if unit == Extra.Unit.PER_GUEST_NIGHT:
        return unit_price * nights * guests
    return unit_price


@transaction.atomic
def create_booking(user, *, room, check_in, check_out, guest_count, extras=()):
    """Book a room. `extras` are codes of optional paid extras the guest ticked.

    The extras that the room's type includes for free are always added at no charge, and
    the room's own price list decides what each ticked extra costs.
    """
    room = get_object_or_404(Room.objects.select_related("room_type"), pk=room)
    if room.status != Room.Status.AVAILABLE:
        raise Conflict("This room is unavailable for booking.")
    if Booking.overlapping(check_in, check_out).filter(room=room).exists():
        raise Conflict()

    offers = {
        offer.extra.code: offer
        for offer in ExtraPrice.objects.filter(room_type=room.room_type, extra__is_active=True).select_related("extra")
    }
    unknown = sorted(set(extras) - set(offers))
    if unknown:
        raise ValidationError({"extras": "These extras are not offered for this room: " + ", ".join(unknown) + "."})

    nights = (check_out - check_in).days
    lines = []
    for code, offer in offers.items():
        if offer.included:
            lines.append((offer, ZERO, ZERO, True))
        elif code in extras:
            lines.append((offer, offer.price, extra_amount(offer.extra.unit, offer.price, nights, guest_count), False))

    booking = Booking(
        user=user, room=room, check_in=check_in, check_out=check_out,
        guest_count=guest_count, price_per_night=room.price_per_night,
        total_price=room.price_per_night * nights + sum((line[2] for line in lines), ZERO),
    )
    try:
        booking.full_clean()
    except ModelValidationError as exc:
        raise ValidationError(exc.message_dict) from exc
    booking.save()
    BookingExtra.objects.bulk_create([
        BookingExtra(
            booking=booking, extra=offer.extra, name=offer.extra.name, unit=offer.extra.unit,
            unit_price=unit_price, included=included, amount=amount,
        )
        for offer, unit_price, amount, included in lines
    ])
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
    for payment in booking.payments.filter(status=Payment.Status.PAID):
        payment.status = Payment.Status.REFUNDED
        payment.save(update_fields=["status", "updated_at"])
    for payment in booking.payments.filter(status=Payment.Status.PENDING):
        payment.status = Payment.Status.CANCELLED
        payment.save(update_fields=["status", "updated_at"])
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
    for payment in pending:
        payment.status = Payment.Status.CANCELLED
        payment.save(update_fields=["status", "updated_at"])


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


# ---------------------------------------------------------------------------
# Reviews: feedback on a room, open to everyone
# ---------------------------------------------------------------------------

def with_ratings(rooms):
    """Annotate rooms with the average and count of their visible reviews, so lists need no query per room."""
    visible = Review.objects.filter(room=OuterRef("pk"), is_hidden=False).order_by().values("room")
    return rooms.annotate(
        rating_average=Subquery(visible.annotate(value=Avg("rating")).values("value"), output_field=FloatField()),
        rating_count=Coalesce(
            Subquery(visible.annotate(value=Count("pk")).values("value"), output_field=IntegerField()),
            Value(0), output_field=IntegerField(),
        ),
    )


def round_average(value):
    return round(float(value), 1) if value is not None else None


@transaction.atomic
def create_review(room, user, *, rating, booking, comment="", name=""):
    if user is None or not user.is_authenticated:
        from rest_framework.exceptions import PermissionDenied
        raise PermissionDenied("Authentication required.")
    stay = get_object_or_404(Booking, pk=booking, user=user, room=room)
    if stay.status != Booking.Status.CHECKED_OUT:
        raise ValidationError({"booking": "Complete your stay before leaving a review."})
    if Review.objects.filter(booking=stay).exists():
        raise Conflict("This stay already has a review.")
    return Review.objects.create(
        booking=stay, room=room, user=user, author_name=user.get_full_name()[:80] or "Guest",
        rating=rating, comment=comment.strip(),
    )


def room_reviews(room, limit=50):
    """Visible reviews of a room: the newest `limit`, plus count, average and the number of each star rating."""
    visible = Review.objects.filter(room=room, is_hidden=False)
    stats = visible.aggregate(
        count=Count("pk"), average=Avg("rating"),
        **{f"star_{star}": Count("pk", filter=Q(rating=star)) for star in range(1, 6)},
    )
    rows = visible.order_by("-created_at", "-pk")[:limit]
    summary = {
        "count": stats["count"],
        "average": round_average(stats["average"]),
        "breakdown": {str(star): stats[f"star_{star}"] for star in range(1, 6)},
    }
    return summary, rows
