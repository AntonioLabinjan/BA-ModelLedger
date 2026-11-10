import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, fmtDate, short } from "../api";
import { useWallet } from "../wallet.jsx";

const KV = ({ data }) => {
  const e = Object.entries(data || {}).filter(([, v]) => v !== null && v !== undefined);
  if (!e.length) return <p className="muted">—</p>;
  return <table className="kv"><tbody>{e.map(([k, v]) => (<tr key={k}><td>{k}</td><td className="mono">{typeof v === "object" ? JSON.stringify(v) : String(v)}</td></tr>))}</tbody></table>;
};

function Compare({ a, b }) {
  const sec = (name) => {
    const keys = [...new Set([...Object.keys(a[name] || {}), ...Object.keys(b[name] || {})])].sort();
    return keys.map((k) => {
      const x = a[name]?.[k], y = b[name]?.[k];
      const num = typeof x === "number" && typeof y === "number";
      const d = num ? y - x : null;
      return (<tr key={name + k} className={x !== y ? "diff" : ""}>
        <td>{k}</td><td className="mono">{x ?? "—"}</td><td className="mono">{y ?? "—"}</td>
        <td className="mono">{d === null ? (x === y ? "" : "changed") : (d > 0 ? "+" : "") + Number(d.toFixed(6))}</td></tr>);
    });
  };
  return (
    <table><thead><tr><th>Field</th><th>A</th><th>B</th><th>Δ (B−A)</th></tr></thead><tbody>
      <tr className="sect"><td colSpan="4">Evaluation</td></tr>{sec("evaluation")}
      <tr className="sect"><td colSpan="4">Training</td></tr>{sec("training")}
      <tr className="sect"><td colSpan="4">Dataset / Environment</td></tr>{sec("dataset")}{sec("environment")}
      <tr className="sect"><td colSpan="4">Artifact</td></tr>{sec("artifacts")}
    </tbody></table>
  );
}

export default function ModelDetail() {
  const { id } = useParams();
  const { account } = useWallet();
  const [model, setModel] = useState(null);
  const [sel, setSel] = useState(null);
  const [mf, setMf] = useState({});          // version number -> {manifest, metadataIntact}
  const [cmp, setCmp] = useState({ a: null, b: null });
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.model(id).then((m) => { setModel(m); setSel(m.versionCount); if (m.versionCount > 1) setCmp({ a: m.versionCount - 1, b: m.versionCount }); })
      .catch((e) => setErr(e.message));
  }, [id]);

  const load = (n) => {
    if (!n || mf[n]) return;
    api.manifest(id, n).then((r) => setMf((p) => ({ ...p, [n]: r })))
      .catch((e) => setMf((p) => ({ ...p, [n]: { error: e.message } })));
  };
  useEffect(() => { load(sel); }, [sel]);                // eslint-disable-line
  useEffect(() => { load(cmp.a); load(cmp.b); }, [cmp]); // eslint-disable-line

  if (err) return <div className="banner err">{err}</div>;
  if (!model) return <p className="muted">Loading…</p>;
  const ver = model.versions.find((v) => v.number === sel);
  const cur = mf[sel];
  const m = cur?.manifest;
  const isOwner = account && account.toLowerCase() === model.owner.toLowerCase();
  const A = mf[cmp.a]?.manifest, B = mf[cmp.b]?.manifest;

  return (
    <>
      <div className="row between">
        <h2>{model.name}</h2>
        <div className="row">
          <Link className="btn secondary" to={`/verify?model=${id}&version=${sel}`}>Verify file</Link>
          {isOwner ? <Link className="btn" to={`/register?model=${id}`}>+ New version</Link>
            : <span className="muted" title="Only the registered owner can publish versions">owner only: new version</span>}
        </div>
      </div>
      <div className="grid2">
        <section className="card">
          <h3>Blockchain registration</h3>
          <table className="kv"><tbody>
            <tr><td>Model ID</td><td className="mono wrap">{model.id}</td></tr>
            <tr><td>Owner</td><td className="mono wrap">{model.owner}</td></tr>
            <tr><td>Registered</td><td>{fmtDate(model.createdAt)}</td></tr>
            <tr><td>Versions</td><td>{model.versionCount}</td></tr>
            {ver && <>
              <tr><td>Selected version</td><td>{ver.label} (#{ver.number}, parent {ver.parent || "none"})</td></tr>
              <tr><td>Published</td><td>{fmtDate(ver.timestamp)} by <span className="mono">{short(ver.publisher)}</span></td></tr>
              <tr><td>Artifact SHA-256</td><td className="mono wrap">{ver.artifactHash}</td></tr>
              <tr><td>Metadata SHA-256</td><td className="mono wrap">{ver.metadataHash}</td></tr>
              <tr><td>Manifest CID</td><td className="mono wrap">{ver.cid}</td></tr></>}
          </tbody></table>
        </section>
        <section className="card">
          <h3>Version history</h3>
          <table><thead><tr><th></th><th>#</th><th>Label</th><th>Parent</th><th>Time</th><th>Artifact</th></tr></thead><tbody>
            {[...model.versions].reverse().map((v) => (
              <tr key={v.number} className={v.number === sel ? "sel" : ""}>
                <td><input type="radio" name="sel" checked={v.number === sel} onChange={() => setSel(v.number)} /></td>
                <td>{v.number}</td><td>{v.label}</td><td>{v.parent || "—"}</td><td>{fmtDate(v.timestamp)}</td><td className="mono">{short(v.artifactHash, 8, 4)}</td></tr>))}
          </tbody></table>
        </section>
      </div>
      <section className="card">
        <h3>Manifest — {ver?.label} {cur?.metadataIntact === true && <span className="badge ok">metadata matches on-chain hash</span>}
          {cur?.metadataIntact === false && <span className="badge err">METADATA HASH MISMATCH</span>}</h3>
        {cur?.error && <div className="banner err">{cur.error}</div>}
        {!cur && <p className="muted">Loading manifest from storage…</p>}
        {m && <div className="grid4">
          <div><h4>Model</h4><KV data={m.model} /></div>
          <div><h4>Training</h4><KV data={m.training} /></div>
          <div><h4>Evaluation</h4><KV data={m.evaluation} /><h4>Dataset</h4><KV data={m.dataset} /></div>
          <div><h4>Artifact</h4><KV data={m.artifacts} /><h4>Environment</h4><KV data={m.environment} />
            <a className="btn secondary" href={`/api/models/${id}/versions/${sel}/artifact`}>Download artifact</a></div>
        </div>}
      </section>
      {model.versions.length > 1 && (
        <section className="card">
          <div className="row between"><h3>Compare versions</h3>
            <div className="row">
              {["a", "b"].map((k) => (<label key={k}>{k.toUpperCase()}:&nbsp;
                <select value={cmp[k] || ""} onChange={(e) => setCmp({ ...cmp, [k]: Number(e.target.value) })}>
                  <option value="" disabled>select</option>
                  {model.versions.map((v) => <option key={v.number} value={v.number}>{v.label} (#{v.number})</option>)}
                </select></label>))}
            </div></div>
          {A && B ? <Compare a={A} b={B} /> : <p className="muted">Select two versions.</p>}
        </section>
      )}
    </>
  );
}
