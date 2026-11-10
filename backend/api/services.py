import sqlite3
from functools import wraps

from django.core.exceptions import ValidationError as ModelValidationError
from django.db import OperationalError, transaction
from django.shortcuts import get_object_or_404
from rest_framework.exceptions import APIException, ValidationError

from hotel.models import Booking, Room


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
    return booking
