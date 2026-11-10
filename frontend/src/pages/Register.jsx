import React, { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../api";
import { useWallet } from "../wallet.jsx";

const blank = {
  name: "", version: "1.0.0", architecture: "", framework: "PyTorch", framework_version: "",
  optimizer: "", learning_rate: "", batch_size: "", epochs: "", random_seed: "",
  dataset_name: "", dataset_version: "", python_version: "", hardware: "", code_commit: "", notes: "",
};
const num = (s) => (s === "" || s === undefined ? undefined : Number(s));
const nonEmpty = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== "" && !Number.isNaN(v)));

function transactionErrorMessage(error, contract) {
  const rpcError = error?.info?.error ?? error?.error;
  const code = error?.code ?? rpcError?.code;
  if (code === 4100 || /not been authorized by the user/i.test(error?.message || "")) {
    return "MetaMask denied this site's request. Click Reconnect MetaMask in the header and approve the account request. If it persists, disconnect this site's origin under MetaMask → Connected sites, then reconnect.";
  }
  const rpcData = rpcError?.data;
  const data = error?.data ?? (typeof rpcData === "string" ? rpcData : rpcData?.data);
  if (contract && typeof data === "string" && data.startsWith("0x")) {
    try {
      const decoded = contract.interface.parseError(data);
      if (decoded?.name === "ModelAlreadyExists") {
        return "This wallet already registered a model with that name. Choose another name or add a new version.";
      }
      if (decoded?.name === "DuplicateLabel") {
        return "That version label is already used for this model. Choose a different version label.";
      }
      if (decoded?.name === "NotOwner") {
        return "This wallet does not own the model and cannot register a new version.";
      }
      if (decoded?.name === "WrongParent") {
        return "The model has changed since this page was opened. Reload it and try again.";
      }
      if (decoded?.name === "EmptyField") {
        return "The contract rejected an empty required field. Check the version label and uploaded manifest.";
      }
    } catch { /* The RPC error may not contain a contract revert. */ }
  }

  const details = [error?.reason, rpcError?.message, error?.shortMessage, error?.message]
    .find((message) => typeof message === "string" && !message.toLowerCase().includes("coalesce"));
  return details || "Wallet transaction failed. Check that the local Hardhat node is running on chain 31337, then retry.";
}

function Rows({ rows, setRows, label, numeric }) {
  const upd = (i, k, v) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div>
      <div className="row between"><h4>{label}</h4><button type="button" className="secondary small" onClick={() => setRows([...rows, { k: "", v: "" }])}>+ add</button></div>
      {rows.map((r, i) => (
        <div className="row" key={i}>
          <input placeholder="name" value={r.k} onChange={(e) => upd(i, "k", e.target.value)} />
          <input placeholder={numeric ? "number" : "value"} value={r.v} onChange={(e) => upd(i, "v", e.target.value)} />
          <button type="button" className="secondary small" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button>
        </div>))}
    </div>
  );
}
const rowsToObj = (rows, numeric) => Object.fromEntries(rows.filter((r) => r.k.trim() && r.v !== "").map((r) => [r.k.trim(), numeric || (r.v.trim() !== "" && !isNaN(r.v)) ? Number(r.v) : r.v]));

