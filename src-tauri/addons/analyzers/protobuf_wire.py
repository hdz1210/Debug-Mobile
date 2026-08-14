from __future__ import annotations

from dataclasses import dataclass
from typing import Final

MAX_FIELDS: Final = 100_000


class ProtobufDecodeError(ValueError):
    """Raised when a protobuf wire stream is malformed or truncated."""


@dataclass(frozen=True, slots=True)
class WireField:
    number: int
    wire_type: int
    value: int | bytes


def _read_varint(data: bytes, offset: int) -> tuple[int, int]:
    value = 0
    for shift in range(0, 70, 7):
        if offset >= len(data):
            raise ProtobufDecodeError("truncated varint")
        byte = data[offset]
        offset += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            if shift == 63 and byte > 1:
                raise ProtobufDecodeError("varint exceeds 64 bits")
            return value, offset
    raise ProtobufDecodeError("varint exceeds 64 bits")


def decode_message(data: bytes) -> list[WireField]:
    """Decode protobuf wire fields without requiring a generated schema."""

    fields: list[WireField] = []
    offset = 0
    while offset < len(data):
        if len(fields) >= MAX_FIELDS:
            raise ProtobufDecodeError("message contains too many fields")

        key, offset = _read_varint(data, offset)
        number = key >> 3
        wire_type = key & 0x07
        if number == 0:
            raise ProtobufDecodeError("field number zero is invalid")

        if wire_type == 0:
            value, offset = _read_varint(data, offset)
        elif wire_type == 1:
            end = offset + 8
            if end > len(data):
                raise ProtobufDecodeError("truncated fixed64 field")
            value = data[offset:end]
            offset = end
        elif wire_type == 2:
            length, offset = _read_varint(data, offset)
            end = offset + length
            if end > len(data):
                raise ProtobufDecodeError("truncated length-delimited field")
            value = data[offset:end]
            offset = end
        elif wire_type == 5:
            end = offset + 4
            if end > len(data):
                raise ProtobufDecodeError("truncated fixed32 field")
            value = data[offset:end]
            offset = end
        elif wire_type in {3, 4}:
            raise ProtobufDecodeError("deprecated protobuf groups are unsupported")
        else:
            raise ProtobufDecodeError(f"unsupported wire type {wire_type}")

        fields.append(WireField(number=number, wire_type=wire_type, value=value))

    return fields


def signed_int64(value: int) -> int:
    return value - (1 << 64) if value >= 1 << 63 else value
