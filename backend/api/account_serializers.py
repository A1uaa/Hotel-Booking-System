from django.contrib.auth import get_user_model
from rest_framework import serializers
from hotel.models import UserProfile, Review
from .serializers import PublicReviewSerializer

class ProfileInput(serializers.Serializer):
    first_name = serializers.CharField(max_length=150, allow_blank=True, required=False)
    last_name = serializers.CharField(max_length=150, allow_blank=True, required=False)
    phone = serializers.RegexField(r"^[+0-9 ()-]{0,30}$", allow_blank=True, required=False)
    preferred_language = serializers.ChoiceField(choices=["en", "ru", "kk"], required=False)

class PasswordInput(serializers.Serializer):
    current_password = serializers.CharField(trim_whitespace=False)
    new_password = serializers.CharField(trim_whitespace=False, max_length=128)
    confirmation = serializers.CharField(trim_whitespace=False)

class OwnReviewSerializer(PublicReviewSerializer):
    room_number = serializers.CharField(source="room.room_number")
    class Meta(PublicReviewSerializer.Meta):
        fields = (*PublicReviewSerializer.Meta.fields, "booking", "room", "room_number", "is_hidden")

def profile_data(user, request):
    profile, _ = UserProfile.objects.get_or_create(user=user)
    return {
        "id": user.pk, "email": user.email, "first_name": user.first_name, "last_name": user.last_name,
        "phone": profile.phone, "preferred_language": profile.preferred_language,
        "photo": request.build_absolute_uri(profile.photo.url) if profile.photo else None,
        "role": "Admin" if user.is_staff else "Guest",
    }

