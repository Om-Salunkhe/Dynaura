// Offline tests for writer.mjs against a fake chain: the failure paths that are hard to hit live.
//   npm test
import assert from "node:assert/strict"
import { test } from "node:test"
import { ENTITY_EVENTS_ABI, EntityMutationError } from "@arkiv-network/sdk"
import { encodeAbiParameters, encodeEventTopics, keccak256, toHex } from "viem"

process.env.ARKIV_MAX_QUEUE = "3"
process.env.ARKIV_RECEIPT_WAIT_MS = "300"
process.env.ARKIV_WRITE_DEADLINE_MS = "200"
const { createWriter, QueueFullError, UncertainWriteError } = await import("./writer.mjs")

const ME = "0x00000000000000000000000000000000000000aa"
const ENGINE = "0x4400000000000000000000000000000000000044"
const quiet = { warn() {}, error() {} }

/** A chain that only knows nonces, transactions and receipts. */
function fakeChain() {
  const c = { latest: 0, pending: 0, txs: new Map(), blocks: [], calls: [] }
  c.mine = (nonce, { status = "success", created = [], gas = 1_000_000n, gasUsed = 50_000n } = {}) => {
    const hash = keccak256(toHex(`tx-${nonce}-${c.blocks.length}`))
    const logs = created.map((key) => ({
      address: ENGINE,
      topics: encodeEventTopics({ abi: ENTITY_EVENTS_ABI, eventName: "EntityCreated", args: { entityKey: key, owner: ME } }),
      data: encodeAbiParameters([{ type: "uint64" }, { type: "uint8" }], [100n, 0]),
    }))
    const tx = { hash, from: ME, nonce, gas }
    c.txs.set(hash, { tx, receipt: { transactionHash: hash, status, gasUsed, logs } })
    c.blocks.push({ number: BigInt(c.blocks.length), transactions: [tx] })
    c.latest = c.pending = Math.max(c.latest, nonce + 1)
    return hash
  }
  c.client = {
    getTransactionCount: async ({ blockTag }) => (blockTag === "pending" ? c.pending : c.latest),
    getTransactionReceipt: async ({ hash }) => {
      const t = c.txs.get(hash)
      if (!t) throw new Error("receipt not found")
      return t.receipt
    },
    getTransaction: async ({ hash }) => c.txs.get(hash).tx,
    getBlockNumber: async () => BigInt(Math.max(0, c.blocks.length - 1)),
    getBlock: async ({ blockNumber }) => c.blocks[Number(blockNumber)] ?? { transactions: [] },
    getGasPrice: async () => 1_000_000_000n,
  }
  return c
}

const key = (n) => keccak256(toHex(`entity-${n}`))

test("writes run one at a time, each on the next nonce, with gas and gasPrice set", async () => {
  const c = fakeChain()
  const w = createWriter({ publicClient: c.client, address: ME, log: quiet })
  let running = 0
  const seen = []
  const job = (i) => async (tx) => {
    assert.equal(++running, 1, "two writes in flight")
    seen.push(tx)
    await new Promise((r) => setTimeout(r, 10))
    running--
    return { txHash: c.mine(tx.nonce), i }
  }
  const out = await Promise.all([w.enqueue("a", job(0)), w.enqueue("b", job(1)), w.enqueue("c", job(2), { ops: 4 })])
  assert.deepEqual(out.map((o) => o.i), [0, 1, 2])
  assert.deepEqual(seen.map((t) => t.nonce), [0, 1, 2])
  assert.equal(seen[0].gas, 1_000_000n)
  assert.equal(seen[2].gas, 2_200_000n) // 1M + 400k per extra operation
  assert.equal(seen[0].gasPrice, 1_000_000_000n)
})

test("a waiting heartbeat is replaced by a newer one; every caller gets the result", async () => {
  const c = fakeChain()
  const w = createWriter({ publicClient: c.client, address: ME, log: quiet })
  const sent = []
  const hb = (v) => async (tx) => {
    sent.push(v)
    await new Promise((r) => setTimeout(r, 10))
    return { txHash: c.mine(tx.nonce), v }
  }
  const out = await Promise.all([1, 2, 3, 4].map((v) => w.enqueue("heartbeat", hb(v), { coalesce: "heartbeat" })))
  assert.deepEqual(sent, [1, 4]) // the first was already in flight; 2 and 3 were superseded by 4
  assert.deepEqual(out.map((o) => o.v), [1, 4, 4, 4])
  assert.equal(w.stats().coalesced, 2)
})

test("a full queue refuses new writes instead of growing", async () => {
  const c = fakeChain()
  const w = createWriter({ publicClient: c.client, address: ME, log: quiet })
  let release
  const gate = new Promise((r) => (release = r))
  const slow = async (tx) => {
    await gate
    return { txHash: c.mine(tx.nonce) }
  }
  const first = w.enqueue("in flight", slow)
  await new Promise((r) => setTimeout(r, 5))
  const queued = [1, 2, 3].map((i) => w.enqueue(`q${i}`, slow))
  await assert.rejects(w.enqueue("one too many", slow), QueueFullError)
  release()
  await Promise.all([first, ...queued])
})

