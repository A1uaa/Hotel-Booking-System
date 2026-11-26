import django.core.validators
import django.db.models.deletion
from django.db import migrations, models

UNITS = [("per_stay", "Per stay"), ("per_night", "Per night"), ("per_guest_night", "Per guest, per night")]


class Migration(migrations.Migration):
    dependencies = [("hotel", "0005_room_reviews")]

    operations = [
        migrations.CreateModel(
            name="Extra",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("code", models.SlugField(max_length=50, unique=True)),
                ("name", models.CharField(max_length=100)),
                ("description", models.CharField(blank=True, default="", max_length=200)),
                ("unit", models.CharField(choices=UNITS, default="per_stay", max_length=20)),
                ("is_active", models.BooleanField(default=True)),
            ],
        ),
        migrations.CreateModel(
            name="ExtraPrice",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("price", models.DecimalField(decimal_places=2, default=0, max_digits=12, validators=[
                    django.core.validators.MinValueValidator(0)])),
                ("included", models.BooleanField(default=False)),
                ("extra", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE, related_name="prices", to="hotel.extra")),
                ("room_type", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE, related_name="extra_prices", to="hotel.roomtype")),
            ],
            options={"constraints": [
                models.CheckConstraint(condition=models.Q(("price__gte", 0)), name="extra_price_nonnegative"),
                models.UniqueConstraint(fields=("extra", "room_type"), name="one_price_per_extra_and_room_type"),
            ]},
        ),
        migrations.CreateModel(
            name="BookingExtra",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("name", models.CharField(max_length=100)),
                ("unit", models.CharField(choices=UNITS, max_length=20)),
                ("unit_price", models.DecimalField(decimal_places=2, max_digits=12, validators=[
                    django.core.validators.MinValueValidator(0)])),
                ("included", models.BooleanField(default=False)),
                ("amount", models.DecimalField(decimal_places=2, max_digits=12, validators=[
                    django.core.validators.MinValueValidator(0)])),
                ("booking", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE, related_name="extras", to="hotel.booking")),
                ("extra", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="booking_extras", to="hotel.extra")),
            ],
            options={"constraints": [
                models.CheckConstraint(condition=models.Q(("amount__gte", 0)), name="booking_extra_amount_nonnegative"),
                models.UniqueConstraint(fields=("booking", "extra"), name="one_booking_extra_per_extra"),
            ]},
        ),
    ]
