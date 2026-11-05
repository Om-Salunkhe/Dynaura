// Dynaura bridge: the Pi (Python) posts JSON here, this writes it to Arkiv.
// Runs on the Pi at 127.0.0.1:5100. Start: npm start  (reads ../.env)
import { createServer } from "node:http"
import { createPublicClient, createWalletClient } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { http, isHex } from "viem"
import { privateKeyToAccount } from "viem/accounts"

const PORT = Number(process.env.ARKIV_BRIDGE_PORT || 5100)
const BUILDING = process.env.BUILDING_ID || "sunrise-apartments"
const key = (process.env.ARKIV_PRIVATE_KEY || "").trim()
const pk = key && !key.startsWith("0x") ? `0x${key}` : key

if (!isHex(pk) || pk.length !== 66) {
  console.error("Set ARKIV_PRIVATE_KEY in .env (64 hex chars) for the building wallet that owns all records.")
  process.exit(1)
}

export const chain = rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" })
export const account = privateKeyToAccount(pk)
export const publicClient = createPublicClient({ chain, transport: http() })
export const walletClient = createWalletClient({ chain, transport: http(), account })

const routes = new Map() // "POST /readings" -> async (body, url) => result

export function route(method, path, fn) {
  routes.set(`${method} ${path}`, fn)
}

route("GET", "/health", async () => {
  const block = await publicClient.getBlockNumber()
  const balance = await publicClient.getBalance({ address: account.address })
  return { ok: true, building: BUILDING, wallet: account.address, chain: chain.id, block: block.toString(), tGLM: balance.toString() }
})

async function readBody(req) {
  const chunks = []
  for await (const c of req) chunks.push(c)
  const raw = Buffer.concat(chunks).toString() || "{}"
  return JSON.parse(raw)
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
    console.error(`${req.method} ${url.pathname} failed:`, e?.shortMessage || e?.message || e)
    res.writeHead(500).end(json({ error: String(e?.shortMessage || e?.message || e) }))
  }
})

// Listen only on localhost: the Pi is the only caller. Routes are added by records.mjs (see main.mjs).
server.listen(PORT, "127.0.0.1", () => {
  console.log(`Dynaura bridge on 127.0.0.1:${PORT} · wallet ${account.address} · building ${BUILDING}`)
})

export { BUILDING }
