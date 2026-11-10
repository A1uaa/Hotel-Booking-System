from django.contrib import admin

from .models import Booking, ContactMessage, Payment, Room, RoomImage, RoomType


@admin.register(RoomType)
class RoomTypeAdmin(admin.ModelAdmin):
    list_display = ("name", "created_at")
    search_fields = ("name", "description")
    list_filter = ("created_at",)


@admin.register(Room)
class RoomAdmin(admin.ModelAdmin):
    list_display = ("room_number", "room_type", "price_per_night", "capacity", "status")
    search_fields = ("room_number", "description")
    list_filter = ("room_type", "status", "capacity")


@admin.register(RoomImage)
class RoomImageAdmin(admin.ModelAdmin):
    list_display = ("room", "image", "is_primary")
    search_fields = ("room__room_number", "image")
    list_filter = ("is_primary",)


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    list_display = ("id", "user", "room", "check_in", "check_out", "guest_count", "status")
    search_fields = ("=id", "user__username", "user__email", "room__room_number")
    list_filter = ("status", "check_in", "check_out")


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("id", "booking", "amount", "payment_method", "status", "created_at")
    search_fields = ("=booking__id", "payment_method")
    list_filter = ("status", "payment_method", "created_at")


@admin.register(ContactMessage)
class ContactMessageAdmin(admin.ModelAdmin):
    list_display = ("name", "email", "subject", "created_at")
    search_fields = ("name", "email", "subject", "message")
    list_filter = ("created_at",)
