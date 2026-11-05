// The building wallet's only writer. Every Arkiv write is a transaction, so:
//
//  1. One write at a time, in arrival order. Two in flight would pick the same nonce and one
//     would fail (the Pi's queue and an admin action can post at the same moment).
//  2. The queue is bounded. Past MAX_QUEUE waiting writes, new ones get a 503 instead of piling
//     up. A heartbeat that is still waiting is replaced by a newer one: only the latest matters.
//  3. Each write is sent with an explicit nonce, read just before, a cached gas price, and an explicit gas limit of
//     1M + 400k per extra operation. The SDK's own estimate (+25%) runs at the latest block and
//     can come out too low: a heartbeat renewed right after the last one looked like a no-op
//     there and ran out of gas a block later. Only gas used is paid (1 gwei on Rabdi).
//     An out-of-gas revert gets exactly one retry, with double the gas and a fresh nonce.
//  4. An exception is not proof the chain said no. Before anything else we find out what happened:
//       - we have the tx hash          -> its receipt decides: success = done (keys read from the
//                                         logs), reverted = failed, no receipt = "uncertain"
//       - no hash, our nonce was used  -> it landed: find it by sender + nonce, read its receipt
//       - no hash, nonce still free    -> it never left: retry once with the SAME nonce, so even
//                                         if the first copy turns up later only one can land
//     An uncertain write is never sent again automatically; it shows up in /health.
import { ENTITY_EVENTS_ABI, EntityMutationError } from "@arkiv-network/sdk"
import { decodeEventLog } from "viem"
import { isRetryable, sleep, withBackoff } from "./retry.mjs"

const ARKIV_ADDRESS = "0x4400000000000000000000000000000000000044" // the entity engine
const MAX_QUEUE = Number(process.env.ARKIV_MAX_QUEUE || 200)
const RECEIPT_WAIT_MS = Number(process.env.ARKIV_RECEIPT_WAIT_MS || 60_000)
const NONCE_SCAN_BLOCKS = 90 // ~3 minutes of 2 s blocks
const MAX_GAS = 15_000_000n // half of Rabdi's 30M block gas limit
/** Gas limit for a batch of `ops` operations (Arkiv's write-safety floor). */
export const gasFor = (ops = 1) => BigInt(1_000_000 + 400_000 * Math.max(0, ops - 1))

export class QueueFullError extends Error {
  status = 503
}
export class UncertainWriteError extends Error {
  status = 502
  constructor(message, { txHash, nonce } = {}) {
    super(message)
    this.txHash = txHash
    this.nonce = nonce
  }
}

/** The node refused the batch in simulation (expired entity, wrong owner, ...): retrying won't help. */
export function isEngineRevert(e) {
  for (let x = e; x; x = x.cause) {
    if (x.name === "ContractFunctionRevertedError") return true
    if (/expired|no entity|is owned by|readonly|engine rejected|would shorten/i.test(String(x.message || ""))) return true
  }
  return false
}

/** Keys and expiries from a successful receipt, the way the SDK reads them. */
export function readReceipt(receipt) {
  const created = []
  const touched = []
  for (const log of receipt.logs ?? []) {
    if (log.address.toLowerCase() !== ARKIV_ADDRESS.toLowerCase()) continue
    try {
      const ev = decodeEventLog({ abi: ENTITY_EVENTS_ABI, topics: log.topics, data: log.data })
      if (ev.eventName === "EntityCreated") created.push(ev.args.entityKey)
      else touched.push(ev.args.entityKey)
    } catch {
      // an event this SDK version doesn't know
    }
  }
  return { txHash: receipt.transactionHash, createdEntities: created, entityKey: created[0] ?? touched[0] }
}

