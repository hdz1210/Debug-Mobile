from __future__ import annotations

from typing import Any, Final

REDACTED_VALUE: Final = "••••••••"

_SENSITIVE_KEYS: Final = {
    "access_token",
    "advertising_id",
    "api_key",
    "api_secret",
    "app_instance_id",
    "authorization",
    "client_id",
    "client_secret",
    "cookie",
    "device_id",
    "email",
    "email_address",
    "idfa",
    "idfv",
    "instance_id",
    "passcode",
    "passwd",
    "password",
    "phone",
    "phone_number",
    "refresh_token",
    "secret",
    "token",
    "user_id",
    "user_pseudo_id",
}


def redact_structured(value: Any, enabled: bool = True) -> Any:
    if not enabled:
        return value
    if isinstance(value, dict):
        return {
            str(key): (
                REDACTED_VALUE
                if str(key).lower() in _SENSITIVE_KEYS
                else redact_structured(item, enabled=True)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_structured(item, enabled=True) for item in value]
    return value


def redact_pair(key: str, value: Any, enabled: bool = True) -> Any:
    if enabled and key.lower() in _SENSITIVE_KEYS:
        return REDACTED_VALUE
    return redact_structured(value, enabled=enabled)
