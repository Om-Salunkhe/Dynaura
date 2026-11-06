// Hand the three contracts to the society committee, so the Pi (the oracle) is not also the owner.
//
//   cd contracts && npm install
//   node scripts/committee.mjs --env path/to/arc.env
//
// The env file needs ARC_ORACLE_PRIVATE_KEY (today's owner, the Pi), ARC_COMMITTEE_PRIVATE_KEY and
// ARC_CLEANER_ADDRESS. Safe to run again: each step is skipped once it's done.
//
// 1. Gas money (USDC is the gas on Arc): the Pi tops the committee up to 1 USDC and the cleaner to 3 USDC.
// 2. Ownable2Step: the Pi calls transferOwnership(committee) on each contract, then the committee calls
//    acceptOwnership(). From then on only the committee can resolve disputes or change the oracle.
import { writeFileSync } from "node:fs"
import { getAddress } from "viem"
import { flags, setup, usd } from "./chain.mjs"

const TARGETS = { committee: 1_000_000n, cleaner: 3_000_000n } // USDC, 6 decimals

const c = setup(flags())
const pi = c.key("ARC_ORACLE_PRIVATE_KEY")
const committee = c.key("ARC_COMMITTEE_PRIVATE_KEY")
const cleaner = getAddress(c.env.ARC_CLEANER_ADDRESS)

console.log(`Pi/oracle  ${pi.address}: ${usd(await c.balance(pi.address))}`)
console.log(`Committee  ${committee.address}`)
for (const [who, addr] of [["committee", committee.address], ["cleaner", cleaner]]) {
  const have = await c.balance(addr)
  if (have < TARGETS[who]) await c.send(pi, c.usdc, "transfer", [addr, TARGETS[who] - have], `fund ${who} ${usd(TARGETS[who] - have)}`)
  else console.log(`  ${who} already has ${usd(have)}`)
}

for (const name of ["CleaningEscrow", "ShopTrade", "SolarBilling"]) {
  const k = c.contract(name)
  const owner = await c.read(k, "owner")
  if (owner === committee.address) {
    console.log(`  ${name}: already owned by the committee`)
    continue
  }
  if (owner !== pi.address) throw new Error(`${name} is owned by ${owner}, not the Pi: stopping`)
  if ((await c.read(k, "pendingOwner")) !== committee.address) {
    await c.send(pi, k, "transferOwnership", [committee.address], `${name}.transferOwnership`)
  }
  await c.send(committee, k, "acceptOwnership", [], `${name}.acceptOwnership`)
  if ((await c.read(k, "owner")) !== committee.address) throw new Error(`${name}: ownership did not move`)
}

c.dep.owner = committee.address
c.dep.committee = committee.address
writeFileSync(c.depPath, JSON.stringify(c.dep, null, 2) + "\n")
c.save("committee")
console.log("Done: the committee owns all three contracts, and the Pi stays the oracle.")