export function createWriter({ publicClient, address, log = console }) {
  const queue = [] // { label, fn, coalesce, waiters: [{resolve, reject}], at }
  let busy = null // { label, since, nonce }
  const counts = { done: 0, failed: 0, retried: 0, reconciled: 0, coalesced: 0, refused: 0 }
  const uncertain = [] // writes we could not settle: never resent, shown in /health
  const recent = [] // last 20 outcomes
  let lastOkAt = 0
  let lastError = null

  const read = (fn) => withBackoff(fn)
  const nonceAt = (blockTag) => read(() => publicClient.getTransactionCount({ address, blockTag }))

  // Legacy gasPrice from eth_gasPrice, refreshed every minute. Without it viem fetches a block and
  // fee estimates on every send, two extra round trips per write.
  let gasPrice = null
  let gasPriceAt = 0
  async function currentGasPrice() {
    if (!gasPrice || Date.now() - gasPriceAt > 60_000) {
      gasPrice = await read(() => publicClient.getGasPrice())
      gasPriceAt = Date.now()
    }
    return gasPrice
  }
  const txParams = async (nonce, item) => ({ nonce, gas: item.gas < MAX_GAS ? item.gas : MAX_GAS, gasPrice: await currentGasPrice() })

  function enqueue(label, fn, { coalesce, ops = 1 } = {}) {
    return new Promise((resolve, reject) => {
      const waiting = coalesce && queue.find((q) => q.coalesce === coalesce)
      if (waiting) {
        waiting.fn = fn // newer data, same slot in line
        waiting.gas = gasFor(ops)
        waiting.waiters.push({ resolve, reject })
        counts.coalesced++
        return
      }
      if (queue.length >= MAX_QUEUE) {
        counts.refused++
        reject(new QueueFullError(`Arkiv write queue full (${MAX_QUEUE}); ${label} refused`))
        return
      }
      queue.push({ label, fn, coalesce, gas: gasFor(ops), waiters: [{ resolve, reject }], at: Date.now() })
      pump()
    })
  }

  async function pump() {
    if (busy || !queue.length) return
    const item = queue.shift()
    busy = { label: item.label, since: Date.now(), nonce: null }
    const t0 = Date.now()
    try {
      const out = await run(item)
      counts.done++
      lastOkAt = Date.now()
      remember({ label: item.label, ok: true, ms: Date.now() - t0, txHash: out?.txHash, how: out?.reconciled ? "reconciled" : "sent" })
      for (const w of item.waiters) w.resolve(out)
    } catch (e) {
      counts.failed++
      lastError = { label: item.label, at: new Date().toISOString(), error: short(e) }
      remember({ label: item.label, ok: false, ms: Date.now() - t0, txHash: e?.txHash, error: short(e) })
      log.warn(`arkiv ${item.label} failed: ${short(e)}`)
      for (const w of item.waiters) w.reject(e)
    } finally {
      busy = null
      setImmediate(pump)
    }
  }

  async function run(item) {
    const nonce = await nonceAt("pending")
    busy.nonce = nonce
    try {
      return await item.fn(await txParams(nonce, item))
    } catch (e) {
      return await reconcile(item, nonce, e, 0)
    }
  }

  async function reconcile(item, nonce, e, attempt) {
    // Rejected by the SDK before any network call (schema, value or expiry checks): nothing sent.
    if (!(e instanceof EntityMutationError) && !isRetryable(e)) throw e
    if (e?.txHash) return await settleByHash(e.txHash, nonce, item, e)

    const latest = await nonceAt("latest")
    if (latest > nonce) return await settleByNonce(nonce, item)
    if ((await nonceAt("pending")) > nonce) {
      // In the mempool: wait for it rather than send a second copy.
      const until = Date.now() + RECEIPT_WAIT_MS
      while (Date.now() < until) {
        await sleep(1000)
        if ((await nonceAt("latest")) > nonce) return await settleByNonce(nonce, item)
      }
      throw markUncertain(item, nonce, undefined, `still pending after ${RECEIPT_WAIT_MS / 1000} s`)
    }
    // Our nonce is unused and nothing is pending: the write never left this machine.
    if (isEngineRevert(e) || !isRetryable(e) || attempt >= 1) throw e
    counts.retried++
    await sleep(500 + Math.random() * 1000)
    try {
      return await item.fn(await txParams(nonce, item))
    } catch (e2) {
      return await reconcile(item, nonce, e2, attempt + 1)
    }
  }

  async function settleByHash(txHash, nonce, item, original) {
    const until = Date.now() + RECEIPT_WAIT_MS
    while (Date.now() < until) {
      const receipt = await publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null)
      if (receipt) {
        if (receipt.status !== "success") {
          const sent = await read(() => publicClient.getTransaction({ hash: txHash })).catch(() => null)
          if (sent && receipt.gasUsed >= sent.gas && !item.gasRetried && sent.gas < MAX_GAS) {
            // Out of gas: nothing was applied. The one retry Arkiv's write-safety guide allows.
            item.gasRetried = true
            item.gas = sent.gas * 2n
            counts.retried++
            log.warn(`arkiv ${item.label} ran out of gas (${sent.gas}); retrying once with ${item.gas}`)
            return await run(item)
          }
          if (original?.txHash === txHash) throw original // the SDK's message says why
          throw Object.assign(new Error(`transaction ${txHash} reverted`), { txHash })
        }
        counts.reconciled++
        return { ...readReceipt(receipt), reconciled: true }
      }
      await sleep(1000)
    }
    throw markUncertain(item, nonce, txHash, `no receipt after ${RECEIPT_WAIT_MS / 1000} s`)
  }

  async function settleByNonce(nonce, item) {
    // We are the only writer for this wallet, so the transaction that used our nonce is ours.
    const head = await read(() => publicClient.getBlockNumber({ cacheTime: 0 }))
    for (let n = head; n >= 0n && n > head - BigInt(NONCE_SCAN_BLOCKS); n--) {
      const block = await read(() => publicClient.getBlock({ blockNumber: n, includeTransactions: true }))
      const tx = block.transactions.find((t) => t.from?.toLowerCase() === address.toLowerCase() && Number(t.nonce) === nonce)
      if (tx) return await settleByHash(tx.hash, nonce, item, null)
    }
    throw markUncertain(item, nonce, undefined, `nonce ${nonce} was used but its transaction was not found in the last ${NONCE_SCAN_BLOCKS} blocks`)
  }

  function markUncertain(item, nonce, txHash, why) {
    const entry = { label: item.label, nonce, txHash, why, at: new Date().toISOString() }
    uncertain.push(entry)
    if (uncertain.length > 20) uncertain.shift()
    log.error(`arkiv ${item.label}: outcome uncertain (${why}); not resending`, txHash || `nonce ${nonce}`)
    return new UncertainWriteError(`outcome uncertain: ${why}`, { txHash, nonce })
  }

  function remember(entry) {
    recent.push({ ...entry, at: new Date().toISOString() })
    if (recent.length > 20) recent.shift()
  }

  function stats() {
    const ok = recent.filter((r) => r.ok)
    return {
      queued: queue.length,
      max_queue: MAX_QUEUE,
      in_flight: busy ? { label: busy.label, for_s: Math.round((Date.now() - busy.since) / 1000), nonce: busy.nonce } : null,
      ...counts,
      uncertain,
      last_ok_s_ago: lastOkAt ? Math.round((Date.now() - lastOkAt) / 1000) : null,
      last_error: lastError,
      avg_write_ms: ok.length ? Math.round(ok.reduce((a, r) => a + r.ms, 0) / ok.length) : null,
      recent: recent.slice(-5),
    }
  }

  return { enqueue, stats, read }
}

function short(e) {
  return String(e?.shortMessage || e?.message || e).split("\n")[0].slice(0, 240)
}
