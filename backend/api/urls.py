from django.urls import include, path

from . import views

urlpatterns = [
    path("admin/", include("api.management_urls")),
    path("health/", views.health, name="health"),
    path("auth/csrf/", views.csrf_token, name="api-csrf"),
    path("auth/register/", views.register, name="api-register"),
    path("auth/login/", views.sign_in, name="api-login"),
    path("auth/logout/", views.sign_out, name="api-logout"),
    path("auth/me/", views.me, name="api-me"),
    path("rooms/", views.room_list, name="api-rooms"),
    path("rooms/<int:pk>/", views.room_detail, name="api-room-detail"),
    path("bookings/", views.bookings, name="api-bookings"),
    path("bookings/<int:pk>/", views.booking_detail, name="api-booking-detail"),
    path("bookings/<int:pk>/cancel/", views.booking_cancel, name="api-booking-cancel"),
    path("contact/", views.contact, name="api-contact"),
]
