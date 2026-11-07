async function req(path, opts) {
  const r = await fetch("/api" + path, opts);
  let body = null;
  try { body = await r.json(); } catch { /* non-JSON */ }
  if (!r.ok) {
    const d = body?.detail;
    throw new Error(typeof d === "string" ? d : d ? JSON.stringify(d) : `HTTP ${r.status}`);
  }
  return body;
}
export const api = {
  config: () => req("/config"),
  health: () => req("/health"),
  models: () => req("/models"),
  recent: (n = 8) => req(`/versions/recent?limit=${n}`),
  model: (id) => req(`/models/${id}`),
  manifest: (id, n) => req(`/models/${id}/versions/${n}/manifest`),
  prepare: (file, manifest) => {
    const fd = new FormData();
    fd.append("artifact", file);
    fd.append("manifest", JSON.stringify(manifest));
    return req("/prepare", { method: "POST", body: fd });
  },
  verify: (file, modelId, version) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("model_id", modelId);
    fd.append("version", String(version || 0));
    return req("/verify", { method: "POST", body: fd });
  },
};
export const short = (s, a = 6, b = 4) => (s && s.length > a + b + 3 ? `${s.slice(0, a)}…${s.slice(-b)}` : s);
export const fmtDate = (ts) => new Date(Number(ts) * 1000).toLocaleString();
