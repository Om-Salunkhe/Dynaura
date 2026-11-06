import { useEffect, useRef, useState } from 'react'
import { parseEventLogs } from 'viem'
import {
  DEPLOY_BLOCK,
  ESCROW_ADDRESS,
  cleaningEscrowAbi,
  publicClient,
} from '@/contracts/cleaningEscrow'
import { formatFee, shortAddr } from '@/lib/format'

const FEED_EVENTS = new Set([
  'JobOpened',
  'JobAccepted',
  'JobPaid',
  'JobRefunded',
  'JobCancelled',
  'JobDisputed',
  'DisputeResolved',
  'EpisodeLinked',
])

/** Never scan further back than this many blocks, and never before the deploy block. */
const LOOKBACK_BLOCKS = 5_000n
const RANGE = 900n // address-only getLogs over 1,000 blocks succeeded on the Arc RPC when measured
const MAX_ITEMS = 60

export interface FeedItem {
  key: string
  name: string
  jobId: bigint
  text: string
  txHash: `0x${string}`
  blockNumber: bigint
  logIndex: number
  timestamp?: number
}

type Args = Record<string, unknown>

function describe(name: string, a: Args): string {
  const addr = (k: string) => shortAddr(String(a[k]))
  switch (name) {
    case 'JobOpened':
      return `opened by ${addr('payer')} for ${formatFee(a.fee as bigint)} USDC`
    case 'JobAccepted':
      return `accepted by ${addr('cleaner')}`
    case 'JobPaid':
      return `paid ${formatFee(a.fee as bigint)} USDC to ${addr('cleaner')}${
        Number(a.outputAfter) > 0 ? ` (panel at ${String(a.outputAfter)}%)` : ''
      }`
    case 'JobRefunded':
      return `refunded ${formatFee(a.fee as bigint)} USDC to ${addr('payer')}`
    case 'JobCancelled':
      return `cancelled, ${formatFee(a.fee as bigint)} USDC returned to ${addr('payer')}`
    case 'JobDisputed':
      return `disputed by ${addr('cleaner')}: "${String(a.reason)}"`
    case 'DisputeResolved':
      return `dispute resolved: ${formatFee(a.amount as bigint)} USDC to ${
        a.paidCleaner ? 'cleaner' : 'payer'
      } ${addr('recipient')}`
    case 'EpisodeLinked':
      return 'AI episode log linked on 0G Storage'
    default:
      return name
  }
}

/** Polls the contract's events every 3 seconds, starting from a bounded window near the head. */
export function useEscrowEvents(onNewEvents: () => void) {
  const [items, setItems] = useState<FeedItem[]>([])
  const [state, setState] = useState<'loading' | 'live' | 'error'>('loading')
  const [startBlock, setStartBlock] = useState<bigint>()
  const callback = useRef(onNewEvents)
  useEffect(() => {
    callback.current = onNewEvents
  }, [onNewEvents])

  useEffect(() => {
    if (!ESCROW_ADDRESS) return
    const address = ESCROW_ADDRESS
    const loop: {
      cancelled: boolean
      first: boolean
      cursor?: bigint
      timer?: ReturnType<typeof setTimeout>
    } = { cancelled: false, first: true }
    const seen = new Set<string>()
    const stamps = new Map<bigint, number>()

    async function stamp(block: bigint) {
      const cached = stamps.get(block)
      if (cached) return cached
      const { timestamp } = await publicClient.getBlock({ blockNumber: block })
      stamps.set(block, Number(timestamp))
      return Number(timestamp)
    }

    async function tick() {
      try {
        const head = await publicClient.getBlockNumber()
        if (loop.cursor === undefined) {
          const floor = head > LOOKBACK_BLOCKS ? head - LOOKBACK_BLOCKS : 0n
          loop.cursor = floor > DEPLOY_BLOCK ? floor : DEPLOY_BLOCK
          setStartBlock(loop.cursor)
        }
        const fresh: FeedItem[] = []
        for (let from = loop.cursor; from <= head; from += RANGE) {
          const to = from + RANGE - 1n > head ? head : from + RANGE - 1n
          // The Arc RPC rejects multi-topic filters, so fetch by address and decode locally.
          const raw = await publicClient.getLogs({ address, fromBlock: from, toBlock: to })
          const logs = parseEventLogs({ abi: cleaningEscrowAbi, logs: raw, strict: false })
          for (const log of logs) {
            if (!FEED_EVENTS.has(log.eventName) || !log.transactionHash) continue
            const key = `${log.transactionHash}-${log.logIndex}`
            if (seen.has(key)) continue
            seen.add(key)
            const args = log.args as Args
            fresh.push({
              key,
              name: log.eventName,
              jobId: args.jobId as bigint,
              text: describe(log.eventName, args),
              txHash: log.transactionHash,
              blockNumber: log.blockNumber,
              logIndex: log.logIndex,
            })
          }
        }
        loop.cursor = head
        await Promise.all(
          fresh.map(async (item) => {
            item.timestamp = await stamp(item.blockNumber).catch(() => undefined)
          }),
        )
        if (loop.cancelled) return
        if (fresh.length > 0) {
          setItems((prev) =>
            [...fresh, ...prev]
              .sort((a, b) =>
                a.blockNumber === b.blockNumber ? b.logIndex - a.logIndex : Number(b.blockNumber - a.blockNumber),
              )
              .slice(0, MAX_ITEMS),
          )
          if (!loop.first) callback.current()
        }
        loop.first = false
        setState('live')
      } catch {
        if (!loop.cancelled) setState('error')
      }
      if (!loop.cancelled) loop.timer = setTimeout(() => void tick(), 3_000)
    }

    void tick()
    return () => {
      loop.cancelled = true
      if (loop.timer) clearTimeout(loop.timer)
    }
  }, [])

  return { items, state, startBlock }
}
