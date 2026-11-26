from contextvars import ContextVar
from django.db import transaction, OperationalError
from django.http import JsonResponse
import sqlite3
from django.db.models.signals import pre_save, post_save, post_delete
from django.dispatch import receiver
from hotel.models import AuditLog, Booking, Notification, Payment, Review, Room

actor = ContextVar("hotel_actor", default=None)

class EventContextMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response
    def __call__(self, request):
        token = actor.set(request.user if request.user.is_authenticated else None)
        try:
            if request.method not in ("GET", "HEAD", "OPTIONS"):
                with transaction.atomic():
                    response = self.get_response(request)
                    # A declined simulated payment is a valid, persisted ledger event.
                    if response.status_code >= 400 and response.status_code != 402:
                        transaction.set_rollback(True)
                    return response
            return self.get_response(request)
        except OperationalError as exc:
            code = getattr(exc.__cause__, "sqlite_errorcode", 0)
            if (code & 0xff) in (sqlite3.SQLITE_BUSY, sqlite3.SQLITE_LOCKED):
                return JsonResponse({"detail": "The database is busy. Please try again."}, status=503)
            raise
        finally:
            actor.reset(token)

def audit(action, instance, description=""):
    user = actor.get()
    if user and user.is_staff:
        AuditLog.objects.create(
            administrator=user, action=action, entity_type=instance._meta.model_name,
            entity_id=str(instance.pk), description=description or action,
        )

def notify(user_id, key, instance, version, path):
    anchor = instance._meta.model_name
    if key == "review.available":
        anchor = "stay"
    path = f"{path}#{anchor}-{instance.pk}"
    Notification.objects.get_or_create(
        recipient_id=user_id, event_key=f"{instance._meta.label}:{instance.pk}:{key}:{version}",
        defaults={"kind": key, "parameters": {"id": instance.pk}, "path": path},
    )

def staff_notify(permission, key, instance, version, path):
    from django.contrib.auth import get_user_model
    for user in get_user_model().objects.filter(is_staff=True, is_active=True).iterator():
        if user.has_perm(permission) and (permission != "hotel.view_payment" or user.has_perm("hotel.view_booking")):
            notify(user.pk, key, instance, version, path)

@receiver(pre_save, sender=Booking)
@receiver(pre_save, sender=Payment)
@receiver(pre_save, sender=Review)
@receiver(pre_save, sender=Room)
def snapshot(sender, instance, **kwargs):
    instance._previous = sender.objects.filter(pk=instance.pk).values().first() if instance.pk else None

@receiver(post_save, sender=Booking)
@receiver(post_save, sender=Payment)
@receiver(post_save, sender=Review)
@receiver(post_save, sender=Room)
def changed(sender, instance, created, **kwargs):
    old = getattr(instance, "_previous", None) or {}
    version = instance.updated_at.isoformat()
    if sender == Room:
        if created:
            audit("room.created", instance)
        else:
            for field, action in (("status", "room.status"), ("price_per_night", "room.price")):
                if old.get(field) != getattr(instance, field):
                    audit(action, instance)
            audit("room.updated", instance)
    elif sender == Booking and (created or old.get("status") != instance.status):
        key = "booking.created" if created else "booking." + instance.status
        audit(key, instance)
        notify(instance.user_id, key, instance, version, "/account/bookings")
        if instance.status == "checked_out":
            notify(instance.user_id, "review.available", instance, version, "/account/reviews")
        if created or instance.status == "cancelled":
            staff_notify("hotel.view_booking", key, instance, version, "/admin/reservations")
    elif sender == Payment and (created or old.get("status") != instance.status):
        key = "payment." + instance.status
        audit(key, instance)
        notify(instance.booking.user_id, key, instance, version, "/account/payments")
        staff_notify("hotel.view_payment", key, instance, version, "/admin/payments")
    elif sender == Review:
        if created:
            staff_notify("hotel.view_review", "review.submitted", instance, version, "/admin/reviews")
        elif old.get("is_hidden") != instance.is_hidden:
            audit("review.hidden" if instance.is_hidden else "review.restored", instance)

@receiver(post_delete, sender=Room)
@receiver(post_delete, sender=Review)
def deleted(sender, instance, **kwargs):
    audit(instance._meta.model_name + ".deleted", instance)

