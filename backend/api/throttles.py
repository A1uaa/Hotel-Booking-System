from rest_framework.throttling import UserRateThrottle


class PaymentThrottle(UserRateThrottle):
    """Slows card-guessing: payment attempts are limited per signed-in user (see settings)."""

    scope = "payments"


class ReviewThrottle(UserRateThrottle):
    """Limits feedback spam per signed-in user, or per IP address for visitors. Reading is never limited."""

    scope = "reviews"

    def allow_request(self, request, view):
        if request.method != "POST":
            return True
        return super().allow_request(request, view)
