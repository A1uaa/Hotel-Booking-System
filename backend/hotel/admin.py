from django.contrib import admin

from .models import Booking, BookingExtra, ContactMessage, Extra, ExtraPrice, Payment, Review, Room, RoomImage, RoomType


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


class BookingExtraInline(admin.TabularInline):
    model = BookingExtra
    extra = 0
    readonly_fields = ("extra", "name", "unit", "unit_price", "included", "amount")
    can_delete = False

    def has_add_permission(self, request, obj=None):
        return False


class ExtraPriceInline(admin.TabularInline):
    model = ExtraPrice
    extra = 0


@admin.register(Extra)
class ExtraAdmin(admin.ModelAdmin):
    """Extras and what each room type pays for them. Tick "included" to give it away free."""

    list_display = ("name", "code", "unit", "is_active")
    list_filter = ("unit", "is_active")
    search_fields = ("name", "code")
    inlines = [ExtraPriceInline]


@admin.register(Booking)
class BookingAdmin(admin.ModelAdmin):
    inlines = [BookingExtraInline]
    list_display = ("id", "user", "room", "check_in", "check_out", "guest_count", "status")
    search_fields = ("=id", "user__username", "user__email", "room__room_number")
    list_filter = ("status", "check_in", "check_out")


@admin.register(Payment)
class PaymentAdmin(admin.ModelAdmin):
    list_display = ("id", "booking", "amount", "method", "payment_method", "status", "paid_at", "created_at")
    search_fields = ("=booking__id", "payment_method", "note")
    list_filter = ("status", "method", "created_at")
    readonly_fields = ("created_at", "updated_at", "paid_at", "recorded_by")

    def has_delete_permission(self, request, obj=None):
        # Payments are financial records: refund or cancel them instead of deleting.
        return False


@admin.register(Review)
class ReviewAdmin(admin.ModelAdmin):
    list_display = ("id", "room", "author_name", "rating", "is_hidden", "created_at")
    search_fields = ("room__room_number", "author_name", "comment", "user__email")
    list_filter = ("rating", "is_hidden", "created_at")
    readonly_fields = ("created_at", "updated_at")


@admin.register(ContactMessage)
class ContactMessageAdmin(admin.ModelAdmin):
    list_display = ("name", "email", "subject", "created_at")
    search_fields = ("name", "email", "subject", "message")
    list_filter = ("created_at",)
