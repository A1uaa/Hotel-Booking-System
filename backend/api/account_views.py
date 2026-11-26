from io import BytesIO
from uuid import uuid4

from django.contrib.auth import update_session_auth_hash
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.files.base import ContentFile
from django.db import transaction
from django.db.models import BooleanField, Value, Q, Case, When
from django.shortcuts import get_object_or_404
from django.utils import timezone
from PIL import Image
from rest_framework import serializers
from rest_framework.decorators import api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response

from hotel.models import AuditLog, Booking, Favorite, Notification, Payment, Review, Room, UserProfile
from .account_serializers import OwnReviewSerializer, PasswordInput, ProfileInput, profile_data
from .management_permissions import management_access
from .serializers import PaymentSerializer, RoomSerializer, ReviewInputSerializer, BookingSerializer
from .services import handle_database_contention, with_ratings, with_payment_totals


@api_view(["GET", "PATCH"])
@permission_classes([IsAuthenticated])
@handle_database_contention
def profile(request):
    user = request.user
    if request.method == "PATCH":
        serializer = ProfileInput(data=request.data)
        serializer.is_valid(raise_exception=True)
        with transaction.atomic():
            account, _ = UserProfile.objects.get_or_create(user=user)
            for field in ("first_name", "last_name"):
                if field in serializer.validated_data:
                    setattr(user, field, serializer.validated_data[field])
            user.save(update_fields=["first_name", "last_name"])
            for field in ("phone", "preferred_language"):
                if field in serializer.validated_data:
                    setattr(account, field, serializer.validated_data[field])
            account.save()
    return Response(profile_data(user, request))


@api_view(["POST", "DELETE"])
@permission_classes([IsAuthenticated])
@handle_database_contention
def profile_photo(request):
    account, _ = UserProfile.objects.get_or_create(user=request.user)
    old_name = account.photo.name
    storage = account.photo.storage
    new_name = None
    try:
        with transaction.atomic():
            if request.method == "DELETE":
                account.photo = ""
            else:
                upload = request.FILES.get("photo")
                if not upload or upload.size > 5 * 1024 * 1024:
                    raise ValidationError({"photo": "Select an image up to 5 MB."})
                try:
                    with Image.open(upload) as image:
                        if image.format not in {"JPEG", "PNG", "WEBP"} or image.width * image.height > 25_000_000:
                            raise ValueError()
                        output = BytesIO()
                        image.save(output, format=image.format)
                        account.photo.save(f"{uuid4().hex}.{image.format.lower()}", ContentFile(output.getvalue()), save=False)
                        new_name = account.photo.name
                except (OSError, ValueError, Image.DecompressionBombError) as exc:
                    raise ValidationError({"photo": "Select a valid JPEG, PNG, or WebP image."}) from exc
            account.save()
            if old_name:
                transaction.on_commit(lambda: storage.delete(old_name), robust=True)
    except Exception:
        if new_name:
            storage.delete(new_name)
        raise
    return Response(profile_data(request.user, request))


@api_view(["POST"])
@permission_classes([IsAuthenticated])
@handle_database_contention
def password(request):
    data = PasswordInput(data=request.data)
    data.is_valid(raise_exception=True)
    fields = data.validated_data
    if not request.user.check_password(fields["current_password"]):
        raise ValidationError({"current_password": "The current password is incorrect."})
    if fields["new_password"] != fields["confirmation"]:
        raise ValidationError({"confirmation": "Passwords do not match."})
    try:
        validate_password(fields["new_password"], request.user)
    except DjangoValidationError as exc:
        raise ValidationError({"new_password": exc.messages}) from exc
    request.user.set_password(fields["new_password"])
    request.user.save(update_fields=["password"])
    update_session_auth_hash(request, request.user)
    return Response({"status": "ok"})


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def favorites(request):
    rooms = with_ratings(Room.objects.filter(favorites__user=request.user).select_related("room_type").prefetch_related("images"))
    rooms = rooms.annotate(available=Case(When(status=Room.Status.AVAILABLE,then=Value(True)),default=Value(False),output_field=BooleanField()))
    return Response(RoomSerializer(rooms, many=True, context={"request": request}).data)


