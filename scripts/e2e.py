"""End-to-end test of the acceptance workflow against a running chain + backend.
Signs transactions with a local test key (the role MetaMask plays in the browser)."""
import os
import sys
from pathlib import Path

import requests
from eth_account import Account
from web3 import Web3

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app.canonical import canonical_bytes, sha256_hex  # noqa: E402

API = os.getenv("API_URL", "http://127.0.0.1:8000")
RPC = os.getenv("RPC_URL", "http://127.0.0.1:8545")
K1 = os.getenv("TEST_PRIVATE_KEY", "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80")
K2 = os.getenv("TEST_PRIVATE_KEY_2", "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d")

passed = 0


def check(name, cond, extra=""):
    global passed
    print(f"  [{'PASS' if cond else 'FAIL'}] {name} {extra}")
    if not cond:
        sys.exit(1)
    passed += 1


w3 = Web3(Web3.HTTPProvider(RPC))
cfg = requests.get(f"{API}/api/config").json()
reg = w3.eth.contract(address=Web3.to_checksum_address(cfg["address"]), abi=cfg["abi"])
alice, bob = Account.from_key(K1), Account.from_key(K2)


def send(acct, fn):
    tx = fn.build_transaction({"from": acct.address, "nonce": w3.eth.get_transaction_count(acct.address), "gas": 2_000_000})
    rc = w3.eth.wait_for_transaction_receipt(w3.eth.send_raw_transaction(acct.sign_transaction(tx).raw_transaction))
    return rc


def manifest(version, acc):
    return {"model": {"name": "VoiceNet", "version": version, "architecture": "CNN", "framework": "PyTorch", "framework_version": "2.3.1"},
            "training": {"optimizer": "Adam", "learning_rate": 0.0001, "batch_size": 16, "epochs": 100, "random_seed": 42},
            "dataset": {"name": "Example Dataset", "version": "1.0"},
            "evaluation": {"accuracy": acc, "f1_score": 0.92, "eer": None},  # eer omitted (optional metric)
            "environment": {"python_version": "3.11", "hardware": "CPU"}}


def prepare(data: bytes, mf: dict, name="model.pth"):
    r = requests.post(f"{API}/api/prepare", files={"artifact": (name, data)}, data={"manifest": __import__("json").dumps(mf)})
    return r


def verify(data: bytes, mid: str, version=0):
    return requests.post(f"{API}/api/verify", files={"file": ("m.pth", data)}, data={"model_id": mid, "version": version})


v1_bytes = os.urandom(300_000)
v2_bytes = os.urandom(300_000)

print("Steps 2-5: upload artifact, hash, manifest, storage")
p1 = prepare(v1_bytes, manifest("1.0.0", 0.94)); check("prepare v1 -> 200", p1.status_code == 200, p1.text[:200] if p1.status_code != 200 else "")
p1 = p1.json()
check("backend artifact hash == independent sha256", p1["artifactSha256"] == sha256_hex(v1_bytes))
check("manifest hash == sha256(canonical bytes)", p1["metadataSha256"] == sha256_hex(canonical_bytes(p1["manifest"])))
check("missing optional metric omitted from manifest", "eer" not in p1["manifest"]["evaluation"])
check("manifest embeds artifact hash", p1["manifest"]["artifacts"]["model_sha256"] == p1["artifactSha256"])

print("Step 6: register model on-chain")
rc = send(alice, reg.functions.registerModel("VoiceNet", "1.0.0", bytes.fromhex(p1["artifactSha256"]), bytes.fromhex(p1["metadataSha256"]), p1["metadataCid"]))
check("registerModel tx succeeded", rc.status == 1)
mid = "0x" + reg.functions.computeModelId(alice.address, "VoiceNet").call().hex()

print("Step 7: model appears in registry")
models = requests.get(f"{API}/api/models").json()
check("model listed by API (read from chain)", any(m["id"] == mid and m["owner"] == alice.address for m in models))

print("Step 8-9: second version + history")
p2 = prepare(v2_bytes, manifest("1.1.0", 0.95)).json()
rc = send(alice, reg.functions.registerVersion(mid, 1, "1.1.0", bytes.fromhex(p2["artifactSha256"]), bytes.fromhex(p2["metadataSha256"]), p2["metadataCid"]))
check("registerVersion tx succeeded", rc.status == 1)
m = requests.get(f"{API}/api/models/{mid}").json()
check("history has 2 versions", [v["label"] for v in m["versions"]] == ["1.0.0", "1.1.0"])
check("v2 references v1 as parent; v1 has none", m["versions"][1]["parent"] == 1 and m["versions"][0]["parent"] == 0)
check("v1 record unchanged after v2", m["versions"][0]["artifactHash"] == p1["artifactSha256"])
for n in (1, 2):
    r = requests.get(f"{API}/api/models/{mid}/versions/{n}/manifest").json()
    check(f"v{n} stored manifest matches on-chain metadata hash", r["metadataIntact"] is True)
dl = requests.get(f"{API}/api/models/{mid}/versions/1/artifact")
check("artifact download returns original bytes", dl.status_code == 200 and dl.content == v1_bytes)

print("Step 10: unchanged file verifies")
r = verify(v1_bytes, mid, 1).json()
check("v1 unchanged -> verified", r["verified"] is True and r["manifestCheck"]["ok"] is True)
check("latest (v2) unchanged -> verified", verify(v2_bytes, mid, 0).json()["verified"] is True)

print("Step 11: modified file fails")
tampered = bytearray(v1_bytes); tampered[1234] ^= 0x01
r = verify(bytes(tampered), mid, 1).json()
check("1-bit change -> verification FAILED", r["verified"] is False and r["computedSha256"] != r["onchainSha256"])
check("v1 file checked against latest (v2) -> FAILED", verify(v1_bytes, mid, 0).json()["verified"] is False)

print("Access control & error handling")
rc = None
try:
    reg.functions.registerVersion(mid, 2, "9.9.9", bytes.fromhex(p2["artifactSha256"]), bytes.fromhex(p2["metadataSha256"]), "x").call({"from": bob.address})
    check("non-owner registerVersion reverts", False)
except Exception as e:
    check("non-owner registerVersion reverts", "NotOwner" in repr(e) or "0x" in repr(e))
check("verify unknown model -> 404", verify(b"x", "0x" + "11" * 32).status_code == 404)
check("verify unknown version -> 404", verify(b"x", mid, 7).status_code == 404)
check("prepare with invalid manifest -> 422", prepare(b"abc", {"model": {"name": ""}}).status_code == 422)
check("prepare with empty file -> 400", prepare(b"", manifest("x", 1)).status_code == 400)
check("prepare with bad JSON -> 400", requests.post(f"{API}/api/prepare", files={"artifact": ("a", b"abc")}, data={"manifest": "{nope"}).status_code == 400)

print(f"\nALL {passed} CHECKS PASSED")
