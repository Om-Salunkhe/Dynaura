// End-to-end run on Arc testnet against the deployed contracts (addresses from deployments.json).
//
//   cd contracts && npm install
//   node scripts/e2e.mjs --env path/to/arc.env [--request-id <0G request id>] [--root 0x<0G storage root>]
//
// The env file needs ARC_ORACLE_PRIVATE_KEY (the Pi: oracle and treasury), ARC_CLEANER_PRIVATE_KEY and,
// for the dispute, ARC_COMMITTEE_PRIVATE_KEY (the owner, after scripts/committee.mjs).
//
// 1. Escrow: the Pi locks a small fee with the 0G request ID, the cleaner accepts, the Pi links the 0G
//    episode root and releases the fee with a meter proof (panel back at 95%).
// 2. Dispute: another job. The cleaner disputes it ("cloudy"); the Pi is refused when it tries to resolve;
//    the committee wallet resolves it by paying the cleaner.
// 3. Billing: the Pi posts a test bill for flat "E2E" and the cleaner wallet pays it as the resident. The
//    solar part goes to the treasury and the grid part to the grid payee, in one transaction.
// Every transaction is printed as an explorer link and saved under "demoTxs" in deployments.json.
import { keccak256, stringToHex, toHex } from "viem"
import { STATUS, flags, setup, usd } from "./chain.mjs"

const args = flags()
const c = setup(args)
const pi = c.key("ARC_ORACLE_PRIVATE_KEY")
const cleaner = c.key("ARC_CLEANER_PRIVATE_KEY")
const esc = c.contract("CleaningEscrow")
const bill = c.contract("SolarBilling")
if ((await c.read(esc, "oracle")) !== pi.address) throw new Error("the env's oracle key is not the escrow's oracle")
const fee = BigInt(Math.round(Number(args.fee || 0.5) * 1e6))
const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) // 20261106T231500
const requestId = args["request-id"] || `e2e-${stamp}`
const now = () => BigInt(Math.floor(Date.now() / 1000))

console.log(`Pi/oracle ${pi.address}: ${usd(await c.balance(pi.address))}`)
console.log(`Cleaner   ${cleaner.address}: ${usd(await c.balance(cleaner.address))}`)
if ((await c.balance(cleaner.address)) < 1_000_000n) {
  await c.send(pi, c.usdc, "transfer", [cleaner.address, 2_000_000n], "fund cleaner") // gas money (USDC is the gas)
}

// ---- 1. escrow: dusty panel -> locked fee -> accepted -> released on clean proof ----
const job = await c.read(esc, "nextJobId")
console.log(`\nCleaningEscrow ${esc.address}: job #${job}`)
await c.send(pi, c.usdc, "approve", [esc.address, fee], "approve fee")
await c.send(pi, esc, "openJob", [fee, now() + 1200n, 48, requestId], "openJob")
await c.send(cleaner, esc, "accept", [job], "accept")
const root = args.root || keccak256(stringToHex(`dynaura e2e episode ${requestId}`))
await c.send(pi, esc, "linkEpisode", [job, root], "linkEpisode")
let before = await c.balance(cleaner.address)
const proof = keccak256(stringToHex(`dynaura e2e meter readings ${requestId}`))
await c.send(pi, esc, "release", [job, 95, proof], "release")
let got = (await c.balance(cleaner.address)) - before
let j = await c.read(esc, "jobs", [job])
console.log(`  job #${job}: ${STATUS[j[6]]}, output ${j[4]}% -> ${j[5]}%, cleaner received ${usd(got)}, 0G request ${j[9]}`)
if (STATUS[j[6]] !== "paid" || got !== fee) throw new Error("escrow release did not pay the cleaner")

// ---- 2. dispute: the cleaner disputes, the committee (not the Pi) resolves ----
if (!args["skip-dispute"] && c.env.ARC_COMMITTEE_PRIVATE_KEY) {
  const committee = c.key("ARC_COMMITTEE_PRIVATE_KEY")
  if ((await c.read(esc, "owner")) !== committee.address) throw new Error("the committee must own the escrow (scripts/committee.mjs)")
  const job2 = await c.read(esc, "nextJobId")
  console.log(`\nDispute: job #${job2}`)
  await c.send(pi, c.usdc, "approve", [esc.address, fee], "approve fee 2")
  await c.send(pi, esc, "openJob", [fee, now() + 1200n, 47, `${requestId}-d`], "openJob 2")
  await c.send(cleaner, esc, "accept", [job2], "accept 2")
  await c.send(cleaner, esc, "dispute", [job2, "Cleaned it, but it is cloudy: the meter can't show it yet"], "dispute")
  let piCould = true
  try {
    await c.send(pi, esc, "resolve", [job2, true], "resolve by the Pi")
  } catch {
    piCould = false
    console.log("  resolve by the Pi              refused, as it should be (only the committee resolves)")
  }
  if (piCould) throw new Error("the Pi could resolve a dispute: it must not")
  before = await c.balance(cleaner.address)
  await c.send(committee, esc, "resolve", [job2, true], "resolve (committee)")
  got = (await c.balance(cleaner.address)) - before
  j = await c.read(esc, "jobs", [job2])
  console.log(`  job #${job2}: ${STATUS[j[6]]}, the committee paid the cleaner ${usd(got)}`)
  if (STATUS[j[6]] !== "paid" || got !== fee) throw new Error("the committee's resolve did not pay the cleaner")
}

// ---- 3. billing: one payment, split by where the power came from ----
if (!args["skip-bill"]) {
  const month = `e2e-${stamp.slice(9)}` // unique, at most 16 bytes
  const billId = await c.read(bill, "nextBillId")
  console.log(`\nSolarBilling ${bill.address}: bill #${billId} (flat E2E, ${month})`)
  await c.send(pi, bill, "postBill", ["E2E", month, cleaner.address, 150_000n, 50_000n, 1875, 250, keccak256(toHex(month))], "postBill")
  const grid = await c.read(bill, "gridPayee")
  const g0 = await c.balance(grid)
  await c.send(cleaner, c.usdc, "approve", [bill.address, 200_000n], "approve bill")
  await c.send(cleaner, bill, "pay", [billId], "pay (split)")
  console.log(`  grid payee ${grid} received ${usd((await c.balance(grid)) - g0)}; the treasury got the solar part`)
}

c.save(`e2e ${stamp}`)
console.log("\nSaved to deployments.json (demoTxs).")
