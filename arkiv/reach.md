# Reach

> **Draft.** Items marked **TODO** need Pawan or Om to fill them in with real links and numbers.
> Nothing here is an estimate dressed up as a fact.

## Who Dynaura is for

**Apartment buildings that share a rooftop.** In Indian cities most families live in housing
societies, where the committee runs shared assets and keeps the books: the water pump, the lift,
common-area power, and now rooftop solar. Rooftop solar on a shared roof raises three questions
residents argue about: who gets the power, who pays for what, and was the panel really cleaned.
Dynaura answers them with an AI that plans the sharing (0G), money that moves only on proof (Arc),
and **a record book on Arkiv that every resident can read without trusting the committee**.

The same pattern fits any shared physical asset with a small group of owners and a trust problem:
a borewell, a society EV charger, a co-op's cold storage. In each case expiring records do real
work: offers that close, alarms that fire when a device goes quiet, jobs that clear themselves.

**TODO (Pawan/Om):** one sourced number on housing societies or rooftop solar in Mumbai/India, with
the link.

## How people can see it

| Channel | What | Status |
|---|---|---|
| Live demo at ETHGlobal Mumbai | Cardboard 3-flat building with a real panel, meters and relays. Cover the panel and watch Dyna flag it, the Arc escrow open, the cleaner get paid, and every step land on Arkiv | **TODO:** number of people who saw it at the booth or judging |
| The app | Web app reading Arkiv straight from the browser | **TODO:** deployed URL |
| Demo video | Under 3 minutes, the hero moment end to end | **TODO:** link |
| Open source | MIT-licensed repo, including the bridge, schemas, trust check and smoke test, reusable by any Arkiv project that writes from a device | **TODO:** repo link once public |
| Social | Thread on X tagging Arkiv, 0G and Arc | **TODO:** links, impressions, the right handles |
| Arkiv community | Our [friction log](friction.md), with nine issues ready to file upstream (among them: the gas estimate for back-to-back extensions, the access key leaking through error messages, `.ownedBy()` spoofing in the README example, and a receipt wait that can hang for minutes) | **TODO:** issue links once Pawan approves filing |

## What others can reuse

- **[`bridge/writer.mjs`](../bridge/writer.mjs):** a single-writer queue for Arkiv that reconciles
  failed writes by hash or nonce instead of resending. It's independent of Dynaura and has 10
  offline tests. Any device writing to Arkiv (sensors, kiosks, Pis) needs exactly this.
- **[`bridge/trust-check.mjs`](../bridge/trust-check.mjs):** a one-command live demonstration of
  why readers must scope by creator as well as owner.
- **The heartbeat pattern:** one entity, patch + extend every 30 s, and a 2-minute expiry as the
  offline alarm. It's the smallest useful example of expiry as product logic.

## After the hackathon

**TODO (Pawan/Om):** next steps, if any. For example: a pilot in one real building, a printed QR
code in the lobby that opens the building's Arkiv record, or extending the record book to the
society's other shared assets.
