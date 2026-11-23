from decimal import Decimal

from django.contrib.auth import get_user_model
from rest_framework import serializers

from hotel.models import Booking, Payment, Review, Room, RoomImage, RoomType
from .serializers import BookingExtraSerializer, PaymentSummaryMixin, RoomImageSerializer

User = get_user_model()


class ManagedRoomSerializer(serializers.ModelSerializer):
    room_type_name = serializers.CharField(source="room_type.name", read_only=True)
    images = RoomImageSerializer(many=True, read_only=True)
    has_history = serializers.BooleanField(read_only=True)

    class Meta:
        model = Room
        fields = (
            "id", "room_number", "room_type", "room_type_name", "description",
            "price_per_night", "capacity", "status", "images", "has_history",
        )


class ManagedRoomTypeSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoomType
        fields = ("id", "name")


class PhotoUpload(serializers.ModelSerializer):
    class Meta:
        model = RoomImage
        fields = ("image",)

    def validate_image(self, image):
        if image.size > 8 * 1024 * 1024:
            raise serializers.ValidationError("Choose an image no larger than 8 MB.")
        if image.image.format not in {"JPEG", "PNG", "WEBP"}:
            raise serializers.ValidationError("Choose a JPEG, PNG, or WebP image.")
        return image


class PrimaryPhoto(serializers.Serializer):
    is_primary = serializers.BooleanField()


class GuestSerializer(serializers.ModelSerializer):
    name = serializers.CharField(source="get_full_name")

    class Meta:
        model = User
        fields = ("id", "name", "email", "date_joined")


class ManagedBookingSerializer(PaymentSummaryMixin, serializers.ModelSerializer):
    guest = GuestSerializer(source="user")
    room_number = serializers.CharField(source="room.room_number")
    room_type = serializers.CharField(source="room.room_type.name")
    # Staff see the extras a guest booked (breakfast, parking...) so they can prepare them.
    extras = BookingExtraSerializer(many=True, read_only=True)

    class Meta:
        model = Booking
        fields = (
            "id", "guest", "room", "room_number", "room_type", "check_in", "check_out",
            "guest_count", "price_per_night", "total_price", "extras", "status", "created_at", "updated_at",
        )


class ChangeStatus(serializers.Serializer):
    status = serializers.ChoiceField(choices=Booking.Status.choices)


class ReportDates(serializers.Serializer):
    start = serializers.DateField()
    end = serializers.DateField()

    def validate(self, data):
        days = (data["end"] - data["start"]).days
        if not 0 <= days <= 365:
            raise serializers.ValidationError("Select an inclusive range of up to 366 days.")
        return data


class ManagedPaymentSerializer(serializers.ModelSerializer):
    guest = GuestSerializer(source="booking.user")
    room_number = serializers.CharField(source="booking.room.room_number")
    booking_status = serializers.CharField(source="booking.status")
    booking_total = serializers.DecimalField(source="booking.total_price", max_digits=12, decimal_places=2)
    recorded_by_email = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = (
            "id", "booking", "guest", "room_number", "booking_status", "booking_total", "amount",
            "method", "payment_method", "status", "note", "recorded_by_email", "paid_at", "created_at",
        )

    def get_recorded_by_email(self, payment):
        return payment.recorded_by.email if payment.recorded_by else ""


class RecordPayment(serializers.Serializer):
    method = serializers.ChoiceField(choices=Payment.Method.choices)
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class ChangePaymentStatus(serializers.Serializer):
    status = serializers.ChoiceField(choices=[
        (Payment.Status.PAID, "Paid"), (Payment.Status.REFUNDED, "Refunded"), (Payment.Status.CANCELLED, "Cancelled"),
    ])
    note = serializers.CharField(max_length=255, required=False, allow_blank=True, default="")


class ManagedReviewSerializer(serializers.ModelSerializer):
    # Visitors can review without an account, so `guest` is null for them.
    guest = GuestSerializer(source="user", read_only=True, allow_null=True)
    room_number = serializers.CharField(source="room.room_number")

    class Meta:
        model = Review
        fields = ("id", "room", "room_number", "author_name", "guest", "rating", "comment", "is_hidden", "created_at")


class ChangeReviewVisibility(serializers.Serializer):
    hidden = serializers.BooleanField()
