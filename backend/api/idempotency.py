from functools import wraps
from django.db import transaction
from rest_framework.exceptions import ValidationError
from rest_framework.response import Response
from hotel.models import PaymentReceipt

def payment_idempotency(view):
    @wraps(view)
    @transaction.atomic
    def wrapped(request, *args, **kwargs):
        key = request.headers.get("Idempotency-Key") if request.method == "POST" else None
        if key is None:
            return view(request, *args, **kwargs)
        if not 8 <= len(key) <= 100 or not key.isascii():
            raise ValidationError({"idempotency_key": "Supply 8 to 100 ASCII characters."})
        previous = PaymentReceipt.objects.filter(user=request.user, key=key, path=request.path).first()
        if previous:
            response = Response(previous.response, status=previous.status_code)
            response["Cache-Control"] = "no-store"
            return response
        response = view(request, *args, **kwargs)
        if response.status_code in (200, 201, 402):
            PaymentReceipt.objects.create(
                user=request.user, key=key, path=request.path,
                response=response.data, status_code=response.status_code,
            )
        return response
    return wrapped

