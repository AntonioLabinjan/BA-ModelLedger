import hashlib
import io

import pytest

from app import config, storage
from app.canonical import canonical_bytes, manifest_hash, sha256_hex
from app.schema import validate_manifest


def test_canonical_key_order_and_whitespace():
    a = {"b": 1, "a": {"y": 2, "x": [1, 2]}}
    b = {"a": {"x": [1, 2], "y": 2}, "b": 1}
    assert canonical_bytes(a) == canonical_bytes(b) == b'{"a":{"x":[1,2],"y":2},"b":1}'


def test_canonical_numbers():
    assert canonical_bytes({"v": 94.0}) == b'{"v":94}'
    assert canonical_bytes({"v": 0.00001}) == b'{"v":0.00001}'
    assert canonical_bytes({"v": 1e-4}) == b'{"v":0.0001}'
    assert canonical_bytes({"v": 0.1}) == b'{"v":0.1}'
    assert canonical_bytes({"v": True}) == b'{"v":true}'
    with pytest.raises(ValueError):
        canonical_bytes({"v": float("nan")})


def test_null_equals_missing():
    assert manifest_hash({"a": 1, "b": None}) == manifest_hash({"a": 1})


def test_unicode_not_escaped():
    assert canonical_bytes({"k": "é"}) == '{"k":"é"}'.encode()


def test_schema_accepts_extras_and_missing_metrics():
    m = validate_manifest({
        "model": {"name": "X", "version": "1", "architecture": "Transformer", "framework": "JAX", "flops": 3},
        "training": {"warmup_steps": 100},
        "evaluation": {"accuracy": 0.9, "bleu": 31.2},
    })
    assert m["evaluation"]["bleu"] == 31.2 and m["evaluation"]["eer"] is None


def test_schema_rejects_bad_input():
    with pytest.raises(Exception):
        validate_manifest({"model": {"name": "", "version": "1", "architecture": "a", "framework": "f"}})
    with pytest.raises(Exception):
        validate_manifest({"model": {"name": "n", "version": "1", "architecture": "a", "framework": "f"},
                           "evaluation": {"accuracy": "high"}})


def test_local_store_roundtrip_and_detects_tamper(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "LOCAL_STORE_DIR", tmp_path)
    monkeypatch.setattr(storage, "ipfs_alive", lambda: False)
    cid = storage.add(b"hello")
    assert cid == storage.raw_cid_v1(hashlib.sha256(b"hello").digest())
    assert storage.cat(cid) == b"hello"
    assert storage.add(io.BytesIO(b"hello")) == cid
    (tmp_path / cid).write_bytes(b"tampered")
    with pytest.raises(storage.StorageError):
        storage.cat(cid)
    with pytest.raises(storage.StorageError):
        storage.cat("bafkreinotthere")
