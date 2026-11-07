# Reach

## Who it's for

**Apartment buildings that share one rooftop solar system, starting in Maharashtra.** In 2024 the
state regulator (MERC) added *virtual net metering* to its rooftop rules, so residents of
multi-storied buildings can set up one system and share its output
([Mercom, Sept 2024](https://mercomindia.com/merc-proposes-virtual-net-metering-in-rooftop-renewable-energy-system-rules)).
In October 2025 MERC fined the state utility for not implementing it, after three housing
societies complained
([Saur Energy, Oct 2025](https://www.saurenergy.com/solar-energy-news/merc-imposes-penalty-on-msedcl-not-implementing-virtual-net-metering-10588428)).
So the buildings exist, the rule exists, and societies are already pushing for it.

Once a building shares a roof, three groups need the same facts and don't fully trust each other:

| Who | What they need from the record | What Arkiv gives them |
|---|---|---|
| **Residents** (flats A, B, C) | "Was my bill fair? Did the committee spend our money on a real cleaning?" | Their bills and the society's maintenance and cleaning records, readable without asking anyone |
| **The housing committee** | A record that ends arguments, and no server or spreadsheet to keep alive | One wallet writes; anyone can check; expiry clears offers and stale flags by itself |
| **The cleaner** | Proof the job was paid fairly, or grounds to dispute it | The cleaning request on Arkiv, with 0G's verdict, the meter readings it was paid on, and the Arc transactions |
| **Nearby shops** buying spare solar | Live offers they can trust, and receipts | Offers that disappear when the sun window closes; sales they can look up by their wallet |

The same pattern fits any small group sharing a physical asset with a trust problem: a society's
borewell or EV charger, a co-op's cold storage. In each case, expiring records do real work.

## Would they use it?

What we can say honestly, two days in:
- **The pain is documented, not assumed.** Societies took the utility to the regulator over shared
  solar (link above). Today a building's committee runs this with a spreadsheet and a WhatsApp
  group.
- **The cost is small.** One write costs 0.00004–0.0006 tGLM on testnet; a full day of 1-minute
  readings and 30-second heartbeats is about 1 tGLM
  ([measured](how-you-use-arkiv.md#measured)). The committee pays one cleaner fee and a few cents of
  transaction fees a month.
- **Nobody has to learn crypto to read it.** Residents see a normal app. The record behind it is
  public for whoever wants to check.
- **What we haven't done yet:** put it in a real building, or interview a committee. That's the
  first next step below.

## Can they try it today?

Yes. Everything here works without our help:

| Try | How | Needs |
|---|---|---|
| **Read the live building's record** | The curl queries in [`arkiv/README.md`](README.md): the building's AI decisions, the panel's signed readings, and "is it online?" | Nothing (or a free Arkiv key if the public endpoint is busy) |
| **Run the whole building in simulation** | The README's SIM quick start: the Pi API, the bridge and the web app on a laptop, no hardware | Python 3.11, Node 22 |
| **Prove the reads can't be spoofed** | [`bridge/trust-check.mjs`](../bridge/trust-check.mjs): a stranger's fake decision, handed to the building wallet, is ignored by our queries | A funded Rabdi test key |
| **Check our Arkiv write path** | `npm test` in `bridge/` (15 offline tests) and `npm run smoke` (every schema, live) | Node 22 |
| **See it run on hardware** | The cardboard 3-flat building with a real panel, meters and relays, at ETHGlobal Mumbai | Being there, or the demo video |

Live app: **[www.dynaura.in](https://www.dynaura.in)** (it reads Arkiv with its own public read key). Demo video:
**TODO (Pawan)** the link.

## What other builders can reuse

- **[`bridge/writer.mjs`](../bridge/writer.mjs):** a single-writer queue for Arkiv. It reconciles a
  failed write by hash or nonce instead of resending it, and puts a deadline on the SDK's receipt
  wait. It's independent of Dynaura, has offline tests, and fits any device that writes to Arkiv
  (sensors, kiosks, Pis).
- **The heartbeat pattern:** one entity, patched and extended every 30 s, whose 2-minute expiry is
  the offline alarm. It's the smallest useful example of expiry as product logic.
- **[`bridge/trust-check.mjs`](../bridge/trust-check.mjs):** a one-command demonstration of why
  readers must scope by creator as well as owner.
- **Our [friction log](friction.md):** 13 items with reproductions and on-chain evidence. Nine are
  drafted as issues for Arkiv-Network/reported-issues and waiting for our OK to file. Among them: an
  SDK gas estimate that fails every other back-to-back renewal, and access keys leaking through error
  messages.

## Will we keep building?

**TODO (Pawan/Om), your call, in your words.** What we'd do first, if you go on:
1. Put the Pi in one real building's meter room for a month, with its committee using the app.
2. Move from the Rabdi testnet to a production Arkiv network, and have the society own the building
   wallet.
3. Fix the one privacy gap we know about: the plan summary can name an away flat
   ([why-arkiv.md](why-arkiv.md#what-we-kept-off-arkiv-and-why)).
4. Add a QR code in the lobby that opens the building's record.
