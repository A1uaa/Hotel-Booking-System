from rest_framework.throttling import UserRateThrottle


class PaymentThrottle(UserRateThrottle):
    """Slows card-guessing: payment attempts are limited per signed-in user (see settings)."""

    scope = "payments"
