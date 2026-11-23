import django.core.validators
import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("hotel", "0003_payment_methods_and_guards"),
    ]

    operations = [
        migrations.CreateModel(
            name="Review",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("rating", models.PositiveSmallIntegerField(validators=[
                    django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(5),
                ])),
                ("comment", models.TextField(blank=True, default="", max_length=2000)),
                ("is_hidden", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("booking", models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE, related_name="review", to="hotel.booking",
                )),
            ],
            options={
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("rating__gte", 1), ("rating__lte", 5)),
                        name="review_rating_between_1_and_5",
                    ),
                ],
            },
        ),
    ]
