// Fair share on Arc testnet: SolarCredits pays each flat for the spare sun it left unused.
//
//   cd contracts && npm install
//   node scripts/credits.mjs --env path/to/arc.env
//
// The env file needs ARC_ORACLE_PRIVATE_KEY (the Pi: oracle, and the society treasury that brings in
// shop + grid revenue), ARC_COMMITTEE_PRIVATE_KEY (the owner: registers the flats' wallets),
// ARC_CLEANER_PRIVATE_KEY (a test wallet that tops up the flats' gas) and ARC_FLAT_{A,B,C}_PRIVATE_KEY.
//
// Pawan's day: the flats' fair shares are 50 kWh each. A used 20 (30 unused), B used 40 (10 unused),
// C used 70 (20 over its share, bought from its neighbours at 0.013 USDC/kWh).
// 1. The committee registers each flat's wallet (once).
// 2. The Pi posts the period: unused / over per flat, the neighbour rate, the readings hash.
// 3. Money in: C pays for its 20 kWh (0.26 USDC) and the Pi adds shop + grid revenue (0.14 USDC).
// 4. A and B claim. SolarCredits computes pool * unused / sum(unused) itself: A gets 0.30, B gets 0.10,
//    so A gets 3x B (an equal split would have given each 0.20).
// Every transaction is saved under "demoTxs" in deployments.json.
import { getAddress, keccak256, parseAbi, parseEventLogs, stringToHex } from "viem"
import { flags, setup, usd } from "./chain.mjs"

const args = flags()
const c = setup(args)
if (!c.dep.SolarCredits?.address) throw new Error("SolarCredits has no address in deployments.json yet")
const sc = c.contract("SolarCredits")
const pi = c.key("ARC_ORACLE_PRIVATE_KEY")
const committee = c.key("ARC_COMMITTEE_PRIVATE_KEY")
const funder = c.key("ARC_CLEANER_PRIVATE_KEY")
const flat = { A: c.key("ARC_FLAT_A_PRIVATE_KEY"), B: c.key("ARC_FLAT_B_PRIVATE_KEY"), C: c.key("ARC_FLAT_C_PRIVATE_KEY") }
if ((await c.read(sc, "oracle")) !== pi.address) throw new Error("the env's oracle key is not SolarCredits' oracle")
if ((await c.read(sc, "owner")) !== committee.address) throw new Error("the committee must own SolarCredits")

const building = c.dep.building || "sunrise-apartments"
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)
const key = args.key || `e2e-${stamp}`
const periodId = keccak256(stringToHex(`${building}:${key}`)) // the Pi's credit_period_id(key)
const RATE = 13n // micro-USDC per Wh: 0.013 USDC per kWh, the midpoint of export 0.006 and import 0.02
const day = { A: { unused: 30_000n, over: 0n }, B: { unused: 10_000n, over: 0n }, C: { unused: 0n, over: 20_000n } }
const shopAndGrid = 140_000n // 0.14 USDC

console.log(`SolarCredits ${sc.address}, period "${key}" (${periodId})`)

// ---- gas money for the flats (USDC is the gas on Arc), from the test funder, not the Pi ----
const want = { A: 50_000n, B: 50_000n, C: 20_000n * RATE + 50_000n }
for (const f of ["A", "B", "C"]) {
  const have = await c.balance(flat[f].address)
  if (have < want[f]) await c.send(funder, c.usdc, "transfer", [flat[f].address, want[f] - have], `fund flat ${f}`)
}

// ---- 1. the committee registers the flats' wallets ----
for (const f of ["A", "B", "C"]) {
  if ((await c.read(sc, "walletOf", [f])) !== flat[f].address) {
    await c.send(committee, sc, "register", [f, flat[f].address], `register ${f}`)
  }
}

// ---- 2. the Pi posts the period ----
const names = ["A", "B", "C"]
const readings = keccak256(stringToHex(`dynaura signed 1-minute summaries for ${key}`))
await c.send(pi, sc, "postPeriod", [periodId, names, names.map((f) => day[f].unused), names.map((f) => day[f].over), RATE, readings], "postPeriod")

// ---- 3. money in ----
await c.send(flat.C, c.usdc, "approve", [sc.address, 20_000n * RATE], "approve C")
await c.send(flat.C, sc, "payIn", [periodId, "C"], "payIn C (neighbour)")
await c.send(pi, c.usdc, "approve", [sc.address, shopAndGrid], "approve fund")
await c.send(pi, sc, "fund", [periodId, shopAndGrid], "fund (shop + grid)")
const info = await c.read(sc, "periodInfo", [periodId])
console.log(`  pool: ${usd(info[4])} (C paid ${usd(20_000n * RATE)}, shop + grid ${usd(shopAndGrid)})`)

// ---- 4. the flats claim; the contract computes the split ----
// What each claim paid, from the USDC Transfer out of SolarCredits in its receipt (balance deltas would
// mix in the gas, which is also paid in USDC on Arc).
const TRANSFER = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"])
const got = {}
for (const f of ["A", "B"]) {
  const r = await c.send(flat[f], sc, "claim", [periodId, f], `claim ${f}`)
  const paid = parseEventLogs({ abi: TRANSFER, logs: r.logs, eventName: "Transfer" })
    .filter((l) => getAddress(l.address) === c.usdc.address && getAddress(l.args.from) === sc.address)
  if (paid.length !== 1 || getAddress(paid[0].args.to) !== flat[f].address) throw new Error(`claim ${f}: no payout to its wallet`)
  got[f] = paid[0].args.value
}
console.log(`  A got ${usd(got.A)}, B got ${usd(got.B)} (an equal split would give each ${usd((info[4]) / 2n)})`)
if (got.A !== 300_000n || got.B !== 100_000n) throw new Error(`unexpected split: A ${got.A}, B ${got.B}`)
if (got.A !== 3n * got.B) throw new Error("A did not get 3x B")
console.log("  A saved 3x as much as B, and got paid 3x as much. ✓")

c.save(`credits ${stamp}`)
console.log("\nSaved to deployments.json (demoTxs).")
