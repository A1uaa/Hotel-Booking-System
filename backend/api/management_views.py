from .idempotency import payment_idempotency
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

from hotel.models import Booking, Payment, Review, Room, RoomImage, RoomType
from .authentication import authenticate_email
from .account_serializers import profile_data, OwnReviewSerializer
from .management_permissions import capabilities, management_access, staff_access
from .management_serializers import (
    ChangePaymentStatus, ChangeReviewVisibility, ChangeStatus, GuestSerializer, ManagedBookingSerializer,
    ManagedPaymentSerializer, ManagedReviewSerializer, ManagedRoomSerializer, ManagedRoomTypeSerializer, PhotoUpload, PrimaryPhoto, RecordPayment, ReportDates, User,
)
from .management_stats import dashboard, reports
from .serializers import RoomImageSerializer, UserSerializer
from .services import cancel_booking, Conflict, change_payment_status, handle_database_contention, record_payment, with_payment_totals



ROOM_READ = ("view_room", "view_roomtype")
BOOKING_READ = ("view_booking",)
BOOKING_WRITE = (*BOOKING_READ, "change_booking")
PAYMENT_READ = ("view_booking", "view_payment")
STATS_READ = ("view_room", "view_booking", "view_payment")
REVIEW_READ = ("view_review",)


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
    selected = request.query_params.get("date")
    selected = serializers.DateField().run_validation(selected) if selected else None
    return Response(dashboard(timezone.localdate(), selected))


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
    return with_payment_totals(
        Booking.objects.select_related("user", "room__room_type").prefetch_related("extras")
    ).order_by("-check_in", "-pk")


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
    if target == Booking.Status.CANCELLED:
        return cancel_booking(Booking.objects.all(), pk)
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
        "profile": profile_data(user, request),
        "payments": payment_data(managed_payments().filter(booking__user=user), many=True) if request.user.has_perm("hotel.view_payment") else [],
        "reviews": OwnReviewSerializer(user.reviews.select_related("room", "booking"), many=True).data if request.user.has_perm("hotel.view_review") else [],
        "bookings": booking_data(managed_bookings().filter(user=user), many=True),
    })


@api_view(["GET"])
@permission_classes([management_access(GET=STATS_READ)])
def report(request):
    dates = ReportDates(data=request.query_params)
    dates.is_valid(raise_exception=True)
    return Response(reports(**dates.validated_data))


def managed_payments():
    return Payment.objects.select_related("booking__user", "booking__room", "recorded_by").order_by("-created_at", "-pk")


def payment_data(value, *, many=False):
    return ManagedPaymentSerializer(value, many=many).data


@api_view(["GET"])
@permission_classes([management_access(GET=PAYMENT_READ)])
def payments(request):
    rows = managed_payments()
    query = request.query_params.get("q", "").strip()[:254]
    if query:
        rows = rows.annotate(guest_name=Concat("booking__user__first_name", Value(" "), "booking__user__last_name"))
        search = (
            Q(booking__user__email__icontains=query) | Q(guest_name__icontains=query)
            | Q(booking__room__room_number__icontains=query) | Q(payment_method__icontains=query)
        )
        number = query.removeprefix("#")
        if number.isascii() and number.isdecimal() and len(number) <= 19 and int(number) <= 2**63 - 1:
            search |= Q(booking_id=int(number)) | Q(pk=int(number))
        rows = rows.filter(search)
    status = request.query_params.get("status")
    if status:
        rows = rows.filter(status=serializers.ChoiceField(Payment.Status.choices).run_validation(status))
    method = request.query_params.get("method")
    if method:
        rows = rows.filter(method=serializers.ChoiceField(Payment.Method.choices).run_validation(method))
    day = request.query_params.get("date")
    if day:
        day = serializers.DateField().run_validation(day)
        rows = rows.filter(created_at__date=day)
    return Response(payment_data(rows, many=True))


@api_view(["GET"])
@permission_classes([management_access(GET=PAYMENT_READ)])
def payment(request, pk):
    return Response(payment_data(get_object_or_404(managed_payments(), pk=pk)))


@api_view(["POST"])
@permission_classes([management_access(POST=(*PAYMENT_READ, "change_payment"))])
@handle_database_contention
def payment_status(request, pk):
    serializer = ChangePaymentStatus(data=request.data)
    serializer.is_valid(raise_exception=True)
    change_payment_status(pk, serializer.validated_data["status"], note=serializer.validated_data["note"], user=request.user)
    return Response(payment_data(get_object_or_404(managed_payments(), pk=pk)))


@api_view(["GET", "POST"])
@permission_classes([management_access(GET=PAYMENT_READ, POST=(*PAYMENT_READ, "add_payment"))])
@handle_database_contention
@payment_idempotency
def reservation_payments(request, pk):
    if request.method == "GET":
        get_object_or_404(Booking, pk=pk)
        return Response(payment_data(managed_payments().filter(booking_id=pk), many=True))
    serializer = RecordPayment(data=request.data)
    serializer.is_valid(raise_exception=True)
    created = record_payment(pk, user=request.user, **serializer.validated_data)
    return Response(payment_data(get_object_or_404(managed_payments(), pk=created.pk)), status=201)


def managed_reviews():
    return Review.objects.select_related("user", "room").order_by("-created_at", "-pk")


@api_view(["GET"])
@permission_classes([management_access(GET=REVIEW_READ)])
def reviews(request):
    rows = managed_reviews()
    query = request.query_params.get("q", "").strip()[:254]
    if query:
        rows = rows.filter(
            Q(user__email__icontains=query) | Q(author_name__icontains=query)
            | Q(room__room_number__icontains=query) | Q(comment__icontains=query)
        )
    visibility = request.query_params.get("visibility")
    if visibility:
        visibility = serializers.ChoiceField([("visible", "Visible"), ("hidden", "Hidden")]).run_validation(visibility)
        rows = rows.filter(is_hidden=visibility == "hidden")
    rating = request.query_params.get("rating")
    if rating:
        rows = rows.filter(rating=serializers.IntegerField(min_value=1, max_value=5).run_validation(rating))
    return Response(ManagedReviewSerializer(rows, many=True).data)


@api_view(["POST"])
@permission_classes([management_access(POST=(*REVIEW_READ, "change_review"))])
@handle_database_contention
@transaction.atomic
def review_visibility(request, pk):
    serializer = ChangeReviewVisibility(data=request.data)
    serializer.is_valid(raise_exception=True)
    review = get_object_or_404(managed_reviews(), pk=pk)
    review.is_hidden = serializer.validated_data["hidden"]
    review.save(update_fields=["is_hidden", "updated_at"])
    return Response(ManagedReviewSerializer(review).data)


@api_view(["DELETE"])
@permission_classes([management_access(DELETE=("view_review", "delete_review"))])
@handle_database_contention
def review_delete(request, pk):
    review = get_object_or_404(Review, pk=pk)
    review.delete()
    return Response(status=204)
