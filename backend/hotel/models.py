from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import MinValueValidator
from django.db import models
from django.utils import timezone


class RoomType(models.Model):
    name = models.CharField(max_length=100, unique=True)
    description = models.TextField()
    amenities = models.JSONField(default=list, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.name


class Room(models.Model):
    class Status(models.TextChoices):
        AVAILABLE = "available", "Available"
        MAINTENANCE = "maintenance", "Maintenance"
        OUT_OF_SERVICE = "out_of_service", "Out of service"

    room_number = models.CharField(max_length=20, unique=True)
    room_type = models.ForeignKey(RoomType, on_delete=models.PROTECT, related_name="rooms")
    description = models.TextField()
    price_per_night = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(0)])
    capacity = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)])
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.AVAILABLE)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(price_per_night__gte=0), name="room_price_nonnegative"),
            models.CheckConstraint(condition=models.Q(capacity__gte=1), name="room_capacity_positive"),
        ]

    def __str__(self):
        return f"Room {self.room_number}"


class RoomImage(models.Model):
    room = models.ForeignKey(Room, on_delete=models.CASCADE, related_name="images")
    image = models.ImageField(upload_to="rooms/")
    is_primary = models.BooleanField(default=False)

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["room"], condition=models.Q(is_primary=True), name="one_primary_image_per_room"),
        ]

    def __str__(self):
        return f"{self.room}: {self.image.name}"


class Booking(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        CONFIRMED = "confirmed", "Confirmed"
        CHECKED_IN = "checked_in", "Checked in"
        CHECKED_OUT = "checked_out", "Checked out"
        CANCELLED = "cancelled", "Cancelled"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="bookings")
    room = models.ForeignKey(Room, on_delete=models.PROTECT, related_name="bookings")
    check_in = models.DateField()
    check_out = models.DateField()
    guest_count = models.PositiveSmallIntegerField(validators=[MinValueValidator(1)])
    price_per_night = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(0)])
    total_price = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(0)])
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(check_in__lt=models.F("check_out")), name="booking_dates_ordered"),
            models.CheckConstraint(condition=models.Q(guest_count__gte=1), name="booking_guest_count_positive"),
            models.CheckConstraint(condition=models.Q(price_per_night__gte=0), name="booking_nightly_price_nonnegative"),
            models.CheckConstraint(condition=models.Q(total_price__gte=0), name="booking_total_price_nonnegative"),
        ]

    @classmethod
    def overlapping(cls, check_in, check_out):
        return cls.objects.filter(
            check_in__lt=check_out, check_out__gt=check_in,
        ).exclude(status=cls.Status.CANCELLED)

    def clean(self):
        super().clean()
        errors = {}
        if self._state.adding and self.check_in and self.check_in < timezone.localdate():
            errors["check_in"] = "Check-in cannot be in the past for a new booking."

        room = Room.objects.filter(pk=self.room_id).first() if self.room_id else None
        if room and self.guest_count is not None and self.guest_count > room.capacity:
            errors["guest_count"] = "Guest count cannot exceed room capacity."

        if (
            self.room_id and self.check_in and self.check_out
            and self.check_in < self.check_out and self.status != self.Status.CANCELLED
            and self.overlapping(self.check_in, self.check_out)
            .filter(room_id=self.room_id).exclude(pk=self.pk).exists()
        ):
            errors["check_in"] = "The room is already booked for those dates."

        if errors:
            raise ValidationError(errors)

    def __str__(self):
        return f"Booking {self.pk} for {self.room}"


class Payment(models.Model):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        PAID = "paid", "Paid"
        FAILED = "failed", "Failed"
        REFUNDED = "refunded", "Refunded"

    booking = models.ForeignKey(Booking, on_delete=models.PROTECT, related_name="payments")
    amount = models.DecimalField(max_digits=12, decimal_places=2, validators=[MinValueValidator(0)])
    payment_method = models.CharField(max_length=50)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.CheckConstraint(condition=models.Q(amount__gte=0), name="payment_amount_nonnegative"),
        ]

    def __str__(self):
        return f"Payment {self.pk} for booking {self.booking_id}"


class ContactMessage(models.Model):
    name = models.CharField(max_length=150)
    email = models.EmailField()
    subject = models.CharField(max_length=200)
    message = models.TextField()
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return self.subject
