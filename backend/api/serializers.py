from uuid import uuid4

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.utils import timezone
from rest_framework import serializers

from hotel.models import Booking, ContactMessage, Room, RoomImage, RoomType

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

    class Meta:
        model = Room
        fields = (
            "id", "room_number", "room_type", "description", "price_per_night",
            "capacity", "amenities", "images", "available",
        )


class BookingInputSerializer(StaySerializer):
    room = serializers.IntegerField(min_value=1, max_value=2**63 - 1)
    guest_count = serializers.IntegerField(min_value=1, max_value=32767)


class BookingSerializer(serializers.ModelSerializer):
    class Meta:
        model = Booking
        fields = (
            "id", "room", "check_in", "check_out", "guest_count",
            "price_per_night", "total_price", "status", "created_at", "updated_at",
        )


class ContactSerializer(serializers.ModelSerializer):
    message = serializers.CharField(max_length=10000)

    class Meta:
        model = ContactMessage
        fields = ("name", "email", "subject", "message")
