import django.core.validators
import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    """Reviews belong to a room instead of a finished booking, so any visitor can leave one.

    The earlier booking-based reviews are dropped: they were tied to a stay and cannot be
    carried over without inventing an author.
    """

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ("hotel", "0004_review"),
    ]

    operations = [
        migrations.DeleteModel(name="Review"),
        migrations.CreateModel(
            name="Review",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("author_name", models.CharField(default="Guest", max_length=80)),
                ("rating", models.PositiveSmallIntegerField(validators=[
                    django.core.validators.MinValueValidator(1), django.core.validators.MaxValueValidator(5),
                ])),
                ("comment", models.TextField(blank=True, default="", max_length=2000)),
                ("is_hidden", models.BooleanField(default=False)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("room", models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE, related_name="reviews", to="hotel.room",
                )),
                ("user", models.ForeignKey(
                    blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                    related_name="reviews", to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                "constraints": [
                    models.CheckConstraint(
                        condition=models.Q(("rating__gte", 1), ("rating__lte", 5)),
                        name="review_rating_between_1_and_5",
                    ),
                    models.UniqueConstraint(
                        condition=models.Q(("user__isnull", False)),
                        fields=("room", "user"),
                        name="one_review_per_user_per_room",
                    ),
                ],
            },
        ),
    ]
