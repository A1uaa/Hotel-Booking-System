from io import BytesIO
from uuid import uuid4

from django.contrib.auth import login
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import Exists, OuterRef, Q, Value
from django.db.models.functions import Concat
from django.shortcuts import get_object_or_404
from django.utils import timezone
from PIL import Image
from rest_framework import serializers
from rest_framework.decorators import api_view, parser_classes, permission_classes
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from hotel.models import Booking, Room, RoomImage, RoomType
from .authentication import authenticate_email
from .management_permissions import capabilities, management_access, staff_access
from .management_serializers import (
    ChangeStatus, GuestSerializer, ManagedBookingSerializer, ManagedRoomSerializer,
    ManagedRoomTypeSerializer, PhotoUpload, PrimaryPhoto, ReportDates, User,
)
from .management_stats import dashboard, reports
from .serializers import RoomImageSerializer, UserSerializer
from .services import Conflict, handle_database_contention



ROOM_READ = ("view_room", "view_roomtype")
BOOKING_READ = ("view_booking",)
BOOKING_WRITE = (*BOOKING_READ, "change_booking")
STATS_READ = ("view_room", "view_booking", "view_payment")


@api_view(["POST"])
@handle_database_contention
def admin_login(request):
    user = authenticate_email(request)
    if not staff_access(user):
        raise PermissionDenied("This account does not have hotel management access.")
    login(request, user)
    return Response(admin_account(user))


def admin_account(user):
    return {"account": UserSerializer(user).data, "capabilities": capabilities(user)}


@api_view(["GET"])
@permission_classes([management_access()])
def admin_me(request):
    return Response(admin_account(request.user))


@api_view(["GET"])
@permission_classes([management_access(GET=STATS_READ)])
def overview(request):
    return Response(dashboard(timezone.localdate()))


def managed_rooms():
    return Room.objects.select_related("room_type").prefetch_related("images").annotate(
        has_history=Exists(Booking.objects.filter(room_id=OuterRef("pk"))),
    ).order_by("room_number")


@api_view(["GET"])
@permission_classes([management_access(GET=ROOM_READ)])
def room_types(request):
    return Response(ManagedRoomTypeSerializer(RoomType.objects.order_by("name"), many=True).data)


@api_view(["GET", "POST"])
@permission_classes([management_access(GET=ROOM_READ, POST=(*ROOM_READ, "add_room"))])
@handle_database_contention
def rooms(request):
    if request.method == "GET":
        return Response(ManagedRoomSerializer(managed_rooms(), many=True, context={"request": request}).data)
    with transaction.atomic():
        serializer = ManagedRoomSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        room = managed_rooms().get(pk=serializer.save().pk)
    return Response(ManagedRoomSerializer(room, context={"request": request}).data, status=201)


def delete_photo_files(photos):
    for photo in photos:
        transaction.on_commit(lambda image=photo.image: image.delete(save=False), robust=True)


@api_view(["GET", "PATCH", "DELETE"])
@permission_classes([management_access(
    GET=ROOM_READ, PATCH=(*ROOM_READ, "change_room"), DELETE=(*ROOM_READ, "delete_room"),
)])
@handle_database_contention
def room_detail(request, pk):
    if request.method == "GET":
        room = get_object_or_404(managed_rooms(), pk=pk)
        return Response(ManagedRoomSerializer(room, context={"request": request}).data)

    with transaction.atomic():
        room = get_object_or_404(managed_rooms(), pk=pk)
        if request.method == "DELETE":
            if room.has_history:
                raise Conflict("This room has reservation history. Set its status to out of service instead.")
            photos = list(room.images.all())
            room.delete()
            delete_photo_files(photos)
            return Response(status=204)

        serializer = ManagedRoomSerializer(room, data=request.data, partial=True, context={"request": request})
        serializer.is_valid(raise_exception=True)
        capacity = serializer.validated_data.get("capacity", room.capacity)
        if capacity < room.capacity and room.bookings.filter(
            guest_count__gt=capacity,
            status__in=[Booking.Status.PENDING, Booking.Status.CONFIRMED, Booking.Status.CHECKED_IN],
        ).exists():
            raise Conflict("Existing active reservations need a higher capacity.")
        serializer.save()
    return Response(serializer.data)


