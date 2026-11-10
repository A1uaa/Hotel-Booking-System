from django.urls import path
from . import management_views as views

urlpatterns = [
    path("login/", views.admin_login),
    path("me/", views.admin_me),
    path("dashboard/", views.overview),
    path("rooms/", views.rooms),
    path("room-types/", views.room_types),
    path("rooms/<int:pk>/", views.room_detail),
    path("rooms/<int:pk>/photos/", views.upload_photo),
    path("rooms/<int:pk>/photos/<int:photo_id>/", views.photo_detail),
    path("reservations/", views.reservations),
    path("reservations/<int:pk>/", views.reservation),
    path("reservations/<int:pk>/status/", views.reservation_status),
    path("guests/", views.guests),
    path("guests/<int:pk>/", views.guest),
    path("front-desk/", views.front_desk),
    path("front-desk/<int:pk>/check-in/", views.check_in),
    path("front-desk/<int:pk>/check-out/", views.check_out),
    path("reports/", views.report),
]
