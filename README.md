# ModelLedger — Trust the model. Verify the experiment.

Decentralized registry for ML models: artifacts + reproducibility manifests live on IPFS, SHA-256 hashes and
version lineage live on an Ethereum chain (`ModelRegistry.sol`). The FastAPI backend hashes/uploads/verifies and
**reads** authoritative records from the contract; it never writes to the chain. Users sign transactions in MetaMask.

## Prerequisites
Node 18+, Python 3.10+, MetaMask. Optional: a [Kubo](https://docs.ipfs.tech/install/) daemon (`ipfs daemon`).
Without Kubo the backend uses a **dev-only local content-addressed store** (see Limitations); `/api/health` and the UI header show which is active.

## Install
```bash
(cd contracts && npm install)
(cd frontend  && npm install)
pip install -r backend/requirements.txt
```

## Run (4 terminals)
```bash
# 1. local chain (chainId 31337)         2. deploy (writes contracts/deployments/localhost.json)
cd contracts && npx hardhat node         cd contracts && npm run deploy
# 3. backend                              4. frontend  -> http://localhost:5173
cd backend && uvicorn app.main:app --port 8000     cd frontend && npm run dev
# optional: ipfs daemon
```
Re-run step 2 whenever the Hardhat node is restarted (state is in-memory), then reload the UI.

**MetaMask:** import a Hardhat account (`npx hardhat node` prints keys; `.env.example` lists account #0 — a publicly known
key, local use only). The UI adds/switches to the local network (RPC `http://127.0.0.1:8545`, chain `31337`) automatically.
If MetaMask reports nonce errors after restarting the node: Settings → Advanced → *Clear activity tab data*.

## Tests
```bash
(cd contracts && npm test)            # 6 contract tests
(cd backend && python -m pytest -q)   # hashing / schema / storage unit tests
./scripts/run_e2e.sh                  # starts chain+backend, runs the 11-step acceptance workflow via API + signed txs
```

## Demo workflow
1. Connect MetaMask → **Register** → fill fields, choose a model file → *1. Hash & upload* (shows SHA-256s and CIDs) → *2. Register on-chain*.
2. Model appears in **Registry**. Open it → **+ New version** (owner only; prefilled from the previous manifest) → register v2.
3. Model page shows blockchain details, version history, manifest, and **Compare versions** (metric deltas).
4. **Verify** → choose model/version → upload the original file → ✔ VERIFIED. Flip one byte → ✘ FAILED.

## Manifest & hashing
Schema: `backend/app/schema.py` (`modelledger/1.0`; required: model name/version/architecture/framework; all sections accept extra keys;
metrics are free-form numbers; null/blank = omitted). Canonical JSON rules: `backend/app/canonical.py` docstring
(sorted keys, no whitespace, nulls dropped, integral floats → ints, no exponents, NaN rejected). The canonical bytes are
exactly what is stored on IPFS, so `sha256(fetched bytes) == on-chain metadataHash`. The on-chain `cid` is the manifest CID;
the manifest contains the artifact CID and artifact SHA-256.

## Contract (`contracts/contracts/ModelRegistry.sol`)
`registerModel`, `registerVersion(modelId, parentVersion, …)` (parent must equal current latest; owner only; unique label per model;
append-only), `getModel`, `getVersion`, `getVersionHistory`, `verifyModel(modelId, version|0=latest)`, plus `modelCount/listModelIds/computeModelId`.
Model ID = `keccak256(owner, name)`. Events: `ModelRegistered`, `VersionRegistered`.

## API
`GET /api/config|health|models|models/{id}|versions/recent` · `GET /api/models/{id}/versions/{n}/manifest|artifact` ·
`POST /api/prepare` (multipart `artifact`, `manifest` JSON) · `POST /api/verify` (multipart `file`, `model_id`, `version`).

## Environment variables
See `.env.example` (all have working defaults for local dev; nothing secret is required to run the app — the browser wallet holds keys).

## Known limitations
- Browser UI (React + MetaMask) was **built successfully but not exercised in a real browser/MetaMask** in the build environment; the same
  contract calls and API flow are covered by `scripts/e2e.py` using a local signing key.
- The sandbox had no Kubo daemon and no access to IPFS binary hosts, so the **real IPFS path (`/api/v0/add|cat`) is implemented but untested**;
  tests ran against the local fallback store (valid CIDv1 raw/sha2-256, self-verifying, but not on the IPFS network).
- Uploads are buffered by the framework (temp files), 512 MB default limit; large files are hashed in 1 MiB chunks. No resumable uploads, no auth/rate limiting on the API.
- Listing endpoints loop over the contract (fine for MVP scale; use an indexer/event logs for large registries).
- Local Hardhat chain only; no testnet deployment config. Model ID is per-owner+name (same name by another wallet = different model).
- No privacy: everything uploaded is stored (and with real IPFS, publicly retrievable by CID).