@api_view(["POST"])
@parser_classes([MultiPartParser])
@permission_classes([management_access(POST=("view_room", "add_roomimage"))])
@handle_database_contention
def upload_photo(request, pk):
    serializer = PhotoUpload(data=request.data)
    serializer.is_valid(raise_exception=True)
    uploaded = serializer.validated_data["image"]
    # Re-encode verified images and choose a filename independent of user input.
    output = BytesIO()
    try:
        with Image.open(uploaded) as image:
            if image.width * image.height > 25_000_000:
                raise ValidationError({"image": "Choose an image with at most 25 megapixels."})
            extension = image.format.lower()
            image.save(output, format=image.format)
    except (OSError, ValueError, Image.DecompressionBombError) as exc:
        raise ValidationError({"image": "The image could not be read."}) from exc
    photo = None
    try:
        with transaction.atomic():
            room = get_object_or_404(Room, pk=pk)
            photo = RoomImage(room=room)
            photo.image.save(f"{uuid4().hex}.{extension}", ContentFile(output.getvalue()), save=False)
            photo.save()
    except Exception:
        if photo and photo.image:
            photo.image.delete(save=False)
        raise
    return Response(RoomImageSerializer(photo, context={"request": request}).data, status=201)


@api_view(["PATCH", "DELETE"])
@permission_classes([management_access(
    PATCH=("view_room", "change_roomimage"), DELETE=("view_room", "delete_roomimage"),
)])
@handle_database_contention
def photo_detail(request, pk, photo_id):
    with transaction.atomic():
        photo = get_object_or_404(RoomImage, room_id=pk, pk=photo_id)
        if request.method == "DELETE":
            delete_photo_files([photo])
            photo.delete()
            return Response(status=204)
        serializer = PrimaryPhoto(data=request.data)
        serializer.is_valid(raise_exception=True)
        is_primary = serializer.validated_data["is_primary"]
        if is_primary:
            RoomImage.objects.filter(room_id=pk, is_primary=True).exclude(pk=photo_id).update(is_primary=False)
        photo.is_primary = is_primary
        photo.save(update_fields=["is_primary"])
    return Response(RoomImageSerializer(photo, context={"request": request}).data)


def managed_bookings():
    return Booking.objects.select_related("user", "room__room_type").order_by("-check_in", "-pk")


def booking_data(value, *, many=False):
    return ManagedBookingSerializer(value, many=many).data


@api_view(["GET"])
@permission_classes([management_access(GET=BOOKING_READ)])
def reservations(request):
    rows = managed_bookings()
    query = request.query_params.get("q", "").strip()[:254]
    if query:
        rows = rows.annotate(guest_name=Concat("user__first_name", Value(" "), "user__last_name"))
        search = (
            Q(user__email__icontains=query) | Q(guest_name__icontains=query)
            | Q(room__room_number__icontains=query)
        )
        number = query.removeprefix("#")
        if number.isascii() and number.isdecimal() and len(number) <= 19 and int(number) <= 2**63 - 1:
            search |= Q(pk=int(number))
        rows = rows.filter(search)
    status = request.query_params.get("status")
    if status:
        status = serializers.ChoiceField(Booking.Status.choices).run_validation(status)
        rows = rows.filter(status=status)
    day = request.query_params.get("date")
    if day:
        day = serializers.DateField().run_validation(day)
        rows = rows.filter(check_in__lte=day, check_out__gte=day)
    return Response(booking_data(rows, many=True))


@api_view(["GET"])
@permission_classes([management_access(GET=BOOKING_READ)])
def reservation(request, pk):
    return Response(booking_data(get_object_or_404(managed_bookings(), pk=pk)))


