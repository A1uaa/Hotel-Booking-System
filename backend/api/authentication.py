from django.contrib.auth import authenticate
from rest_framework.authentication import SessionAuthentication
from rest_framework.exceptions import PermissionDenied

from .serializers import CredentialsSerializer, User


class CsrfSessionAuthentication(SessionAuthentication):
    def authenticate(self, request):
        # Login, registration, and contact writes require CSRF even without a session.
        self.enforce_csrf(request)
        user = request._request.user
        if user.is_active:
            return user, None
        return None


def authenticate_email(request):
    serializer = CredentialsSerializer(data=request.data)
    serializer.is_valid(raise_exception=True)
    credentials = serializer.validated_data
    matches = list(User.objects.filter(email__iexact=credentials["email"]).values_list("username", flat=True)[:2])
    # Django's backend hashes the supplied password even when the username is absent.
    username = matches[0] if len(matches) == 1 else ""
    user = authenticate(request, username=username, password=credentials["password"])
    if user is None:
        raise PermissionDenied("Invalid email or password.")
    return user
