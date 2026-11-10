from rest_framework.permissions import BasePermission

HOTEL_MODELS = ("room", "roomtype", "roomimage", "booking", "payment")


def staff_access(user):
    return user.is_authenticated and user.is_active and user.is_staff and any(
        user.has_perm(f"hotel.{action}_{model}")
        for model in HOTEL_MODELS for action in ("view", "add", "change", "delete")
    )


def allowed(user, *permissions):
    return user.has_perms([(permission if "." in permission else f"hotel.{permission}") for permission in permissions])


def management_access(**methods):
    class ManagementPermission(BasePermission):
        def has_permission(self, request, view):
            return staff_access(request.user) and allowed(
                request.user, *methods.get(request.method, methods.get("GET", ()))
            )

    return ManagementPermission


def capabilities(user):
    return {
        "dashboard": allowed(user, "view_room", "view_booking", "view_payment"),
        "rooms": allowed(user, "view_room", "view_roomtype"),
        "addRoom": allowed(user, "add_room", "view_room", "view_roomtype"),
        "changeRoom": allowed(user, "change_room", "view_room", "view_roomtype"),
        "deleteRoom": allowed(user, "delete_room", "view_room", "view_roomtype"),
        "addPhoto": allowed(user, "add_roomimage", "view_room"),
        "changePhoto": allowed(user, "change_roomimage", "view_room"),
        "deletePhoto": allowed(user, "delete_roomimage", "view_room"),
        "reservations": allowed(user, "view_booking"),
        "changeBooking": allowed(user, "view_booking", "change_booking"),
        "guests": allowed(user, "view_booking", "auth.view_user"),
        "reports": allowed(user, "view_room", "view_booking", "view_payment"),
    }