export default function Register() {
  const [sp] = useSearchParams();
  const parentId = sp.get("model");
  const nav = useNavigate();
  const { account, connect, getContract } = useWallet();
  const [f, setF] = useState(blank);
  const [metrics, setMetrics] = useState([{ k: "accuracy", v: "" }, { k: "f1_score", v: "" }, { k: "eer", v: "" }]);
  const [extra, setExtra] = useState([]);
  const [file, setFile] = useState(null);
  const [prep, setPrep] = useState(null);
  const [parent, setParent] = useState(null);
  const [err, setErr] = useState(null);
  const [status, setStatus] = useState(null);
  const set = (k) => (e) => { setF({ ...f, [k]: e.target.value }); setPrep(null); };

  useEffect(() => {
    if (!parentId) return;
    api.model(parentId).then(async (m) => {
      setParent(m);
      let mf = {};
      try { mf = (await api.manifest(parentId, m.versionCount)).manifest; } catch { /* prefill best-effort */ }
      const t = mf.training || {}, mo = mf.model || {};
      setF({ ...blank, name: m.name, version: "", architecture: mo.architecture || "", framework: mo.framework || "PyTorch",
        framework_version: mo.framework_version || "", optimizer: t.optimizer || "", learning_rate: t.learning_rate ?? "",
        batch_size: t.batch_size ?? "", epochs: t.epochs ?? "", random_seed: t.random_seed ?? "",
        dataset_name: mf.dataset?.name || "", dataset_version: mf.dataset?.version || "",
        python_version: mf.environment?.python_version || "", hardware: mf.environment?.hardware || "" });
    }).catch((e) => setErr(e.message));
  }, [parentId]);

  const buildManifest = () => ({
    schema_version: "modelledger/1.0",
    model: nonEmpty({ name: f.name.trim(), version: f.version.trim(), architecture: f.architecture.trim(), framework: f.framework.trim(), framework_version: f.framework_version }),
    training: nonEmpty({ optimizer: f.optimizer, learning_rate: num(f.learning_rate), batch_size: num(f.batch_size), epochs: num(f.epochs), random_seed: num(f.random_seed), ...rowsToObj(extra, false) }),
    dataset: nonEmpty({ name: f.dataset_name, version: f.dataset_version }),
    evaluation: rowsToObj(metrics, true),
    environment: nonEmpty({ python_version: f.python_version, hardware: f.hardware }),
    artifacts: nonEmpty({ code_commit: f.code_commit }),
    notes: f.notes || undefined,
  });

  const doPrepare = async () => {
    setErr(null); setStatus("Hashing and uploading to storage…"); setPrep(null);
    try { setPrep(await api.prepare(file, buildManifest())); setStatus(null); }
    catch (e) { setErr(e.message); setStatus(null); }
  };

  const doRegister = async () => {
    setErr(null);
    let contract;
    try {
      setStatus("Waiting for wallet confirmation…");
      contract = await getContract();
      const a = "0x" + prep.artifactSha256, m = "0x" + prep.metadataSha256;
      const label = prep.manifest.model.version;
      let tx, id = parentId;
      if (parent) tx = await contract.registerVersion(parentId, parent.versionCount, label, a, m, prep.metadataCid);
      else tx = await contract.registerModel(prep.manifest.model.name, label, a, m, prep.metadataCid);
      setStatus("Transaction submitted, waiting for confirmation…");
      await tx.wait();
      if (!parent) id = await contract.computeModelId(await contract.runner.getAddress(), prep.manifest.model.name);
      nav(`/models/${id}`);
    } catch (e) { setErr(transactionErrorMessage(e, contract)); setStatus(null); }
  };

  const ready = f.name && f.version && f.architecture && f.framework && file;
  const field = (k, label, props = {}) => (<label>{label}<input value={f[k]} onChange={set(k)} {...props} /></label>);
  return (
    <section className="card">
      <h3>{parent ? `New version of ${parent.name} (after v${parent.versionCount})` : "Register model"}</h3>
      <div className="grid4">
        <div><h4>Model</h4>{field("name", "Name *", { disabled: !!parent })}{field("version", "Version label *", { placeholder: "1.0.0" })}
          {field("architecture", "Architecture *", { placeholder: "CNN" })}{field("framework", "Framework *")}{field("framework_version", "Framework version")}</div>
        <div><h4>Training</h4>{field("optimizer", "Optimizer")}{field("learning_rate", "Learning rate", { type: "number", step: "any" })}
          {field("batch_size", "Batch size", { type: "number" })}{field("epochs", "Epochs", { type: "number" })}{field("random_seed", "Random seed", { type: "number" })}
          <Rows rows={extra} setRows={(r) => { setExtra(r); setPrep(null); }} label="Extra parameters" /></div>
        <div><h4>Dataset &amp; environment</h4>{field("dataset_name", "Dataset name")}{field("dataset_version", "Dataset version")}
          {field("python_version", "Python version")}{field("hardware", "Hardware")}{field("code_commit", "Code commit")}</div>
        <div><Rows rows={metrics} setRows={(r) => { setMetrics(r); setPrep(null); }} label="Evaluation metrics (blank = omitted)" numeric />
          <label>Notes<textarea rows="3" value={f.notes} onChange={set("notes")} /></label></div>
      </div>
      <div className="row"><label style={{ flex: 1 }}>Model artifact * (.pth, .onnx, .safetensors, …)<input type="file" onChange={(e) => { setFile(e.target.files[0]); setPrep(null); }} /></label>
        <button disabled={!ready || !!status} onClick={doPrepare}>1. Hash &amp; upload</button></div>
      {status && <p className="muted">{status}</p>}
      {err && <div className="banner err">{err}</div>}
      {prep && (
        <div className="result pass">
          <table className="kv"><tbody>
            <tr><td>Artifact SHA-256</td><td className="mono wrap">{prep.artifactSha256}</td></tr>
            <tr><td>Artifact CID</td><td className="mono wrap">{prep.artifactCid}</td></tr>
            <tr><td>Manifest SHA-256</td><td className="mono wrap">{prep.metadataSha256}</td></tr>
            <tr><td>Manifest CID</td><td className="mono wrap">{prep.metadataCid}</td></tr>
          </tbody></table>
          <details><summary>Canonical manifest</summary><pre>{JSON.stringify(prep.manifest, null, 2)}</pre></details>
          {account ? <button disabled={!!status} onClick={doRegister}>2. Register on-chain</button> : <button onClick={connect}>Connect MetaMask to register</button>}
        </div>)}
    </section>
  );
}
