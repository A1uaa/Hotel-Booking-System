import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models
from django.db.models import F


def backfill(apps, schema_editor):
    Payment = apps.get_model("hotel", "Payment")
    Payment.objects.filter(payment_method__icontains="cash").update(method="cash")
    Payment.objects.filter(status="paid").update(paid_at=F("created_at"))


def overpayment_trigger(name, event, *, exclude_current=False):
    exclude = "AND id <> NEW.id" if exclude_current else ""
    return f"""
        CREATE TRIGGER {name} BEFORE {event} ON hotel_payment
        WHEN NEW.status = 'paid' AND ROUND(
            COALESCE((
                SELECT SUM(amount) FROM hotel_payment
                WHERE booking_id = NEW.booking_id AND status = 'paid' {exclude}
            ), 0) + NEW.amount, 2
        ) > ROUND((SELECT total_price FROM hotel_booking WHERE id = NEW.booking_id), 2)
        BEGIN
            SELECT RAISE(ABORT, 'Payments exceed the booking total');
        END;
    """


class Migration(migrations.Migration):
    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("hotel", "0002_booking_overlap_guards"),
    ]

    operations = [
        migrations.AddField(
            model_name="payment", name="method",
            field=models.CharField(
                choices=[("card", "Card"), ("cash", "Cash"), ("prepayment", "Prepayment")],
                default="card", max_length=20,
            ),
        ),
        migrations.AddField(
            model_name="payment", name="note",
            field=models.CharField(blank=True, default="", max_length=255),
        ),
        migrations.AddField(
            model_name="payment", name="paid_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="payment", name="recorded_by",
            field=models.ForeignKey(
                blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                related_name="recorded_payments", to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name="payment", name="updated_at",
            field=models.DateTimeField(auto_now=True, default=django.utils.timezone.now),
            preserve_default=False,
        ),
        migrations.AlterField(
            model_name="payment", name="status",
            field=models.CharField(
                choices=[
                    ("pending", "Pending"), ("paid", "Paid"), ("failed", "Failed"),
                    ("refunded", "Refunded"), ("cancelled", "Cancelled"),
                ],
                default="pending", max_length=20,
            ),
        ),
        migrations.RunPython(backfill, migrations.RunPython.noop),
        # Database-level backstop: paid payments can never add up to more than the booking total.
        migrations.RunSQL(
            sql=overpayment_trigger("hotel_payment_no_overpay_insert", "INSERT"),
            reverse_sql="DROP TRIGGER hotel_payment_no_overpay_insert;",
        ),
        migrations.RunSQL(
            sql=overpayment_trigger(
                "hotel_payment_no_overpay_update", "UPDATE OF amount, status, booking_id", exclude_current=True
            ),
            reverse_sql="DROP TRIGGER hotel_payment_no_overpay_update;",
        ),
    ]
