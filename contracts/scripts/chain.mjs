// Shared helpers for the on-chain scripts: Arc testnet clients, the deployed contracts, and one
// "simulate, send, wait" step that prints an explorer link. Keys come from an env file and are
// never printed or put on a command line.
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { parseEnv } from "node:util"
import { createPublicClient, createWalletClient, defineChain, getAddress, http, parseAbi, parseGwei } from "viem"
import { privateKeyToAccount } from "viem/accounts"

export const HERE = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const MIN_FEE = parseGwei("20") // Arc drops anything under the 20 gwei base fee, silently

export const USDC_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function transfer(address to, uint256 amount) returns (bool)",
])
export const STATUS = ["none", "open", "accepted", "paid", "refunded", "cancelled", "disputed"]
export const usd = (units) => `${(Number(units) / 1e6).toFixed(6)} USDC`

/** Parse `--name value` flags. */
export function flags(argv = process.argv.slice(2)) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue
    const key = argv[i].slice(2)
    const next = argv[i + 1]
    out[key] = next && !next.startsWith("--") ? argv[++i] : true
  }
  return out
}

export function setup(args) {
  if (!args.env) throw new Error("--env <file with the ARC_*_PRIVATE_KEY values> is required")
  const env = parseEnv(readFileSync(args.env, "utf8"))
  const depPath = resolve(args.deployments || `${HERE}/deployments.json`)
  const dep = JSON.parse(readFileSync(depPath, "utf8"))
  const chain = defineChain({
    id: dep.chainId, name: dep.network,
    nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
    rpcUrls: { default: { http: [dep.rpc] } },
    blockExplorers: { default: { name: "Explorer", url: dep.explorer } },
  })
  // The venue network drops requests: retry reads, and wait patiently for receipts. A retried
  // eth_sendRawTransaction is the same signed tx (same nonce and hash), so it can't double-send.
  const transport = () => http(dep.rpc, { timeout: 45_000, retryCount: 6, retryDelay: 1_500 })
  const pub = createPublicClient({ chain, transport: transport(), pollingInterval: 1_000 })
  const key = (name) => {
    const k = env[name]
    if (!k) throw new Error(`${name} missing from ${args.env}`)
    return privateKeyToAccount(k.startsWith("0x") ? k : `0x${k}`)
  }
  const abi = (name) => JSON.parse(readFileSync(`${HERE}/abi/${name}.json`, "utf8"))
  const contract = (name) => ({ address: getAddress(dep[name].address), abi: abi(name) })
  const usdc = { address: getAddress(dep.usdc), abi: USDC_ABI }
  const link = (h) => `${dep.explorer}/tx/${h}`
  const txs = {}

  /** Simulate (a revert throws before anything is sent), send, wait, print the explorer link. */
  async function send(account, c, functionName, args_, label) {
    const { request } = await pub.simulateContract({ account, address: c.address, abi: c.abi, functionName, args: args_ })
    const block = await pub.getBlock()
    const tip = parseGwei("1")
    const maxFeePerGas = (2n * block.baseFeePerGas > MIN_FEE ? 2n * block.baseFeePerGas : MIN_FEE) + tip
    const wallet = createWalletClient({ account, chain, transport: transport() })
    const hash = await wallet.writeContract({ ...request, maxFeePerGas, maxPriorityFeePerGas: tip })
    const r = await pub.waitForTransactionReceipt({ hash, timeout: 300_000, retryCount: 20 })
    if (r.status !== "success") throw new Error(`${label} reverted: ${link(hash)}`)
    txs[label] = hash
    console.log(`  ${label.padEnd(30)} ${link(hash)}`)
    return r
  }

  const read = (c, functionName, args_ = []) => pub.readContract({ address: c.address, abi: c.abi, functionName, args: args_ })
  const balance = (addr) => read(usdc, "balanceOf", [addr])
  const save = (section) => {
    if (!Object.keys(txs).length) return
    dep.demoTxs = dep.demoTxs || {}
    dep.demoTxs[section] = { ...(dep.demoTxs[section] || {}), ...txs }
    writeFileSync(depPath, JSON.stringify(dep, null, 2) + "\n")
  }
  return { env, dep, depPath, pub, key, contract, usdc, send, read, balance, link, txs, save }
}
