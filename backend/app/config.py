import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

RPC_URL = os.getenv("RPC_URL", "http://127.0.0.1:8545")
DEPLOYMENT_FILE = Path(os.getenv("DEPLOYMENT_FILE", ROOT / "contracts" / "deployments" / "localhost.json"))
IPFS_API_URL = os.getenv("IPFS_API_URL", "http://127.0.0.1:5001")
# DEV ONLY: if the IPFS daemon is unreachable, store content in a local content-addressed directory.
ALLOW_LOCAL_STORE_FALLBACK = os.getenv("ALLOW_LOCAL_STORE_FALLBACK", "true").lower() == "true"
LOCAL_STORE_DIR = Path(os.getenv("LOCAL_STORE_DIR", ROOT / "backend" / ".local_store"))
MAX_UPLOAD_MB = int(os.getenv("MAX_UPLOAD_MB", "512"))
CORS_ORIGINS = [o for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o]
