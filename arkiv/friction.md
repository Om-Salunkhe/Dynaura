# Friction log: building Dynaura on Arkiv

Everything here happened while we built Dynaura at ETHGlobal Mumbai (5–7 Nov 2026), on
**Rabdi** (chain 7794095) with **`@arkiv-network/sdk` 1.0.1**, **viem 2.57.16** and Node 22/25. Each item
says what we hit, how to reproduce it, what it cost us, what we did about it, and what would have
helped. Transaction hashes are on the [Rabdi explorer](https://rabdi.explorer.arkiv.network).

Severity: **High** = broke a write or could silently mislead. **Medium** = cost real time or
performance. **Low** = papercut.

---

## 1. The SDK's gas estimate ran out of gas when renewing an entity right after the previous renewal (High)

**What happened.** Our heartbeat entity is renewed with one batch, a patch plus
`extensions: [{ expiration: ExpirationTime.fromMinutes(2) }]`. When two renewals went out back to
back, the second one **reverted out of gas**: `gasUsed == gasLimit`, and the fee was spent with
nothing applied.

**Evidence.**
- [`0x348bfb0b…fdbd`](https://rabdi.explorer.arkiv.network/tx/0x348bfb0b83122d25f3e8dd20dee9c72b866f1218686c4d42a1befbb7592fdcbd):
  renewal, success. `gasUsed` 70,693 of a limit of 89,445.
- [`0x94772a58…462a`](https://rabdi.explorer.arkiv.network/tx/0x94772a581a8baf0397b6164519bbe367077498c0863a1939d7012ac4e0d3462a):
  the next renewal, 3 blocks later. **Reverted. `gasUsed` 54,946 = limit 54,946.**

**Why (our reading of the SDK source).** `sendArkivTransaction` estimates gas at the latest
block and adds 25%. In that block the previous renewal has just set the expiry to
`latest + 60 blocks`. So the estimate sees an extension that resolves to the current expiry: a
no-op, and cheap. The real transaction lands a block or more later, where the extension is a real
write. 44k + 25% was not enough for ~71k.

**Reproduce (rerun as a minimal script, 6 Nov).** Create an entity with
`ExpirationTime.fromMinutes(2)`. Then send four
`executeBatch({ patches: [...], extensions: [{ entityKey, expiration: ExpirationTime.fromMinutes(2) }] })`
calls in a row, each as soon as the previous receipt arrives, with the SDK's default gas.
**Every other one runs out of gas:**

| Renewal | Result | Gas used / limit | Tx |
|---|---|---|---|
| 1 (right after the create) | **out of gas** | 41,432 / 41,432 | [`0xc5cbfeae…`](https://rabdi.explorer.arkiv.network/tx/0xc5cbfeae15d3640ef36cf13cb54a83ac4212af39798b7842f96724715f17b8fb) |
| 2 | ok | 52,635 / 66,783 | [`0x87cc3360…`](https://rabdi.explorer.arkiv.network/tx/0x87cc33603950c6f8ad36880fc68b5f9b7afc400b4494cb8c23602111f34b6230) |
| 3 | **out of gas** | 41,432 / 41,432 | [`0xed0049df…`](https://rabdi.explorer.arkiv.network/tx/0xed0049df3d00dae23547ec166b0b6815fd06d7d9165c1e566b6c3098eec90596) |
| 4 | ok | 52,635 / 66,783 | [`0x067d1280…`](https://rabdi.explorer.arkiv.network/tx/0x067d1280218326e898870bd3ba358c0244c2ddefbf8478235ace1c7f482836ff) |

A failed renewal leaves the expiry where it was, so the next estimate sees a real extension and
gets enough gas. Then the one after that fails again. For a heartbeat this means half the renewals
are wasted fees.

**Workaround.** We pass an explicit `gas` on every write: 1,000,000 + 400,000 per extra operation,
the floor from Arkiv's own `arkiv-write-safety` skill. Only gas used is charged (1 gwei on
Rabdi), so this costs nothing extra. We also retry exactly once, with double the gas, when a
receipt shows out-of-gas.

**Suggestion.** Make the SDK's default safe for extensions: estimate with the expiry resolved
against `latest + 1`, or add more headroom when a batch carries extensions. At least, say in the
README that the default can under-estimate extensions sent back to back.

## 2. `rabdi()` doesn't set `blockTime`, so viem polls for receipts every 4 seconds (Medium)

**What happened.** viem derives its polling interval from `chain.blockTime` and assumes 12 s when
a chain doesn't set it. So `waitForTransactionReceipt` polls every 4 s on a chain that makes a
block every 2 s. Every write came back late.

**Evidence.** We measured Rabdi's block time as exactly 2 s over 1,800 blocks. Earlier in the
hackathon, on another Arkiv app, writes went from about 8 s to about 4 s after we set it. In the
final bridge, the average write over 15 writes is 3.7 s.

**Reproduce.** `createPublicClient({ chain: rabdi({ accessKey }), transport: http() }).pollingInterval`
is `4000`.

**Workaround.** `{ ...rabdi({ accessKey }), blockTime: 2000 }` plus `pollingInterval: 1000` on both
clients.

**Suggestion.** Set `blockTime: 2000` in the `rabdi()` chain definition. It is a one-line change
that halves write latency for everyone.

## 3. An explicit RPC URL silently drops the access key (Medium)

**What happened.** `rabdi({ accessKey })` puts the key in the RPC URL's path. Our team's `.env`
had `ARKIV_RPC_URL=https://rpc.rabdi.db-chain.testnet.arkiv.network` (the bare host, as written in
docs), and the bridge passed it to `http(url)`. That overrides the chain's URL, so every request
went to the **heavily rate-limited public endpoint**, even though a valid access key was set.
Nothing warned us. We found it while auditing the config.

**Reproduce.** `http("https://rpc.rabdi.db-chain.testnet.arkiv.network")` with
`chain: rabdi({ accessKey: "…" })`, then look at the request URL in `onFetchRequest`: there's no
key.

**Workaround.** The bridge ignores `ARKIV_RPC_URL` when it points at Rabdi and always uses
`rabdi({ accessKey })`. It warns at start-up when there is no key.

**Suggestion.** Accept the key as a header or option as well as the URL path. Or have the SDK warn
when a Rabdi client's transport URL has no key.

## 4. Natural expiry has no event, so "offline when the heartbeat expires" needs polling (Medium)

**What happened.** Our "Building offline" alarm is the heartbeat entity expiring. The app polls
for it every 30 s, because natural expiry emits no event. `watchEntityEvents` has events for
creates, patches, extensions, transfers and deletes, but nothing fires when an entity simply runs
out. We first saw this earlier in the hackathon, and Arkiv's expiration skill says the same.

**Workaround.** Poll a query: `heartbeat` where `building = …`, ordered by `updated`, limit 1. No
row means offline.

**Suggestion.** An `EntityExpired` event, or a subscription to "entities matching this query that
expire", would make expiry-driven product logic push-based.

## 5. `.ownedBy()` alone can be spoofed with an ownership transfer; the README teaches it alone (Medium)

**What happened.** The README's query example scopes by `.ownedBy(account.address)`, and so did
our first version of the web app. But `changeOwnership` lets anyone create an entity with our
schema tag and then **hand it to our wallet**. It then matches `.ownedBy(ourWallet)`. The creator,
on the other hand, never changes.

**Evidence (live, 6 Nov).** A fresh wallet `0x8013…877b` created a `dynaura.decision` saying
"FAKE: pay the cleaner twice" for our building
([`0xf9daf2ef…8f3c`](https://rabdi.explorer.arkiv.network/tx/0xf9daf2efa0bfeb8ea682671e0dd631ef446f9dc223968cc902efe62971c68f3c))
and transferred it to our building wallet
([`0x5c8872c6…e717`](https://rabdi.explorer.arkiv.network/tx/0x5c8872c653e66e664cd0eaef2c6ac4a1e3e2c84568091f35cf3b61f2369ee717)).
- `.ownedBy(building)`: **the fake is returned.**
- `.createdBy(building).ownedBy(building)`: the fake is not returned.

**Workaround.** Every Dynaura read uses `.createdBy(wallet).ownedBy(wallet)`
([`arkivReads.js`](../web/src/lib/arkivReads.js)). Our smoke test checks that reading as another
owner returns nothing.

**Suggestion.** Use `.createdBy()` in the README's first query example, with one sentence on why.
Arkiv's `arkiv-security-trust` skill says it, but the README is what people copy.

## 6. Entities can't be sorted by `$createdAt` (Low)

**What happened.** We wanted "newest maintenance visits first". `orderBy(desc("$createdAt"))` is
rejected; only `$key`, `$owner`, `$creator`, `$expiresAt` and columns can be sorted. Several
visits on the same `date` came back in arbitrary order. Our smoke test caught that.

**Workaround.** We added our own unindexed `at: u64()` column (sorting doesn't need an index) and
sort on it.

**Suggestion.** Allow sorting on `$createdAt` / `$updatedAt`. Almost every list UI wants it.

## 7. On Node 25, the first query prints a `--localstorage-file` warning (Low)

**What happened.** The SDK's debug logger checks `"localStorage" in globalThis` to read `DEBUG` in
browsers. Node 25 has a global `localStorage`, and touching it prints
`Warning: --localstorage-file was provided without a valid path` on every process's first query.
It looks like an error in our service logs.

**Reproduce.** On Node 25.2.1, run any `select(...).from(Schema).where(eq(...)).fetch()`.

**Suggestion.** Check `typeof window !== "undefined"` (or `process.versions.node`) before touching
`localStorage`.

## 8. A JavaScript exception doesn't say whether a write landed (Medium, a design note)

**What happened.** When `createEntity` throws, the transaction may or may not be on chain. If
`EntityMutationError.txHash` is set, the receipt decides. If not, the send may still have gone
through: the response was lost, or the estimate failed. The SDK can't know. A naive
"retry on error" creates duplicates. Arkiv's `arkiv-write-safety` skill explains this well, but
it's a lot to absorb in a hackathon.

**What we built** ([`bridge/writer.mjs`](../bridge/writer.mjs)):
- One queue and an explicit nonce per write.
- On failure: settle by receipt when we have a hash, or find the transaction by sender + nonce
  when the nonce was used.
- Retry once **on the same nonce** only when the nonce is unused, so at most one copy can land.
- Anything else is marked "uncertain" in `/health` and never resent.
- 11 offline tests cover these paths.

**Suggestion.** A small `safeWrite()` helper in the SDK that does this, or that at least returns
`{ txHash, nonce }` before waiting for the receipt, would save every team from building it.

## 9. The public endpoint goes from fine to unusable when the venue is busy (Medium)

The same five web-app queries against the keyless endpoint:
- At 09:00: **750/750** succeeded, up to ~40 queries/s.
- At 22:30: **4/60** succeeded. 223 of 228 requests were 429s, and a page load took 6 s at the
  median.
- With an access key at the same moment: 60/60, 0.7 s.

The 429 body explains it: `{"error":"ANON_COST_LIMITED","message":"unauthenticated query budget
exhausted; get an API key at https://hub.arkiv.network for a monthly quota"}`. So it's a **cost
budget** for anonymous callers, not a per-second rate, and our own morning tests from the same
machine probably used part of it. A judge opening our app on the venue Wi-Fi would have seen
"Arkiv not reachable". With a key,
latency is about 0.5 s per call from Mumbai. A write needs about 5 round trips (nonce, block
number, send, receipt polls), so it takes 3–5 s even though blocks are 2 s. We cache
`eth_gasPrice`, skip viem's fee lookups by passing `gasPrice`, and back off with jitter on reads.

**It also hit the judging rule.** Arkiv asks for "one query a judge can run" in the README. Our
keyless README query, the obvious way to make it runnable by anyone, returned `ANON_COST_LIMITED`
to our own docs teammate on 6 Nov evening. The README now shows the key as an optional last part
of the URL (`…arkiv.network/${ARKIV_KEY}`), which works with or without one.

**What the app does now.** The web app treats `ANON_COST_LIMITED` as "budget spent", not as a
network blip:
- it stops retrying, which used to take about 6 s per page;
- every read fails at once for 60 s, so it stops spending a budget that's gone;
- it shows its labelled demo data, with a "busy" flag the screens can use
  ([`arkivReads.js`](../web/src/lib/arkivReads.js), with an offline test).

**Suggestion.** Document the anonymous budget: its size, what it's counted per (IP?), and when
it resets. Send a `Retry-After` header with the 429. Also a read-only browser key type, and an
Asia-region RPC.

## 10. Every viem error prints the access key (High)

**What happened.** `rabdi({ accessKey })` puts the key in the RPC URL's path, and viem's errors
quote the full URL (`URL: https://rpc.rabdi…/<key>` in `message` and `metaMessages`). During a slow
spell a read timed out, and the default Node crash output printed **our access key into a log
file**. We caught it, deleted the log and checked the key was never committed. Any app that logs
`error.message`, sends errors to Sentry, or shows them on screen leaks its key the same way.

**Reproduce.** Make any request time out (`http(undefined, { timeout: 1 })`) and print the error.

**Workaround.** A `redact()` on everything the bridge, the smoke test and the web app print or
return ([`bridge/retry.mjs`](../bridge/retry.mjs), [`arkivReads.js`](../web/src/lib/arkivReads.js)).
Arkiv's security skill says to "redact the entire transport diagnostic", but that's easy to miss.

**Suggestion.** Send the key as a header, so URLs and errors never carry it. Or have the SDK wrap
transport errors and strip the path.

## 11. The docs disagree on whether an access key may ship in a browser (Medium)

**What happened.** We had to decide whether our web app's bundle may contain an access key. The
SDK's `rabdi()` TSDoc says the key "is not a secret, as it ships with any app that talks to the
chain, but restrict it to your origins or IPs". Arkiv's `arkiv-security-trust` skill says
"operator RPC keys stay server-side… a browser-wallet user configures their own RPC key", and the
browser guide says "never give a browser the operator's server key".

**What we did.** The bridge's key never ships. At first the app read keyless, which measured fine
in the morning. In the evening the keyless endpoint was rate limited (item 9), so the app now uses
a **separate public read key made only for it**, documented as public and revocable
([how-you-use-arkiv.md](how-you-use-arkiv.md#reads-from-the-browser-and-the-access-key)).

**Suggestion.** One documented answer, ideally a read-only browser key type with origin
restriction and its own quota.

## 12. The SDK can wait minutes for a receipt that was there after 4 seconds (Medium)

**What happened.** A 4-reading batch was mined 4 s after we sent it
([`0x5eacfc2a…`](https://rabdi.explorer.arkiv.network/tx/0x5eacfc2a796589c31ab24c09dfa94ded9de5602f28a778ed517aef65088fa2b1),
block 273,044). But `executeBatch` only returned **505 s later**, while the RPC was answering
slowly. Inside, viem's `waitForTransactionReceipt` has a 180-second default and retries
underneath, and the SDK passes no timeout. Our queue is strictly one write at a time, so every
heartbeat waited behind it. Long enough for the building to look offline.

**Workaround.** Each write attempt now gets a 45-second deadline. Past it, the writer stops waiting
and reconciles by nonce: the transaction is found in the block that used our nonce, without a
second send. An offline test covers it. That run ended "reconciled", with no duplicate.

**Suggestion.** Let callers pass a receipt timeout through `createEntity` / `executeBatch`, or
return `{ txHash, nonce }` right after sending, with the receipt as a second promise.

## 13. Small things that cost minutes

- **A patch keeps the expiry.** This is in the `patchEntity` TSDoc ("a patch never moves … the
  expiry") but not in the README. We verified it live before relying on it: a `daily_output` and a
  `cleaning_job`, patched 1–2 times, kept their exact `$expiresAt` block.
- **"Readonly" entities can still be deleted by their owner** (found earlier in the hackathon), so
  `readonly` is not an audit guarantee. Our meter readings carry the device's signature instead.
- **A bare `bigint` is a `u256`, even for a `u64` column.** `decision_id: 999n` fails with
  `Column "decision_id": a u64 column, but the value is a u256`. The schema knows the column is
  `u64`, so it could coerce. The message does say exactly what to write (`u64(...)`), which helped.
- **`where(undefined)`** throws `Cannot read properties of undefined (reading 'kind')` instead of a
  message about the missing predicate. We hit it while building a query conditionally.

---

### What worked well

- **Typed schemas** (`defineSchema` with `str().indexed()` and friends) caught bad values before
  sending, and made the read code obvious.
- **`ExpirationTime.atDate()`** let "the offer expires when the solar window closes" be one line.
- **Atomic `executeBatch`**: patch + extend in one transaction is exactly what a heartbeat needs.
- **Error messages for engine reverts** (`describeEntityRevert`) are excellent: "entity 0x… expired
  at block N" told us exactly what happened.
- **Arkiv's agent skills** (github.com/Arkiv-Network/skills): the write-safety and expiration
  guides shaped our bridge.

### Issues to file upstream

Items 1, 2, 3, 5, 6, 7, 10, 11 and 12 are ready to file at
[Arkiv-Network/reported-issues](https://github.com/Arkiv-Network/reported-issues). **TODO (Pawan):**
approve filing them and add the links here.
