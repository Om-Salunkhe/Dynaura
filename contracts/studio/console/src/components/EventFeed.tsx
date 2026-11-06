import { CircleCheck, CircleDollarSign, CircleSlash, FilePlus2, Gavel, HandHelping, Link2, Radio, RotateCcw, TriangleAlert, type LucideIcon } from 'lucide-react'
import type { FeedItem } from '@/hooks/useEscrowEvents'
import { timeAgo } from '@/lib/format'
import { TxLink } from './Bits'

const ICONS: Record<string, LucideIcon> = {
  JobOpened: FilePlus2,
  JobAccepted: HandHelping,
  JobPaid: CircleDollarSign,
  JobRefunded: RotateCcw,
  JobCancelled: CircleSlash,
  JobDisputed: TriangleAlert,
  DisputeResolved: Gavel,
  EpisodeLinked: Link2,
}

interface Props {
  items: FeedItem[]
  state: 'loading' | 'live' | 'error'
  startBlock?: bigint
  now: number
}

export function EventFeed({ items, state, startBlock, now }: Props) {
  return (
    <section className="card p-5" aria-labelledby="feed-title">
      <div className="flex items-center justify-between gap-3">
        <h2 id="feed-title" className="display text-lg font-semibold">Live feed</h2>
        <span
          className="chip"
          style={{
            background: state === 'error' ? 'var(--danger-soft)' : 'var(--success-soft)',
            color: state === 'error' ? 'var(--danger)' : 'var(--success)',
          }}
        >
          <Radio size={12} className={state === 'live' ? 'pulse-dot' : ''} aria-hidden />
          {state === 'error' ? 'Reconnecting' : state === 'loading' ? 'Connecting' : 'Live · every 3s'}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="mt-4 text-sm text-pretty" style={{ color: 'var(--muted)' }}>
          {state === 'loading' ? 'Reading contract events…' : 'No contract events in the recent blocks yet. New ones appear here as they happen.'}
        </p>
      ) : (
        <ol className="mt-4 grid gap-1">
          {items.map((item) => {
            const Icon = ICONS[item.name] ?? CircleCheck
            return (
              <li key={item.key} className="rise flex gap-3 rounded-2xl p-2.5 hover:bg-[var(--surface-muted)]">
                <span
                  className="mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full"
                  style={{ background: 'var(--info-soft)', color: '#1061a6' }}
                >
                  <Icon size={16} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-pretty">
                    <span className="font-semibold">Job #{item.jobId.toString()}</span>{' '}
                    <span style={{ color: 'var(--ink-2)' }}>{item.text}</span>
                  </p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-xs" style={{ color: 'var(--subtle)' }}>
                    <span className="tabular-nums">{timeAgo(item.timestamp, now) || `block ${item.blockNumber.toString()}`}</span>
                    <TxLink hash={item.txHash} label="Transaction" />
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}

      {startBlock !== undefined && (
        <p className="mt-4 text-xs" style={{ color: 'var(--subtle)' }}>
          Showing events from block {startBlock.toString()} onward.
        </p>
      )}
    </section>
  )
}
