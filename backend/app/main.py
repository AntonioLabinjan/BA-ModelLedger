import hashlib
import json
import tempfile

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from . import chain, config, storage
from .canonical import canonical_bytes, sha256_hex
from .schema import validate_manifest

app = FastAPI(title="ModelLedger API", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_methods=["*"], allow_headers=["*"])


@app.exception_handler(chain.ChainError)
async def _chain_err(_: Request, e: chain.ChainError):
    return JSONResponse(status_code=503, content={"detail": f"Blockchain error: {e}"})


@app.exception_handler(storage.StorageError)
async def _storage_err(_: Request, e: storage.StorageError):
    return JSONResponse(status_code=502, content={"detail": f"Storage error: {e}"})


def _hash_upload(f: UploadFile) -> tuple[str, int]:
    """Stream-hash an upload; enforces the size limit. Leaves file pointer at 0."""
    h, n, limit = hashlib.sha256(), 0, config.MAX_UPLOAD_MB * 1024 * 1024
    f.file.seek(0)
    while chunk := f.file.read(1 << 20):
        n += len(chunk)
        if n > limit:
            raise HTTPException(413, f"File exceeds {config.MAX_UPLOAD_MB} MB limit")
        h.update(chunk)
    f.file.seek(0)
    if n == 0:
        raise HTTPException(400, "Uploaded file is empty")
    return h.hexdigest(), n


@app.get("/api/health")
def health():
    out = {"storage": storage.mode()}
    try:
        chain._contract()
        out["chain"] = "ok"
    except chain.ChainError as e:
        out["chain"] = f"error: {e}"
    return out


@app.get("/api/config")
def get_config():
    return {**chain.deployment_info(), "storageMode": storage.mode()}


@app.post("/api/prepare")
def prepare(artifact: UploadFile = File(...), manifest: str = Form(...)):
    """Hash artifact -> build/validate manifest -> upload artifact + canonical manifest. Does NOT touch the chain."""
    try:
        raw = json.loads(manifest)
        if not isinstance(raw, dict):
            raise ValueError("manifest must be a JSON object")
    except ValueError as e:
        raise HTTPException(400, f"Invalid manifest JSON: {e}")
    sha, size = _hash_upload(artifact)
    cid_a = storage.add(artifact.file)
    raw.setdefault("artifacts", {})
    raw["artifacts"].update(
        {"model_sha256": sha, "filename": artifact.filename, "size_bytes": size, "artifact_cid": cid_a}
    )
    try:
        valid = validate_manifest(raw)
    except ValidationError as e:
        raise HTTPException(422, detail=json.loads(e.json()))
    data = canonical_bytes(valid)
    cid_m = storage.add(data)
    return {
        "artifactSha256": sha, "artifactCid": cid_a, "sizeBytes": size,
        "metadataSha256": sha256_hex(data), "metadataCid": cid_m,
        "manifest": json.loads(data), "storageMode": storage.mode(),
    }


@app.get("/api/models")
def models():
    return chain.list_models()


@app.get("/api/versions/recent")
def recent(limit: int = 10):
    return chain.recent_versions(min(max(limit, 1), 50))


@app.get("/api/models/{model_id}")
def model(model_id: str):
    m = chain.get_model_full(model_id)
    if m is None:
        raise HTTPException(404, "Model not found on-chain")
    return m


@app.get("/api/models/{model_id}/versions/{number}/manifest")
def manifest_of(model_id: str, number: int):
    refs = chain.verify_refs(model_id, number)
    if refs is None:
        raise HTTPException(404, "Model/version not found on-chain")
    data = storage.cat(refs["cid"])
    return {
        "refs": refs,
        "metadataIntact": sha256_hex(data) == refs["metadataHash"],  # bytes on IPFS vs on-chain hash
        "manifest": json.loads(data),
    }


@app.get("/api/models/{model_id}/versions/{number}/artifact")
def download_artifact(model_id: str, number: int):
    refs = chain.verify_refs(model_id, number)
    if refs is None:
        raise HTTPException(404, "Model/version not found on-chain")
    mf = json.loads(storage.cat(refs["cid"]))
    cid = mf.get("artifacts", {}).get("artifact_cid")
    if not cid:
        raise HTTPException(404, "Manifest has no artifact CID")
    name = mf["artifacts"].get("filename") or "artifact.bin"
    return StreamingResponse(
        storage.stream(cid), media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{name}"'},
    )


@app.post("/api/verify")
def verify(file: UploadFile = File(...), model_id: str = Form(...), version: int = Form(0)):
    """Compare an uploaded file's SHA-256 against the on-chain artifact hash (authoritative)."""
    refs = chain.verify_refs(model_id, version)
    if refs is None:
        raise HTTPException(404, "Model/version not found on-chain")
    sha, size = _hash_upload(file)
    manifest_check = {"ok": None, "detail": None}
    try:
        data = storage.cat(refs["cid"])
        meta_ok = sha256_hex(data) == refs["metadataHash"]
        mf_hash = json.loads(data).get("artifacts", {}).get("model_sha256")
        manifest_check = {
            "ok": meta_ok and mf_hash == refs["artifactHash"],
            "detail": None if meta_ok else "Stored manifest does not match on-chain metadata hash",
        }
    except (storage.StorageError, ValueError) as e:
        manifest_check["detail"] = f"Manifest check skipped: {e}"
    return {
        "verified": sha == refs["artifactHash"],
        "computedSha256": sha, "onchainSha256": refs["artifactHash"], "sizeBytes": size,
        "modelId": model_id, "version": refs["version"], "owner": refs["owner"],
        "manifestCheck": manifest_check,
    }