test("error with a tx hash: the receipt decides, keys come from the logs, nothing is resent", async () => {
  const c = fakeChain()
  const w = createWriter({ publicClient: c.client, address: ME, log: quiet })
  let calls = 0
  const out = await w.enqueue("create", async (tx) => {
    calls++
    const hash = c.mine(tx.nonce, { created: [key(1)] })
    throw new EntityMutationError("lost the response", { txHash: hash })
  })
  assert.equal(calls, 1)
  assert.equal(out.reconciled, true)
  assert.deepEqual(out.createdEntities, [key(1)])
  assert.equal(out.entityKey, key(1))
})

test("no hash but the nonce was used: found by sender + nonce, not resent", async () => {
  const c = fakeChain()
  const w = createWriter({ publicClient: c.client, address: ME, log: quiet })
  let calls = 0
  const out = await w.enqueue("create", async (tx) => {
    calls++
    c.mine(tx.nonce, { created: [key(2)] })
    throw new EntityMutationError("socket hang up") // the send went through, the reply was lost
  })
  assert.equal(calls, 1)
  assert.equal(out.entityKey, key(2))
})

test("no hash, nonce unused, rate limited: one retry on the SAME nonce", async () => {
  const c = fakeChain()
  const w = createWriter({ publicClient: c.client, address: ME, log: quiet })
  const nonces = []
  const out = await w.enqueue("create", async (tx) => {
    nonces.push(tx.nonce)
    if (nonces.length === 1) throw new EntityMutationError("Transaction failed: HTTP 429 Too Many Requests")
    return { txHash: c.mine(tx.nonce), ok: true }
  })
  assert.deepEqual(nonces, [0, 0])
  assert.equal(out.ok, true)
  assert.equal(w.stats().retried, 1)
})

test("the engine refused the write (expired entity): no retry", async () => {
  const c = fakeChain()
  const w = createWriter({ publicClient: c.client, address: ME, log: quiet })
  let calls = 0
  await assert.rejects(
    w.enqueue("patch", async () => {
      calls++
      throw new EntityMutationError("Transaction failed: entity 0x12…34 expired at block 10")
    }),
    /expired/,
  )
  assert.equal(calls, 1)
})

test("out of gas: exactly one retry, double gas, fresh nonce", async () => {
  const c = fakeChain()
  const w = createWriter({ publicClient: c.client, address: ME, log: quiet })
  const seen = []
  const out = await w.enqueue("renew", async (tx) => {
    seen.push(tx)
    if (seen.length === 1) {
      const hash = c.mine(tx.nonce, { status: "reverted", gas: tx.gas, gasUsed: tx.gas })
      throw new EntityMutationError("ran out of gas", { txHash: hash })
    }
    return { txHash: c.mine(tx.nonce) }
  })
  assert.equal(seen.length, 2)
  assert.equal(seen[1].gas, seen[0].gas * 2n)
  assert.equal(seen[1].nonce, seen[0].nonce + 1)
  assert.ok(out.txHash)
})

test("a revert that is not out of gas is final, with the SDK's reason", async () => {
  const c = fakeChain()
  const w = createWriter({ publicClient: c.client, address: ME, log: quiet })
  let calls = 0
  await assert.rejects(
    w.enqueue("patch", async (tx) => {
      calls++
      const hash = c.mine(tx.nonce, { status: "reverted", gasUsed: 30_000n })
      throw new EntityMutationError("reverted. Reason: entity is owned by someone else", { txHash: hash })
    }),
    /owned by someone else/,
  )
  assert.equal(calls, 1)
})

test("a hash with no receipt is marked uncertain and never resent", async () => {
  const c = fakeChain()
  const w = createWriter({ publicClient: c.client, address: ME, log: quiet })
  let calls = 0
  await assert.rejects(
    w.enqueue("create", async () => {
      calls++
      throw new EntityMutationError("timed out waiting for receipt", { txHash: keccak256(toHex("ghost")) })
    }),
    UncertainWriteError,
  )
  assert.equal(calls, 1)
  assert.equal(w.stats().uncertain.length, 1)
})

test("an SDK call that hangs after the tx was mined: found by nonce at the deadline, not resent", async () => {
  const c = fakeChain()
  const w = createWriter({ publicClient: c.client, address: ME, log: quiet })
  let calls = 0
  const t0 = Date.now()
  const out = await w.enqueue("readings", async (tx) => {
    calls++
    c.mine(tx.nonce, { created: [key(3)] }) // mined at once...
    return new Promise(() => {}) // ...but the receipt wait never returns
  })
  assert.equal(calls, 1)
  assert.equal(out.entityKey, key(3))
  assert.ok(Date.now() - t0 < 2000, "settled at the deadline, not minutes later")
})
