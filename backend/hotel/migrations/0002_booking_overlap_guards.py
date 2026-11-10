from django.db import migrations


def overlap_trigger(name, event, *, exclude_current=False):
    exclude = 'AND booking.id <> OLD.id' if exclude_current else ''
    return f"""
        CREATE TRIGGER {name} BEFORE {event} ON hotel_booking
        WHEN NEW.status <> 'cancelled' AND EXISTS (
            SELECT 1 FROM hotel_booking AS booking
            WHERE booking.id <> NEW.id
              AND booking.room_id = NEW.room_id
              AND booking.status <> 'cancelled'
              AND booking.check_in < NEW.check_out
              AND booking.check_out > NEW.check_in
        )
        BEGIN
            SELECT RAISE(ABORT, 'Overlapping hotel booking');
        END;
    """


class Migration(migrations.Migration):
    dependencies = [("hotel", "0001_initial")]

    operations = [
        migrations.RunSQL(
            sql=overlap_trigger("hotel_booking_no_overlap_insert", "INSERT"),
            reverse_sql="DROP TRIGGER hotel_booking_no_overlap_insert;",
        ),
        migrations.RunSQL(
            sql=overlap_trigger(
                "hotel_booking_no_overlap_update", "UPDATE OF room_id, check_in, check_out, status", exclude_current=True
            ),
            reverse_sql="DROP TRIGGER hotel_booking_no_overlap_update;",
        ),
    ]
