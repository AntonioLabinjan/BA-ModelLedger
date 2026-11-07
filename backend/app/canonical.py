"""Deterministic manifest serialization and hashing.

Rules (ModelLedger Canonical JSON v1):
  1. UTF-8, no BOM, no insignificant whitespace; separators "," and ":".
  2. Object keys sorted by Unicode code point, recursively.
  3. Keys with null values are dropped (an unset optional field == absent field).
  4. Non-finite numbers (NaN/Infinity) are rejected; booleans stay booleans.
  5. Numbers: integers as plain decimal; floats with an integral value (94.0) become integers (94);
     other floats use the shortest round-trip decimal in plain notation (no exponent), e.g. 0.00001.
  6. Strings are emitted unescaped except for the characters JSON requires escaping.
Hash = SHA-256 of the resulting bytes. The same bytes are what gets stored on IPFS.
"""
import hashlib
import json
import math
from decimal import Decimal
from typing import Any


def _number(x: float) -> str:
    if not math.isfinite(x):
        raise ValueError("NaN/Infinity not allowed in manifest")
    if x == int(x) and abs(x) < 2**63:
        return str(int(x))
    d = Decimal(repr(x))
    s = format(d, "f")
    if "." in s:
        s = s.rstrip("0").rstrip(".")
    return s


def _clean(v: Any) -> Any:
    if isinstance(v, dict):
        return {str(k): _clean(x) for k, x in v.items() if x is not None}
    if isinstance(v, (list, tuple)):
        return [_clean(x) for x in v]
    return v


def _emit(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, int):
        return str(v)
    if isinstance(v, float):
        return _number(v)
    if isinstance(v, str):
        return json.dumps(v, ensure_ascii=False)
    if isinstance(v, list):
        return "[" + ",".join(_emit(x) for x in v) + "]"
    if isinstance(v, dict):
        return "{" + ",".join(json.dumps(k, ensure_ascii=False) + ":" + _emit(v[k]) for k in sorted(v)) + "}"
    raise TypeError(f"Unsupported type in manifest: {type(v).__name__}")


def canonical_bytes(manifest: dict) -> bytes:
    return _emit(_clean(manifest)).encode("utf-8")


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def manifest_hash(manifest: dict) -> str:
    return sha256_hex(canonical_bytes(manifest))
