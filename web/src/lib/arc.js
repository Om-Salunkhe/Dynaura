// Arc testnet from the browser: the resident, cleaner or shop signs with their own wallet
// (MetaMask or any injected wallet). USDC is the money and the gas.
import { useSyncExternalStore } from "react";
import { createPublicClient, createWalletClient, custom, http, maxUint256, parseAbi } from "viem";
import { arcTestnet } from "viem/chains";

const RPC = import.meta.env.VITE_ARC_RPC_URL || "https://rpc.testnet.arc.io";
const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a || "");

export const ADDR = {
  usdc: "0x3600000000000000000000000000000000000000",
  escrow: import.meta.env.VITE_ARC_ESCROW || "",
  shop: import.meta.env.VITE_ARC_SHOP || "",
  billing: import.meta.env.VITE_ARC_BILLING || "",
};
export const ARC_READY = { escrow: isAddr(ADDR.escrow), shop: isAddr(ADDR.shop), billing: isAddr(ADDR.billing) };

export const ABI = {
  usdc: parseAbi([
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address owner, address spender) view returns (uint256)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ]),
  escrow: parseAbi([
    "function accept(uint256 jobId)",
    "function refund(uint256 jobId)",
    "function jobs(uint256) view returns (address payer, address cleaner, uint96 fee, uint64 deadline, uint16 outputBefore, uint16 outputAfter, uint8 status, bytes32 proof)",
  ]),
  shop: parseAbi([
    "function pricePerKwh() view returns (uint64)",
    "function costOf(uint32 wh) view returns (uint256)",
    "function placeOrder(string day, uint32 wantWh, uint64 deadline) returns (uint256)",
    "function refund(uint256 orderId)",
  ]),
  billing: parseAbi([
    "function key(string flat, string month) pure returns (bytes32)",
    "function billOf(bytes32) view returns (uint256)",
    "function bills(uint256) view returns (string flat, string month, address resident, uint96 amount, uint32 solarWh, uint32 gridWh, bytes32 readingsHash, bool paid, address paidBy)",
    "function pay(uint256 billId)",
  ]),
};

export const publicClient = createPublicClient({ chain: arcTestnet, transport: http(RPC) });

export const usdc = (units) => Number(units) / 1e6;
export const txUrl = (hash) => `${arcTestnet.blockExplorers.default.url}/tx/${hash}`;
export const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");

// ---- wallet (one shared store for every page) ----------------------------
let wallet = { address: null, busy: false, error: null };
const subs = new Set();
const setWallet = (patch) => {
  wallet = { ...wallet, ...patch };
  subs.forEach((f) => f());
};

export function useWallet() {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => wallet,
  );
}

async function switchToArc(eth) {
  const chainId = `0x${arcTestnet.id.toString(16)}`;
  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (e) {
    if (e?.code !== 4902) throw e;
    await eth.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId,
        chainName: arcTestnet.name,
        nativeCurrency: arcTestnet.nativeCurrency,
        rpcUrls: [RPC],
        blockExplorerUrls: [arcTestnet.blockExplorers.default.url],
      }],
    });
  }
}

export async function connect() {
  const eth = window.ethereum;
  if (!eth) {
    setWallet({ error: "No wallet found. Install MetaMask (or open this page in a wallet browser)." });
    return null;
  }
  setWallet({ busy: true, error: null });
  try {
    const [address] = await eth.request({ method: "eth_requestAccounts" });
    await switchToArc(eth);
    setWallet({ address, busy: false });
    eth.on?.("accountsChanged", (a) => setWallet({ address: a[0] || null }));
    return address;
  } catch (e) {
    setWallet({ busy: false, error: e?.shortMessage || e?.message || "Wallet refused" });
    return null;
  }
}

function walletClient() {
  return createWalletClient({ chain: arcTestnet, transport: custom(window.ethereum) });
}

/** Send one contract call from the connected wallet and wait for it. Returns the tx hash. */
export async function write(contract, functionName, args) {
  const account = wallet.address || (await connect());
  if (!account) throw new Error(wallet.error || "Connect a wallet first");
  await switchToArc(window.ethereum);
  const hash = await walletClient().writeContract({
    account, chain: arcTestnet, address: ADDR[contract], abi: ABI[contract], functionName, args,
  });
  const rcpt = await publicClient.waitForTransactionReceipt({ hash });
  if (rcpt.status !== "success") throw new Error("Transaction reverted");
  return hash;
}

/** Approve `spender` for at least `units` of USDC (one approval, then never again). */
export async function ensureAllowance(spender, units) {
  const owner = wallet.address || (await connect());
  if (!owner) throw new Error(wallet.error || "Connect a wallet first");
  const have = await publicClient.readContract({ address: ADDR.usdc, abi: ABI.usdc, functionName: "allowance", args: [owner, ADDR[spender]] });
  if (have >= units) return null;
  const hash = await walletClient().writeContract({
    account: owner, chain: arcTestnet, address: ADDR.usdc, abi: ABI.usdc, functionName: "approve", args: [ADDR[spender], maxUint256],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export const errText = (e) => e?.shortMessage || e?.details || e?.message || String(e);
