import { useState } from 'react'
import { Check, Copy, ExternalLink } from 'lucide-react'
import type { Address } from 'viem'
import { buildAddressExplorerUrl, buildTxExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID, STATUS_LABELS, Status } from '@/contracts/cleaningEscrow'
import { isZeroAddress, sameAddress, shortAddr, shortHash } from '@/lib/format'

const CHIP_STYLE: Record<number, { bg: string; fg: string }> = {
  [Status.Open]: { bg: 'var(--info-soft)', fg: '#1061a6' },
  [Status.Accepted]: { bg: 'rgba(18,45,69,0.08)', fg: 'var(--ink)' },
  [Status.Paid]: { bg: 'var(--success-soft)', fg: 'var(--success)' },
  [Status.Refunded]: { bg: 'var(--surface-muted)', fg: 'var(--muted)' },
  [Status.Cancelled]: { bg: 'var(--surface-muted)', fg: 'var(--muted)' },
  [Status.Disputed]: { bg: 'var(--danger-soft)', fg: 'var(--danger)' },
}

export function StatusChip({ status }: { status: number }) {
  const style = CHIP_STYLE[status] ?? CHIP_STYLE[Status.Refunded]
  return (
    <span className="chip" style={{ background: style.bg, color: style.fg }}>
      {STATUS_LABELS[status] ?? 'Unknown'}
    </span>
  )
}

export function AddressLink({ address, me }: { address?: Address; me?: Address }) {
  if (isZeroAddress(address) || !address) return <span style={{ color: 'var(--subtle)' }}>Nobody yet</span>
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <a
        className="link mono text-[13px] tabular-nums"
        href={buildAddressExplorerUrl(CHAIN_ID, address)}
        target="_blank"
        rel="noopener noreferrer"
        title={address}
      >
        {shortAddr(address)}
      </a>
      {sameAddress(address, me) && (
        <span className="chip" style={{ background: 'var(--info-soft)', color: '#1061a6', padding: '0.05rem 0.5rem' }}>
          You
        </span>
      )}
    </span>
  )
}

export function TxLink({ hash, label = 'View transaction' }: { hash: string; label?: string }) {
  return (
    <a
      className="link inline-flex items-center gap-1 text-[13px]"
      href={buildTxExplorerUrl(CHAIN_ID, hash)}
      target="_blank"
      rel="noopener noreferrer"
      title={hash}
    >
      {label}
      <ExternalLink size={12} aria-hidden />
    </a>
  )
}

/** A hash or ID shown shortened, with a copy button for the full value. */
export function CopyValue({ value, short = true }: { value: string; short?: boolean }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {
      /* clipboard unavailable: the full value is in the title */
    }
  }
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className="mono break-all text-[13px] tabular-nums" title={value}>
        {short && value.length > 24 ? shortHash(value) : value}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label="Copy"
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full hover:bg-[var(--surface-muted)]"
        style={{ color: 'var(--subtle)' }}
      >
        {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      </button>
    </span>
  )
}
