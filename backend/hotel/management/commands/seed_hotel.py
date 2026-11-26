from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand
from django.db import transaction

from hotel.models import Extra, ExtraPrice, Room, RoomType


ROOM_TYPES = (
    (
        "Standard Room",
        "Comfortable rooms for short stays and business trips.",
        ["Wi-Fi", "Work desk", "Shower", "Tea station"],
        (
            ("101", "Quiet single room overlooking the courtyard.", 24000, 1),
            ("102", "Queen room with blackout curtains and a courtyard view.", 28000, 2),
            ("103", "Twin room with two single beds and a shared desk.", 29000, 2),
        ),
    ),
    (
        "Deluxe Room",
        "Spacious rooms with upgraded bedding and extra seating.",
        ["Wi-Fi", "Mini fridge", "Smart TV", "Bathrobes"],
        (
            ("201", "King room with a reading chair and park-facing windows.", 38000, 2),
            ("202", "Deluxe twin room with a window bench and city views.", 39000, 2),
            ("203", "Family room with a queen bed and a sofa bed.", 45000, 3),
        ),
    ),
    (
        "Executive Suite",
        "Suites with a separate lounge and space for longer stays.",
        ["Wi-Fi", "Espresso machine", "Separate lounge", "Bathtub"],
        (
            ("301", "Corner king suite with a lounge and wide park views.", 62000, 2),
            ("302", "King suite with a dining nook and a single sofa bed.", 68000, 3),
            ("303", "Family suite with a king bedroom and a twin bedroom.", 76000, 4),
        ),
    ),
)


# (code, name, description, unit, price per room type: Standard, Deluxe, Executive, None = included free)
EXTRAS = (
    ("breakfast", "Breakfast", "Buffet breakfast every morning.", Extra.Unit.PER_GUEST_NIGHT, (4500, 3500, None)),
    ("parking", "Parking", "A reserved space in the hotel car park.", Extra.Unit.PER_NIGHT, (3000, 2000, None)),
    ("late-checkout", "Late check-out", "Keep the room until 16:00 on the day you leave.", Extra.Unit.PER_STAY, (6000, 4000, None)),
    ("airport-transfer", "Airport transfer", "A car from Almaty airport to the hotel.", Extra.Unit.PER_STAY, (12000, 10000, 8000)),
)


class Command(BaseCommand):
    help = "Create the hotel roles and initial room inventory without overwriting existing rooms."

    @transaction.atomic
    def handle(self, *args, **options):
        Group.objects.get_or_create(name="Guest")
        admin_group, _ = Group.objects.get_or_create(name="Admin")
        admin_group.permissions.add(*Permission.objects.filter(content_type__app_label="hotel"))
        admin_group.permissions.add(Permission.objects.get(content_type__app_label="auth", codename="view_user"))

        types_created = rooms_created = 0
        for name, description, amenities, rooms in ROOM_TYPES:
            room_type, created = RoomType.objects.get_or_create(
                name=name, defaults={"description": description, "amenities": amenities}
            )
            types_created += created
            for number, description, price, capacity in rooms:
                _, created = Room.objects.get_or_create(
                    room_number=number,
                    defaults={
                        "room_type": room_type,
                        "description": description,
                        "price_per_night": price,
                        "capacity": capacity,
                    },
                )
                rooms_created += created

        # Existing extras and prices are left alone so staff changes are never overwritten.
        types = [RoomType.objects.get(name=name) for name, *_ in ROOM_TYPES]
        extras_created = 0
        for code, name, description, unit, prices in EXTRAS:
            extra, created = Extra.objects.get_or_create(
                code=code, defaults={"name": name, "description": description, "unit": unit},
            )
            extras_created += created
            for room_type, price in zip(types, prices):
                ExtraPrice.objects.get_or_create(
                    extra=extra, room_type=room_type,
                    defaults={"price": price or 0, "included": price is None},
                )

        self.stdout.write(self.style.SUCCESS(
            f"Created {types_created} room types, {rooms_created} rooms and {extras_created} extras. "
            "Guest and Admin groups are ready."
        ))
