from collections import Counter
from datetime import timedelta
from decimal import Decimal

from django.db.models import Sum
from hotel.models import Booking, Payment, Room


OCCUPANCY_STATUSES = (Booking.Status.CONFIRMED, Booking.Status.CHECKED_IN, Booking.Status.CHECKED_OUT)


def revenue(start=None, end=None):
    # Payment records take precedence over the booking value to avoid counting twice.
    paid = Payment.objects.filter(status=Payment.Status.PAID)
    completed = Booking.objects.filter(status=Booking.Status.CHECKED_OUT, payments__isnull=True)
    if start is not None:
        paid = paid.filter(created_at__date__range=(start, end))
        completed = completed.filter(check_out__range=(start, end))
    amount = paid.aggregate(total=Sum("amount", default=Decimal(0)))["total"]
    amount += completed.aggregate(total=Sum("total_price", default=Decimal(0)))["total"]
    return f"{amount:.2f}"


def dashboard(today):
    bookings = Booking.objects.all()
    occupied = bookings.filter(status=Booking.Status.CHECKED_IN)
    occupied_ids = occupied.values("room_id")
    return {
        "date": today,
        "total_rooms": Room.objects.count(),
        "available_rooms": Room.objects.filter(status=Room.Status.AVAILABLE).exclude(pk__in=occupied_ids).count(),
        "occupied_rooms": occupied.values("room_id").distinct().count(),
        "arrivals": bookings.filter(check_in=today, status__in=[Booking.Status.CONFIRMED, Booking.Status.CHECKED_IN, Booking.Status.CHECKED_OUT]).count(),
        "departures": bookings.filter(check_out=today, status__in=OCCUPANCY_STATUSES).count(),
        "active_reservations": bookings.filter(
            status__in=[Booking.Status.PENDING, Booking.Status.CONFIRMED, Booking.Status.CHECKED_IN],
        ).count(),
        "revenue": revenue(),
    }


def reports(start, end):
    # Compute clipped stay nights for the date range, treating checkout as exclusive.
    stays = Booking.objects.filter(check_in__lte=end, check_out__gt=start)
    statuses = Counter()
    popular = Counter()
    occupied_nights = 0
    for status, arrival, departure, room_type in stays.values_list(
        "status", "check_in", "check_out", "room__room_type__name"
    ).iterator():
        statuses[status] += 1
        if status != Booking.Status.CANCELLED:
            popular[room_type] += 1
        if status in OCCUPANCY_STATUSES:
            occupied_nights += (min(departure - timedelta(days=1), end) - max(arrival, start)).days + 1

    capacity_nights = Room.objects.count() * ((end - start).days + 1)
    return {
        "start": start, "end": end, "bookings": sum(statuses.values()),
        "by_status": {status: statuses[status] for status in Booking.Status.values},
        "occupied_nights": occupied_nights, "capacity_nights": capacity_nights,
        "occupancy_percent": round(100 * occupied_nights / capacity_nights, 2) if capacity_nights else 0,
        "revenue": revenue(start, end),
        "popular_room_types": [{"name": name, "bookings": count} for name, count in sorted(
            popular.items(), key=lambda item: (-item[1], item[0])
        )],
    }
