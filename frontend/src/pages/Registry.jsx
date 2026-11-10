import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, fmtDate, short } from "../api";

export default function Registry() {
  const [models, setModels] = useState(null);
  const [q, setQ] = useState("");
  const [err, setErr] = useState(null);
  useEffect(() => { api.models().then(setModels).catch((e) => setErr(e.message)); }, []);
  if (err) return <div className="banner err">{err}</div>;
  if (!models) return <p className="muted">Loading…</p>;
  const f = q.trim().toLowerCase();
  const rows = models.filter((m) => !f || m.name.toLowerCase().includes(f) || m.owner.toLowerCase().includes(f) || m.id.includes(f));
  return (
    <section className="card">
      <div className="row between"><h3>Model registry <span className="muted">({rows.length})</span></h3>
        <input placeholder="Search name, wallet, id…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 280 }} /></div>
      <table><thead><tr><th>Name</th><th>Author wallet</th><th>Latest version</th><th>Versions</th><th>Registered</th></tr></thead><tbody>
        {rows.map((m) => (<tr key={m.id}><td><Link to={`/models/${m.id}`}>{m.name}</Link></td><td className="mono" title={m.owner}>{short(m.owner, 8, 6)}</td><td>{m.latest.label}</td><td>{m.versionCount}</td><td>{fmtDate(m.createdAt)}</td></tr>))}
        {!rows.length && <tr><td colSpan="5" className="muted">No matching models.</td></tr>}
      </tbody></table>
    </section>
  );
}
