import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api";

export default function Verify() {
  const [sp] = useSearchParams();
  const [models, setModels] = useState([]);
  const [modelId, setModelId] = useState(sp.get("model") || "");
  const [version, setVersion] = useState(Number(sp.get("version") || 0));
  const [versions, setVersions] = useState([]);
  const [file, setFile] = useState(null);
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.models().then((m) => { setModels(m); if (!modelId && m[0]) setModelId(m[0].id); }).catch((e) => setErr(e.message)); }, []); // eslint-disable-line
  useEffect(() => { if (modelId) api.model(modelId).then((m) => setVersions(m.versions)).catch((e) => setErr(e.message)); }, [modelId]);

  const run = async () => {
    setErr(null); setRes(null); setBusy(true);
    try { setRes(await api.verify(file, modelId, version)); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <section className="card narrow">
      <h3>Integrity verification</h3>
      <p className="muted">Recomputes the file's SHA-256 and compares it with the hash stored on-chain.</p>
      <label>Model<select value={modelId} onChange={(e) => { setModelId(e.target.value); setVersion(0); setRes(null); }}>
        {models.map((m) => <option key={m.id} value={m.id}>{m.name} — {m.id.slice(0, 10)}…</option>)}</select></label>
      <label>Version<select value={version} onChange={(e) => { setVersion(Number(e.target.value)); setRes(null); }}>
        <option value={0}>Latest</option>
        {versions.map((v) => <option key={v.number} value={v.number}>{v.label} (#{v.number})</option>)}</select></label>
      <label>Model file<input type="file" onChange={(e) => { setFile(e.target.files[0]); setRes(null); }} /></label>
      <button disabled={!file || !modelId || busy} onClick={run}>{busy ? "Verifying…" : "Verify"}</button>
      {err && <div className="banner err">{err}</div>}
      {res && (
        <div className={"result " + (res.verified ? "pass" : "fail")}>
          <div className="verdict">{res.verified ? "✔ VERIFIED — file matches the registered artifact" : "✘ VERIFICATION FAILED — file does NOT match the registered artifact"}</div>
          <table className="kv"><tbody>
            <tr><td>Version checked</td><td>#{res.version}</td></tr>
            <tr><td>Computed SHA-256</td><td className="mono wrap">{res.computedSha256}</td></tr>
            <tr><td>On-chain SHA-256</td><td className="mono wrap">{res.onchainSha256}</td></tr>
            <tr><td>Stored manifest</td><td>{res.manifestCheck.ok === true ? "consistent with chain" : res.manifestCheck.ok === false ? "INCONSISTENT" : "not checked"} {res.manifestCheck.detail && <span className="muted">({res.manifestCheck.detail})</span>}</td></tr>
          </tbody></table>
        </div>)}
    </section>
  );
}
