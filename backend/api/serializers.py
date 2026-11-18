import re
from uuid import uuid4

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.utils import timezone
from rest_framework import serializers

from hotel.models import Booking, ContactMessage, Payment, Review, Room, RoomImage, RoomType

from .services import payment_summary, round_average

User = get_user_model()


class CredentialsSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False, write_only=True)

    def validate_email(self, value):
        return value.casefold()


class RegistrationSerializer(CredentialsSerializer):
    def validate(self, attrs):
        # Django still requires a unique username, even though this API signs in by email.
        attrs["user"] = User(username=uuid4().hex, email=attrs["email"])
        validate_password(attrs["password"], attrs["user"])
        return attrs


class UserSerializer(serializers.ModelSerializer):
    role = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ("id", "email", "role")

    def get_role(self, user):
        if user.is_superuser or (user.is_staff and user.groups.filter(name="Admin").exists()):
            return "Admin"
        return "Guest"


class StaySerializer(serializers.Serializer):
    check_in = serializers.DateField()
    check_out = serializers.DateField()

    def validate(self, attrs):
        start, end = attrs.get("check_in"), attrs.get("check_out")
        if (start is None) != (end is None):
            raise serializers.ValidationError("Supply both check_in and check_out.")
        if start is not None:
            if start < timezone.localdate():
                raise serializers.ValidationError({"check_in": "Check-in cannot be in the past."})
            if start >= end:
                raise serializers.ValidationError({"check_out": "Check-out must be after check-in."})
        return attrs


class RoomFilterSerializer(StaySerializer):
    check_in = serializers.DateField(required=False)
    check_out = serializers.DateField(required=False)
    guests = serializers.IntegerField(min_value=1, max_value=32767, required=False)
    room_type = serializers.IntegerField(min_value=1, max_value=2**63 - 1, required=False)
    min_price = serializers.DecimalField(12, 2, min_value=0, required=False)
    max_price = serializers.DecimalField(12, 2, min_value=0, required=False)

    def validate(self, attrs):
        attrs = super().validate(attrs)
        if "min_price" in attrs and "max_price" in attrs and attrs["min_price"] > attrs["max_price"]:
            raise serializers.ValidationError({"max_price": "Maximum price must be at least the minimum price."})
        return attrs


class RoomTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoomType
        fields = ("id", "name")


class RoomImageSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoomImage
        fields = ("id", "image", "is_primary")


class RoomSerializer(serializers.ModelSerializer):
    room_type = RoomTypeSerializer()
    amenities = serializers.JSONField(source="room_type.amenities")
    images = RoomImageSerializer(many=True)
    available = serializers.BooleanField()
    rating_average = serializers.SerializerMethodField()
    rating_count = serializers.SerializerMethodField()

    class Meta:
        model = Room
        fields = (
            "id", "room_number", "room_type", "description", "price_per_night",
            "capacity", "amenities", "images", "available", "rating_average", "rating_count",
        )

    # Annotated by with_ratings(); a room that was not annotated simply has no rating yet.
    def get_rating_average(self, room):
        return round_average(getattr(room, "rating_average", None))

    def get_rating_count(self, room):
        return getattr(room, "rating_count", 0) or 0


class BookingInputSerializer(StaySerializer):
    room = serializers.IntegerField(min_value=1, max_value=2**63 - 1)
    guest_count = serializers.IntegerField(min_value=1, max_value=32767)


class PaymentSummaryMixin:
    """Adds the booking's money position (paid, balance, guest-facing payment state)."""

    def to_representation(self, booking):
        data = super().to_representation(booking)
        summary = payment_summary(booking)
        for key in ("paid_amount", "balance_due", "prepayment_amount"):
            data[key] = f"{summary[key]:.2f}"
        data["payment_status"] = summary["payment_status"]
        return data


class BookingSerializer(PaymentSummaryMixin, serializers.ModelSerializer):
    class Meta:
        model = Booking
        fields = (
            "id", "room", "check_in", "check_out", "guest_count",
            "price_per_night", "total_price", "status", "created_at", "updated_at",
        )


class ReviewInputSerializer(serializers.Serializer):
    rating = serializers.IntegerField(min_value=1, max_value=5)
    comment = serializers.CharField(max_length=2000, required=False, allow_blank=True, default="")
    name = serializers.CharField(max_length=80, required=False, allow_blank=True, default="")


class PublicReviewSerializer(serializers.ModelSerializer):
    """What the room page shows: a display name only, never an email or account details."""

    author = serializers.CharField(source="author_name")

    class Meta:
        model = Review
        fields = ("id", "rating", "comment", "author", "created_at")


class ContactSerializer(serializers.ModelSerializer):
    message = serializers.CharField(max_length=10000)

    class Meta:
        model = ContactMessage
        fields = ("name", "email", "subject", "message")


def luhn_valid(digits):
    total = 0
    for index, char in enumerate(reversed(digits)):
        value = int(char)
        if index % 2:
            value *= 2
            if value > 9:
                value -= 9
        total += value
    return total % 10 == 0


class PaymentInputSerializer(serializers.Serializer):
    """`method` picks card, prepayment (deposit by card) or cash (pay at the hotel)."""

    CARD_FIELDS = ("card_holder", "card_number", "expiry", "cvv")

    method = serializers.ChoiceField(choices=Payment.Method.choices, default=Payment.Method.CARD)
    card_holder = serializers.CharField(max_length=100, required=False)
    card_number = serializers.CharField(max_length=23, required=False)
    expiry = serializers.RegexField(r"^(0[1-9]|1[0-2])/\d{2}$", required=False, error_messages={"invalid": "Use the format MM/YY."})
    cvv = serializers.RegexField(r"^\d{3,4}$", required=False, error_messages={"invalid": "Enter the 3 or 4 digit security code."})

    def validate_card_number(self, value):
        digits = re.sub(r"[ -]", "", value)
        if not digits.isdigit() or not 13 <= len(digits) <= 19 or not luhn_valid(digits):
            raise serializers.ValidationError("Enter a valid card number.")
        return digits

    def validate(self, attrs):
        method = attrs["method"]
        if method == Payment.Method.CASH:
            # Cash needs no card details; anything sent is dropped here and never stored.
            return {"method": method}
        missing = {name: "This field is required." for name in self.CARD_FIELDS if not attrs.get(name)}
        if missing:
            raise serializers.ValidationError(missing)
        month, year = int(attrs["expiry"][:2]), 2000 + int(attrs["expiry"][3:])
        today = timezone.localdate()
        if (year, month) < (today.year, today.month):
            raise serializers.ValidationError({"expiry": "This card has expired."})
        # Only the method and card number leave validation; expiry and CVV are never kept.
        return {"method": method, "card_number": attrs["card_number"]}


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = ("id", "booking", "amount", "method", "payment_method", "status", "paid_at", "created_at")
