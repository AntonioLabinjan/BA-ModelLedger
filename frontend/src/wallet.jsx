import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { BrowserProvider, Contract } from "ethers";
import { api } from "./api";

const Ctx = createContext(null);
export const useWallet = () => useContext(Ctx);

export function WalletProvider({ children }) {
  const [account, setAccount] = useState(null);
  const [cfg, setCfg] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => { api.config().then(setCfg).catch((e) => setError(e.message)); }, []);
  useEffect(() => {
    if (!window.ethereum) return;
    const onAcc = (a) => setAccount(a[0] || null);
    window.ethereum.on?.("accountsChanged", onAcc);
    window.ethereum.request({ method: "eth_accounts" }).then(onAcc).catch(() => {});
    return () => window.ethereum.removeListener?.("accountsChanged", onAcc);
  }, []);

  const ensureChain = useCallback(async (c) => {
    const chainIdHex = "0x" + c.chainId.toString(16);
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (e) {
      if (e.code === 4902 || e.code === -32603) {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [{ chainId: chainIdHex, chainName: "ModelLedger Local", rpcUrls: [c.rpcUrl],
                    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 } }],
        });
      } else throw e;
    }
  }, []);

  const connect = useCallback(async () => {
    setError(null);
    try {
      if (!window.ethereum) throw new Error("MetaMask not detected");
      const c = cfg || (await api.config());
      const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
      await ensureChain(c);
      setAccount(accs[0]);
    } catch (e) { setError(e.message || String(e)); }
  }, [cfg, ensureChain]);

  const getContract = useCallback(async () => {
    if (!window.ethereum) throw new Error("MetaMask not detected");
    if (!cfg) throw new Error("Backend config not loaded");
    await ensureChain(cfg);
    const signer = await new BrowserProvider(window.ethereum).getSigner();
    return new Contract(cfg.address, cfg.abi, signer);
  }, [cfg, ensureChain]);

  return <Ctx.Provider value={{ account, cfg, error, connect, getContract }}>{children}</Ctx.Provider>;
}
