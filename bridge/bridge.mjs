// Dynaura bridge: the Pi (Python) posts JSON here, this writes it to Arkiv.
// Runs on the Pi at 127.0.0.1:5100. Start: npm start  (reads ../.env)
import { createServer } from "node:http"
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { formatEther, http, isHex } from "viem"
import { privateKeyToAccount } from "viem/accounts"
import { redact, withBackoff } from "./retry.mjs"
import { createWriter } from "./writer.mjs"

const PORT = Number(process.env.ARKIV_BRIDGE_PORT || 5100)
const BUILDING = process.env.BUILDING_ID || "sunrise-apartments"
const key = (process.env.ARKIV_PRIVATE_KEY || "").trim()
const pk = key && !key.startsWith("0x") ? `0x${key}` : key

if (!isHex(pk) || pk.length !== 66) {
  console.error("Set ARKIV_PRIVATE_KEY in .env (64 hex chars) for the building wallet that owns all records.")
  process.exit(1)
}

// Rabdi makes a block every 2 s. viem assumes 12 s for a chain that doesn't say, and then polls
// for receipts every 4 s; telling it 2 s halves the time a write takes to come back.
export const chain = { ...rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" }), blockTime: 2000 }
export const account = privateKeyToAccount(pk)
// ARKIV_RPC_URL is only for a local node. rabdi() already puts the access key in its URL; a bare
// Rabdi URL here would silently drop the key and land on the rate-limited public endpoint.
const rpcUrl = (process.env.ARKIV_RPC_URL || "").trim()
const customRpc = rpcUrl && !rpcUrl.includes("rpc.rabdi.db-chain.testnet.arkiv.network") ? rpcUrl : undefined
if (rpcUrl && !customRpc) console.warn("ARKIV_RPC_URL points at Rabdi: ignored, using rabdi({ accessKey }) instead")
if (!process.env.ARKIV_ACCESS_KEY) console.warn("No ARKIV_ACCESS_KEY: the public Rabdi endpoint is heavily rate limited")
const transport = () => http(customRpc, { retryCount: 2, timeout: 20_000 })
export const publicClient = createPublicClient({ chain, transport: transport(), pollingInterval: 1000 })
export const walletClient = createWalletClient({ chain, transport: transport(), account, pollingInterval: 1000 })

// Every write goes through this one queue (see writer.mjs); reads back off on 429s.
const writer = createWriter({ publicClient, address: account.address })
export const write = writer.enqueue
export const read = withBackoff

const routes = new Map() // "POST /readings" -> async (body, url) => result

export function route(method, path, fn) {
  routes.set(`${method} ${path}`, fn)
}

// Extra lines for /health from the record routes (e.g. the heartbeat entity)
const healthParts = []
export const addHealth = (fn) => healthParts.push(fn)

const LOW_TGLM = 0.05

route("GET", "/health", async () => {
  const [block, balance] = await Promise.all([
    read(() => publicClient.getBlockNumber({ cacheTime: 0 })),
    read(() => publicClient.getBalance({ address: account.address })),
  ])
  const writes = writer.stats()
  const warnings = []
  if (Number(formatEther(balance)) < LOW_TGLM) warnings.push(`wallet low: ${formatEther(balance)} tGLM, top up at hub.arkiv.network/faucet`)
  if (writes.uncertain.length) warnings.push(`${writes.uncertain.length} write(s) with unknown outcome, not resent: check them on the explorer`)
  if (writes.queued > writes.max_queue * 0.8) warnings.push(`write queue almost full (${writes.queued}/${writes.max_queue})`)
  if (writes.in_flight?.for_s > 90) warnings.push(`write "${writes.in_flight.label}" in flight for ${writes.in_flight.for_s}s`)
  const extra = Object.assign({}, ...(await Promise.all(healthParts.map((f) => f(block).catch((e) => ({ health_error: redact(e?.shortMessage || e?.message || e) }))))))
  return {
    ok: warnings.length === 0,
    building: BUILDING,
    wallet: account.address,
    chain: chain.id,
    block: block.toString(),
    tGLM: formatEther(balance),
    explorer: `https://rabdi.explorer.arkiv.network/address/${account.address}`,
    warnings,
    writes,
    ...extra,
  }
})

async function readBody(req) {
  const chunks = []
  let size = 0
  for await (const c of req) {
    size += c.length
    if (size > 1_000_000) throw Object.assign(new Error("body over 1 MB"), { status: 413 })
    chunks.push(c)
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || "{}")
  } catch {
    throw Object.assign(new Error("body is not JSON"), { status: 400 })
  }
}

const json = (v) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x))

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  const fn = routes.get(`${req.method} ${url.pathname}`)
  res.setHeader("Content-Type", "application/json")
  if (!fn) {
    res.writeHead(404).end(json({ error: "not found" }))
    return
  }
  try {
    const body = req.method === "POST" ? await readBody(req) : {}
    const out = await fn(body, url)
    res.writeHead(200).end(json(out))
  } catch (e) {
    const error = redact(String(e?.shortMessage || e?.message || e).split("\n")[0])
    console.error(`${req.method} ${url.pathname} failed:`, error)
    // 503 = queue full (try later), 502 = sent but outcome unknown (do NOT resend), 500 = failed
    const status = typeof e?.status === "number" && e.status >= 400 && e.status < 600 ? e.status : 500
    res.writeHead(status).end(json({ error, ...(e?.txHash ? { txHash: e.txHash } : {}) }))
  }
})

// Listen only on localhost: the Pi is the only caller. Routes are added by records.mjs (see main.mjs).
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Dynaura bridge on 127.0.0.1:${PORT} · wallet ${account.address} · building ${BUILDING}`)
})

export { BUILDING }
