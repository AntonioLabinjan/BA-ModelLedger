"""IPFS storage via the Kubo HTTP RPC API, with an explicit DEV-ONLY local content-addressed fallback.

Fallback CIDs are real CIDv1 (raw codec, sha2-256) computed locally, so they are self-verifying; the data
is NOT on the IPFS network until imported into a node. `mode()` reports which backend is active.
"""
import base64
import hashlib
from pathlib import Path
from typing import BinaryIO

import requests

from . import config


class StorageError(Exception):
    pass


def raw_cid_v1(digest: bytes) -> str:
    # <cidv1=0x01><raw=0x55><sha2-256=0x12><len=0x20><digest>, base32 lower, multibase prefix 'b'
    return "b" + base64.b32encode(b"\x01\x55\x12\x20" + digest).decode().lower().rstrip("=")


def _digest_from_raw_cid(cid: str) -> bytes | None:
    try:
        raw = base64.b32decode(cid[1:].upper() + "=" * (-len(cid[1:]) % 8))
        return raw[4:] if raw[:4] == b"\x01\x55\x12\x20" else None
    except Exception:
        return None


def ipfs_alive() -> bool:
    try:
        return requests.post(f"{config.IPFS_API_URL}/api/v0/version", timeout=2).ok
    except requests.RequestException:
        return False


def mode() -> str:
    if ipfs_alive():
        return "ipfs"
    return "local-fallback" if config.ALLOW_LOCAL_STORE_FALLBACK else "unavailable"


def add(data: bytes | BinaryIO) -> str:
    """Store content, return CID."""
    if ipfs_alive():
        try:
            r = requests.post(
                f"{config.IPFS_API_URL}/api/v0/add",
                params={"cid-version": 1, "raw-leaves": "true", "pin": "true"},
                files={"file": data},
                timeout=600,
            )
            r.raise_for_status()
            return r.json()["Hash"]
        except (requests.RequestException, KeyError, ValueError) as e:
            raise StorageError(f"IPFS add failed: {e}") from e
    if not config.ALLOW_LOCAL_STORE_FALLBACK:
        raise StorageError("IPFS daemon unreachable and local fallback disabled")
    config.LOCAL_STORE_DIR.mkdir(parents=True, exist_ok=True)
    tmp = config.LOCAL_STORE_DIR / f".tmp-{id(data)}"
    h = hashlib.sha256()
    with open(tmp, "wb") as f:
        if isinstance(data, (bytes, bytearray)):
            chunks = [bytes(data)]
        else:
            chunks = iter(lambda: data.read(1 << 20), b"")
        for c in chunks:
            h.update(c)
            f.write(c)
    cid = raw_cid_v1(h.digest())
    tmp.replace(config.LOCAL_STORE_DIR / cid)
    return cid


def path_for_local(cid: str) -> Path:
    return config.LOCAL_STORE_DIR / cid


def cat(cid: str) -> bytes:
    """Fetch content by CID (loads fully into memory; fine for manifests, used for artifacts only in tests)."""
    if ipfs_alive():
        try:
            r = requests.post(f"{config.IPFS_API_URL}/api/v0/cat", params={"arg": cid}, timeout=120)
            r.raise_for_status()
            return r.content
        except requests.RequestException as e:
            raise StorageError(f"IPFS cat failed: {e}") from e
    p = path_for_local(cid)
    if not config.ALLOW_LOCAL_STORE_FALLBACK or not p.is_file():
        raise StorageError(f"Content {cid} not found")
    data = p.read_bytes()
    expect = _digest_from_raw_cid(cid)
    if expect is not None and hashlib.sha256(data).digest() != expect:
        raise StorageError(f"Local store content for {cid} is corrupted")
    return data


def stream(cid: str, chunk: int = 1 << 20):
    """Yield content chunks for downloads."""
    if ipfs_alive():
        try:
            with requests.post(f"{config.IPFS_API_URL}/api/v0/cat", params={"arg": cid}, stream=True, timeout=120) as r:
                r.raise_for_status()
                yield from r.iter_content(chunk)
            return
        except requests.RequestException as e:
            raise StorageError(f"IPFS cat failed: {e}") from e
    p = path_for_local(cid)
    if not config.ALLOW_LOCAL_STORE_FALLBACK or not p.is_file():
        raise StorageError(f"Content {cid} not found")
    with open(p, "rb") as f:
        yield from iter(lambda: f.read(chunk), b"")
