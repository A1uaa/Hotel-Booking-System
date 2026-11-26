from django.urls import path
from . import account_views as views

urlpatterns = [
    path("profile/", views.profile),
    path("profile/photo/", views.profile_photo),
    path("password/", views.password),
    path("favorites/", views.favorites),
    path("favorites/<int:pk>/", views.favorite),
    path("reviews/", views.my_reviews),
    path("reviews/<int:pk>/", views.own_review),
    path("payments/", views.payments),
    path("notifications/", views.notifications),
    path("notifications/read-all/", views.read_notifications),
    path("notifications/<int:pk>/read/", views.read_notifications),
]