TRANSITIONS = {
    Booking.Status.PENDING: {Booking.Status.CONFIRMED, Booking.Status.CANCELLED},
    Booking.Status.CONFIRMED: {Booking.Status.CHECKED_IN, Booking.Status.CANCELLED},
    Booking.Status.CHECKED_IN: {Booking.Status.CHECKED_OUT},
}


@transaction.atomic
def transition(pk, target):
    booking = get_object_or_404(managed_bookings(), pk=pk)
    if target not in TRANSITIONS.get(booking.status, set()):
        raise Conflict(f"Cannot change a {booking.get_status_display().lower()} reservation to {Booking.Status(target).label.lower()}.")
    today = timezone.localdate()
    if target == Booking.Status.CHECKED_IN:
        if booking.check_in != today:
            raise Conflict("Check-in is available only on the arrival date.")
        if booking.room.status != Room.Status.AVAILABLE:
            raise Conflict("This room is out of service or under maintenance.")
        if Booking.objects.filter(room=booking.room, status=Booking.Status.CHECKED_IN).exists():
            raise Conflict("A guest is still checked in to this room.")
    if target == Booking.Status.CHECKED_OUT and today < booking.check_out:
        raise Conflict("Check-out is available on or after the scheduled departure date.")
    booking.status = target
    booking.save(update_fields=["status", "updated_at"])
    return booking


@api_view(["POST"])
@permission_classes([management_access(POST=BOOKING_WRITE)])
@handle_database_contention
def reservation_status(request, pk):
    serializer = ChangeStatus(data=request.data)
    serializer.is_valid(raise_exception=True)
    return Response(booking_data(transition(pk, serializer.validated_data["status"])))


@api_view(["POST"])
@permission_classes([management_access(POST=BOOKING_WRITE)])
@handle_database_contention
def check_in(request, pk):
    return Response(booking_data(transition(pk, Booking.Status.CHECKED_IN)))


@api_view(["POST"])
@permission_classes([management_access(POST=BOOKING_WRITE)])
@handle_database_contention
def check_out(request, pk):
    return Response(booking_data(transition(pk, Booking.Status.CHECKED_OUT)))


@api_view(["GET"])
@permission_classes([management_access(GET=BOOKING_READ)])
def front_desk(request):
    today = timezone.localdate()
    rows = managed_bookings()
    return Response({
        "date": today,
        "arrivals": booking_data(rows.filter(
            check_in=today, status__in=[Booking.Status.CONFIRMED, Booking.Status.CHECKED_IN, Booking.Status.CHECKED_OUT],
        ), many=True),
        "departures": booking_data(rows.filter(
            Q(check_out=today, status__in=[Booking.Status.CONFIRMED, Booking.Status.CHECKED_IN, Booking.Status.CHECKED_OUT])
            | Q(check_out__lt=today, status=Booking.Status.CHECKED_IN),
        ), many=True),
    })


def guests_only():
    return User.objects.filter(is_staff=False, is_superuser=False).order_by("email", "pk")


@api_view(["GET"])
@permission_classes([management_access(GET=("view_booking", "auth.view_user"))])
def guests(request):
    rows = guests_only()
    query = request.query_params.get("q", "").strip()[:254]
    for term in query.split():
        rows = rows.filter(
            Q(first_name__icontains=term) | Q(last_name__icontains=term) | Q(email__icontains=term),
        )
    return Response(GuestSerializer(rows, many=True).data)


@api_view(["GET"])
@permission_classes([management_access(GET=("view_booking", "auth.view_user"))])
def guest(request, pk):
    user = get_object_or_404(guests_only(), pk=pk)
    return Response({
        "guest": GuestSerializer(user).data,
        "bookings": booking_data(managed_bookings().filter(user=user), many=True),
    })


@api_view(["GET"])
@permission_classes([management_access(GET=STATS_READ)])
def report(request):
    dates = ReportDates(data=request.query_params)
    dates.is_valid(raise_exception=True)
    return Response(reports(**dates.validated_data))
