import React from "react";
import { NavLink, Route, Routes } from "react-router-dom";
import { WalletProvider, useWallet } from "./wallet.jsx";
import { short } from "./api";
import Dashboard from "./pages/Dashboard.jsx";
import Registry from "./pages/Registry.jsx";
import ModelDetail from "./pages/ModelDetail.jsx";
import Register from "./pages/Register.jsx";
import Verify from "./pages/Verify.jsx";

function Header() {
  const { account, connect, error, cfg } = useWallet();
  return (
    <header className="top">
      <div className="brand">ModelLedger <span className="muted">Trust the model. Verify the experiment.</span></div>
      <nav>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/models">Registry</NavLink>
        <NavLink to="/register">Register</NavLink>
        <NavLink to="/verify">Verify</NavLink>
      </nav>
      <div className="wallet">
        {cfg && cfg.storageMode !== "ipfs" && <span className="badge warn" title="IPFS daemon not reachable; dev-only local store in use">storage: {cfg.storageMode}</span>}
        {account && <span className="badge ok mono">{short(account)}</span>}
        <button onClick={connect}>{account ? "Reconnect MetaMask" : "Connect MetaMask"}</button>
      </div>
      {error && <div className="banner err">{error}</div>}
    </header>
  );
}

export default function App() {
  return (
    <WalletProvider>
      <Header />
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/models" element={<Registry />} />
          <Route path="/models/:id" element={<ModelDetail />} />
          <Route path="/register" element={<Register />} />
          <Route path="/verify" element={<Verify />} />
        </Routes>
      </main>
    </WalletProvider>
  );
}
