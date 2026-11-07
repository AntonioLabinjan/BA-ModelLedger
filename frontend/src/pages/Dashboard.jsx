import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate, short } from "../api";

export default function Dashboard() {
  const [models, setModels] = useState(null);
  const [recent, setRecent] = useState([]);
  const [err, setErr] = useState(null);
  useEffect(() => {
    Promise.all([api.models(), api.recent(8)]).then(([m, r]) => { setModels(m); setRecent(r); }).catch((e) => setErr(e.message));
  }, []);
  if (err) return <div className="banner err">{err}</div>;
  if (!models) return <p className="muted">Loading…</p>;
  const newest = [...models].sort((a, b) => b.createdAt - a.createdAt).slice(0, 8);
  const totalVersions = models.reduce((s, m) => s + m.versionCount, 0);
  return (
    <>
      <div className="stats">
        <div className="card stat"><b>{models.length}</b><span>registered models</span></div>
        <div className="card stat"><b>{totalVersions}</b><span>versions</span></div>
        <div className="card stat actions"><Link className="btn" to="/register">+ Register model</Link><Link className="btn secondary" to="/verify">Verify file</Link></div>
      </div>
      <div className="grid2">
        <section className="card">
          <h3>Recent models</h3>
          <table><thead><tr><th>Name</th><th>Latest</th><th>Owner</th><th>Registered</th></tr></thead><tbody>
            {newest.map((m) => (<tr key={m.id}><td><Link to={`/models/${m.id}`}>{m.name}</Link></td><td>{m.latest.label}</td><td className="mono">{short(m.owner)}</td><td>{fmtDate(m.createdAt)}</td></tr>))}
            {!newest.length && <tr><td colSpan="4" className="muted">No models yet.</td></tr>}
          </tbody></table>
        </section>
        <section className="card">
          <h3>Recent versions</h3>
          <table><thead><tr><th>Model</th><th>Version</th><th>Artifact SHA-256</th><th>Time</th></tr></thead><tbody>
            {recent.map((v) => (<tr key={v.modelId + v.number}><td><Link to={`/models/${v.modelId}`}>{v.modelName}</Link></td><td>{v.label} <span className="muted">(#{v.number})</span></td><td className="mono">{short(v.artifactHash, 8, 6)}</td><td>{fmtDate(v.timestamp)}</td></tr>))}
            {!recent.length && <tr><td colSpan="4" className="muted">No versions yet.</td></tr>}
          </tbody></table>
        </section>
      </div>
    </>
  );
}
