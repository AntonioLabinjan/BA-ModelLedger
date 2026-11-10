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
      try {
        await window.ethereum.request({
          method: "wallet_requestPermissions",
          params: [{ eth_accounts: {} }],
        });
      } catch (e) {
        if (e.code !== 4200 && e.code !== -32601) throw e;
      }
      const accs = await window.ethereum.request({ method: "eth_requestAccounts" });
      if (!accs?.length) throw new Error("MetaMask did not authorize an account for this site.");
      await ensureChain(c);
      setAccount(accs[0]);
    } catch (e) {
      setError(e.code === 4100
        ? "MetaMask denied this site's account access. In MetaMask, open Connected sites, disconnect this site, then connect again."
        : e.message || String(e));
    }
  }, [cfg, ensureChain]);

  const getContract = useCallback(async () => {
    if (!window.ethereum) throw new Error("MetaMask not detected");
    if (!cfg) throw new Error("Backend config not loaded");
    let accounts;
    try {
      accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
    } catch (e) {
      if (e.code === 4100) {
        throw new Error("MetaMask has not authorized this site. Reconnect your wallet and approve the account request.");
      }
      throw e;
    }
    if (!accounts?.length) throw new Error("No MetaMask account is authorized for this site. Connect your wallet and try again.");
    setAccount(accounts[0]);
    await ensureChain(cfg);
    const activeAccounts = await window.ethereum.request({ method: "eth_accounts" });
    const activeAccount = activeAccounts?.[0] || accounts[0];
    setAccount(activeAccount);
    const signer = await new BrowserProvider(window.ethereum).getSigner(activeAccount);
    return new Contract(cfg.address, cfg.abi, signer);
  }, [cfg, ensureChain]);

  return <Ctx.Provider value={{ account, cfg, error, connect, getContract }}>{children}</Ctx.Provider>;
}