@api_view(["POST", "DELETE"])
@permission_classes([IsAuthenticated])
@handle_database_contention
def favorite(request, pk):
    room = get_object_or_404(Room, pk=pk)
    if request.method == "POST":
        Favorite.objects.get_or_create(user=request.user, room=room)
        return Response({"room": pk, "saved": True})
    Favorite.objects.filter(user=request.user, room=room).delete()
    return Response(status=204)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def my_reviews(request):
    reviews = Review.objects.filter(user=request.user).select_related("room", "booking").order_by("-created_at")
    eligible = Booking.objects.filter(user=request.user, status=Booking.Status.CHECKED_OUT, review__isnull=True)
    return Response({
        "reviews": OwnReviewSerializer(reviews, many=True).data,
        "eligible": BookingSerializer(eligible, many=True).data,
    })


@api_view(["PATCH", "DELETE"])
@permission_classes([IsAuthenticated])
@handle_database_contention
def own_review(request, pk):
    row = get_object_or_404(Review, pk=pk, user=request.user)
    if request.method == "DELETE":
        row.delete()
        return Response(status=204)
    serializer = ReviewInputSerializer(data=request.data, partial=True)
    serializer.is_valid(raise_exception=True)
    for field in ("rating", "comment"):
        if field in serializer.validated_data:
            setattr(row, field, serializer.validated_data[field])
    row.save(update_fields=["rating", "comment", "updated_at"])
    return Response(OwnReviewSerializer(row).data)


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def payments(request):
    rows = Payment.objects.filter(booking__user=request.user).select_related("booking__room").order_by("-created_at", "-pk")
    status = request.query_params.get("status")
    if status:
        rows = rows.filter(status=serializers.ChoiceField(Payment.Status.choices).run_validation(status))
    data = PaymentSerializer(rows, many=True).data
    for item, row in zip(data, rows):
        item["room_number"] = row.booking.room.room_number
    return Response({
        "payments": data,
        "bookings": BookingSerializer(with_payment_totals(Booking.objects.filter(user=request.user)), many=True).data,
    })


@api_view(["GET"])
@permission_classes([IsAuthenticated])
def notifications(request):
    own = Notification.objects.filter(recipient=request.user)
    page = serializers.IntegerField(min_value=1, max_value=1000000).run_validation(request.query_params.get("page", 1))
    return Response({
        "count": own.count(), "page": page,
        "unread": own.filter(is_read=False).count(),
        "results": list(own.order_by("-created_at", "-pk")[(page-1)*25:page*25].values("id", "kind", "parameters", "path", "is_read", "created_at")),
    })


@api_view(["POST"])
@permission_classes([IsAuthenticated])
def read_notifications(request, pk=None):
    rows = Notification.objects.filter(recipient=request.user)
    if pk is not None:
        get_object_or_404(rows, pk=pk)
        rows = rows.filter(pk=pk)
    rows.update(is_read=True)
    return Response({"status": "ok"})


@api_view(["GET"])
def hotel_date(request):
    return Response({"date": timezone.localdate(), "timezone": "Asia/Almaty"})


@api_view(["GET"])
@permission_classes([management_access(GET=("view_auditlog",))])
def audit_log(request):
    rows = AuditLog.objects.select_related("administrator").all()
    query = request.query_params.get("q", "")[:255]
    if query:
        rows = rows.filter(Q(description__icontains=query) | Q(action__icontains=query) | Q(entity_id__icontains=query))
    if request.query_params.get("administrator"):
        rows = rows.filter(administrator_id=serializers.IntegerField(min_value=1).run_validation(request.query_params["administrator"]))
    if request.query_params.get("action"):
        rows = rows.filter(action=request.query_params["action"])
    for name, lookup in (("start", "created_at__date__gte"), ("end", "created_at__date__lte")):
        if request.query_params.get(name):
            rows = rows.filter(**{lookup: serializers.DateField().run_validation(request.query_params[name])})
    page = serializers.IntegerField(min_value=1, max_value=1000000).run_validation(request.query_params.get("page", 1))
    return Response({
        "count": rows.count(), "page": page,
        "results": [{
            "id": row.pk, "administrator": row.administrator.email if row.administrator else "",
            "action": row.action, "entity": f"{row.entity_type} #{row.entity_id}",
            "description": row.description, "created_at": row.created_at,
        } for row in rows[(page - 1) * 25:page * 25]],
    })

