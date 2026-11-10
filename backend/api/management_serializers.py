from django.contrib.auth import get_user_model
from rest_framework import serializers

from hotel.models import Booking, Room, RoomImage, RoomType
from .serializers import RoomImageSerializer

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


class ManagedBookingSerializer(serializers.ModelSerializer):
    guest = GuestSerializer(source="user")
    room_number = serializers.CharField(source="room.room_number")
    room_type = serializers.CharField(source="room.room_type.name")

    class Meta:
        model = Booking
        fields = (
            "id", "guest", "room", "room_number", "room_type", "check_in", "check_out",
            "guest_count", "price_per_night", "total_price", "status", "created_at", "updated_at",
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
