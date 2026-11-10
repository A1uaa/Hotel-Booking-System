from django.contrib.auth import login, logout
from django.contrib.auth.models import Group
from django.db import transaction
from django.db.models import BooleanField, Exists, OuterRef, Value
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from hotel.models import Booking, Room

from .authentication import authenticate_email
from .serializers import (
    BookingInputSerializer, BookingSerializer, ContactSerializer,
    RegistrationSerializer, RoomFilterSerializer,
    RoomSerializer, User, UserSerializer,
)
from .services import Conflict, cancel_booking, create_booking, handle_database_contention


@api_view(["GET"])
def health(request):
    return Response({"status": "ok"})


@api_view(["GET"])
def csrf_token(request):
    response = Response({"csrf_token": get_token(request)})
    response["Cache-Control"] = "no-store"
    return response


@api_view(["POST"])
@handle_database_contention
def register(request):
    serializer = RegistrationSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    user = serializer.validated_data["user"]
    user.set_password(serializer.validated_data["password"])

    with transaction.atomic():
        if User.objects.filter(email__iexact=user.email).exists():
            raise Conflict("An account with that email already exists.")
        user.save()
        guest, _ = Group.objects.get_or_create(name="Guest")
        user.groups.add(guest)

    return Response(UserSerializer(user).data, status=201)


@api_view(["POST"])
@handle_database_contention
def sign_in(request):
    user = authenticate_email(request)
    login(request, user)
    return Response(UserSerializer(user).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@handle_database_contention
def sign_out(request):
    logout(request)
    return Response(status=204)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def me(request):
    return Response(UserSerializer(request.user).data)


def room_catalog(params):
    filters = RoomFilterSerializer(data=params)
    filters.is_valid(raise_exception=True)
    values = filters.validated_data
    rooms = Room.objects.select_related("room_type").prefetch_related("images").order_by("room_number")
    for param, lookup in (
        ("guests", "capacity__gte"), ("room_type", "room_type_id"),
        ("min_price", "price_per_night__gte"), ("max_price", "price_per_night__lte"),
    ):
        if param in values:
            rooms = rooms.filter(**{lookup: values[param]})
    if "check_in" in values:
        conflicts = Booking.overlapping(values["check_in"], values["check_out"]).filter(room_id=OuterRef("pk"))
        rooms = rooms.annotate(has_overlap=Exists(conflicts))
    else:
        rooms = rooms.annotate(has_overlap=Value(False, output_field=BooleanField()))
    return rooms


@api_view(["GET"])
def room_list(request):
    rooms = room_catalog(request.query_params).filter(status=Room.Status.AVAILABLE, has_overlap=False)
    rooms = rooms.annotate(available=Value(True, output_field=BooleanField()))
    return Response(RoomSerializer(rooms, many=True, context={"request": request}).data)


@api_view(["GET"])
def room_detail(request, pk):
    room = get_object_or_404(room_catalog(request.query_params), pk=pk)
    room.available = room.status == Room.Status.AVAILABLE and not room.has_overlap
    return Response(RoomSerializer(room, context={"request": request}).data)


@api_view(["GET", "POST"])
@permission_classes([IsAuthenticated])
@handle_database_contention
def bookings(request):
    if request.method == "GET":
        owned = Booking.objects.filter(user=request.user).order_by("-created_at", "-pk")
        return Response(BookingSerializer(owned, many=True).data)
    serializer = BookingInputSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    booking = create_booking(request.user, **serializer.validated_data)
    return Response(BookingSerializer(booking).data, status=201)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def booking_detail(request, pk):
    booking = get_object_or_404(Booking, pk=pk, user=request.user)
    return Response(BookingSerializer(booking).data)


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@handle_database_contention
def booking_cancel(request, pk):
    booking = cancel_booking(Booking.objects.filter(user=request.user), pk)
    return Response(BookingSerializer(booking).data)


@api_view(["POST"])
@handle_database_contention
def contact(request):
    serializer = ContactSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    message = serializer.save()
    return Response({"id": message.pk}, status=201)
