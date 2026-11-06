// Live proof that our reads can't be spoofed. A stranger creates a fake dynaura.decision for our
// building and hands it to the building wallet with changeOwnership. An .ownedBy() read now shows
// the fake; our .createdBy().ownedBy() read does not.
//
//   BUILDING_ID=test-<you>-1 node --env-file=../.env trust-check.mjs
//
// Spends ~0.01 tGLM from ARKIV_PRIVATE_KEY to fund the stranger. Refuses the demo building.
import { createPublicClient, createWalletClient, ExpirationTime } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { eq } from "@arkiv-network/sdk/query"
import { u64 } from "@arkiv-network/sdk/schema"
import { http, parseEther, stringToBytes } from "viem"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { redact } from "./retry.mjs"
import { Decision } from "./schemas.mjs"

// viem errors quote the RPC URL, which carries the access key: never print one raw.
for (const ev of ["uncaughtException", "unhandledRejection"]) {
  process.on(ev, (e) => {
    console.error(`trust check failed: ${redact(String(e?.shortMessage || e?.message || e).split("\n")[0])}`)
    process.exit(1)
  })
}

const BUILDING = process.env.BUILDING_ID || ""
if (!BUILDING || BUILDING === "sunrise-apartments") {
  console.error("Set BUILDING_ID to a test building (never the demo one).")
  process.exit(1)
}
const key = (process.env.ARKIV_PRIVATE_KEY || "").trim()
const chain = { ...rabdi({ accessKey: process.env.ARKIV_ACCESS_KEY ?? "" }), blockTime: 2000 }
const pub = createPublicClient({ chain, transport: http(), pollingInterval: 1000 })
const building = privateKeyToAccount(key.startsWith("0x") ? key : `0x${key}`)
const stranger = privateKeyToAccount(generatePrivateKey())
const bw = createWalletClient({ chain, transport: http(), account: building, pollingInterval: 1000 })
const sw = createWalletClient({ chain, transport: http(), account: stranger, pollingInterval: 1000 })

const fund = await bw.sendTransaction({ to: stranger.address, value: parseEther("0.01") })
await pub.waitForTransactionReceipt({ hash: fund })
console.log(`stranger ${stranger.address} funded (${fund})`)

const fake = await sw.createEntity(
  Decision,
  { building: BUILDING, kind: "plan", mode: "ai", decision_id: u64(999_999_999n), day: new Date().toISOString().slice(0, 10), summary: stringToBytes("FAKE: pay the cleaner twice") },
  { expiration: ExpirationTime.fromHours(1) },
)
console.log(`stranger created fake decision ${fake.entityKey} (${fake.txHash})`)
const moved = await sw.changeOwnership({ entityKey: fake.entityKey, newOwner: building.address })
console.log(`stranger gave it to the building wallet (${moved.txHash})`)

const q = () => pub.select({ $key: true }).from(Decision).where(eq("building", BUILDING))
const ownerOnly = (await q().ownedBy(building.address).limit(100).fetch()).entities.some((e) => e.$key === fake.entityKey)
const scoped = (await q().createdBy(building.address).ownedBy(building.address).limit(100).fetch()).entities.some((e) => e.$key === fake.entityKey)
console.log(`.ownedBy(building)                    returns the fake: ${ownerOnly}`)
console.log(`.createdBy(building).ownedBy(building) returns the fake: ${scoped}`)
process.exit(ownerOnly && !scoped ? 0 : 1)
