"""Read-only access to ModelRegistry. The contract is the source of truth; the backend never writes."""
import json
from functools import lru_cache

from web3 import Web3
from web3.exceptions import ContractLogicError

from . import config


class ChainError(Exception):
    pass


@lru_cache(maxsize=1)
def _deployment() -> dict:
    if not config.DEPLOYMENT_FILE.is_file():
        raise ChainError(f"Deployment file not found: {config.DEPLOYMENT_FILE}. Run `npm run deploy` in contracts/.")
    return json.loads(config.DEPLOYMENT_FILE.read_text())


def deployment_info() -> dict:
    d = _deployment()
    return {"address": d["address"], "chainId": d["chainId"], "abi": d["abi"], "rpcUrl": config.RPC_URL}


def reset_cache():
    _deployment.cache_clear()


def _contract():
    w3 = Web3(Web3.HTTPProvider(config.RPC_URL, request_kwargs={"timeout": 10}))
    if not w3.is_connected():
        raise ChainError(f"Cannot reach blockchain node at {config.RPC_URL}")
    d = _deployment()
    if not w3.eth.get_code(Web3.to_checksum_address(d["address"])):
        raise ChainError("No contract code at the configured address (node restarted? redeploy the contract).")
    return w3.eth.contract(address=Web3.to_checksum_address(d["address"]), abi=d["abi"])


def _hex(b: bytes) -> str:
    return b.hex()


def _version(t) -> dict:
    return {
        "number": t[0], "parent": t[1], "label": t[2],
        "artifactHash": _hex(t[3]), "metadataHash": _hex(t[4]), "cid": t[5],
        "publisher": t[6], "timestamp": t[7],
    }


def _model(t) -> dict:
    return {"id": "0x" + _hex(t[0]), "name": t[1], "owner": t[2], "createdAt": t[3], "versionCount": t[4]}


def _id(model_id: str) -> bytes:
    try:
        b = bytes.fromhex(model_id.removeprefix("0x"))
    except ValueError as e:
        raise ChainError("Invalid model id") from e
    if len(b) != 32:
        raise ChainError("Invalid model id")
    return b


def get_model(model_id: str) -> dict | None:
    c = _contract()
    try:
        return _model(c.functions.getModel(_id(model_id)).call())
    except ContractLogicError:  # custom error UnknownModel
        return None
    except Exception as e:
        raise ChainError(str(e)) from e


def get_versions(model_id: str) -> list[dict]:
    c = _contract()
    return [_version(t) for t in c.functions.getVersionHistory(_id(model_id)).call()]


def get_model_full(model_id: str) -> dict | None:
    m = get_model(model_id)
    if m is None:
        return None
    m["versions"] = get_versions(model_id)
    return m


def list_models() -> list[dict]:
    c = _contract()
    total = c.functions.modelCount().call()
    ids = c.functions.listModelIds(0, max(total, 1)).call() if total else []
    out = []
    for i in ids:
        m = _model(c.functions.getModel(i).call())
        m["latest"] = _version(c.functions.getVersion(i, m["versionCount"]).call())
        out.append(m)
    return out


def recent_versions(limit: int = 10) -> list[dict]:
    rows = []
    for m in list_models():
        for v in get_versions(m["id"]):
            rows.append({**v, "modelId": m["id"], "modelName": m["name"], "owner": m["owner"]})
    rows.sort(key=lambda r: (r["timestamp"], r["number"]), reverse=True)
    return rows[:limit]


def verify_refs(model_id: str, version: int = 0) -> dict | None:
    """On-chain hash references via verifyModel()."""
    c = _contract()
    try:
        a, m, cid, owner, v = c.functions.verifyModel(_id(model_id), version).call()
    except ContractLogicError:  # UnknownModel / UnknownVersion
        return None
    except Exception as e:
        raise ChainError(str(e)) from e
    return {"artifactHash": _hex(a), "metadataHash": _hex(m), "cid": cid, "owner": owner, "version": v}
