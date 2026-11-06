import { useState } from 'react'
import { ArrowRight, CheckCircle2, Loader2, TriangleAlert } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { Status, type Job } from '@/contracts/cleaningEscrow'
import { countdown, formatDate, formatFee, isZeroHash, sameAddress } from '@/lib/format'
import type { EscrowAction, TxState } from '@/hooks/useEscrowActions'
import { AddressLink, CopyValue, StatusChip, TxLink } from './Bits'

export interface EscrowInfo {
  oracle: `0x${string}`
  owner: `0x${string}`
  releasePct: number
  disputeWindow: number
}

interface Props {
  job: Job
  me?: `0x${string}`
  info?: EscrowInfo
  now: number
  tx?: TxState
  onAction: (action: EscrowAction, reason?: string) => void
  onClear: () => void
}

const TERMINAL: number[] = [Status.Paid, Status.Refunded, Status.Cancelled]
const REASON_MAX_BYTES = 256

function deadlineLine(job: Job, now: number, windowSecs: number) {
  if (TERMINAL.includes(job.status)) return { label: 'Deadline', text: formatDate(job.deadline), past: false }
  if (job.status === Status.Disputed && now > job.deadline) {
    const c = countdown(job.deadline + windowSecs, now, 'Window ended')
    return { label: 'Dispute window', text: c.text, past: c.past }
  }
  const c = countdown(job.deadline, now)
  return { label: 'Deadline', text: c.text, past: c.past }
}

function TxLine({ tx, onClear }: { tx: TxState; onClear: () => void }) {
  return (
    <div className="inset mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 p-3 text-[13px]" role="status">
      {tx.phase === 'wallet' && (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Confirm in your wallet…
        </span>
      )}
      {tx.phase === 'confirming' && (
        <span className="inline-flex items-center gap-1.5">
          <Loader2 size={14} className="animate-spin" aria-hidden /> Waiting for the block…
        </span>
      )}
      {tx.phase === 'done' && (
        <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--success)' }}>
          <CheckCircle2 size={14} aria-hidden /> Confirmed
        </span>
      )}
      {tx.phase === 'error' && (
        <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--danger)' }}>
          <TriangleAlert size={14} aria-hidden /> {tx.message}
        </span>
      )}
      {tx.hash && <TxLink hash={tx.hash} />}
      {(tx.phase === 'done' || tx.phase === 'error') && (
        <button type="button" className="link ml-auto text-[13px]" onClick={onClear}>
          Dismiss
        </button>
      )}
    </div>
  )
}

export function JobCard({ job, me, info, now, tx, onAction, onClear }: Props) {
  const [disputing, setDisputing] = useState(false)
  const [reason, setReason] = useState('')
  const busy = tx?.phase === 'wallet' || tx?.phase === 'confirming'

  const connected = !!me
  const windowSecs = info?.disputeWindow ?? 0
  const expired = now > job.deadline
  const isPayer = sameAddress(me, job.payer)
  const canAccept =
    connected && job.status === Status.Open && !expired && !isPayer && !sameAddress(me, info?.oracle) && !sameAddress(me, info?.owner)
  const canDispute = connected && job.status === Status.Accepted && !expired && sameAddress(me, job.cleaner)
  const canCancel = connected && job.status === Status.Open && isPayer
  const canRefund =
    connected &&
    (((job.status === Status.Open || job.status === Status.Accepted) && expired) ||
      (job.status === Status.Disputed && windowSecs > 0 && now > job.deadline + windowSecs))
  const hasActions = canAccept || canDispute || canCancel || canRefund

  const reasonBytes = new TextEncoder().encode(reason).length
  const reasonOk = reason.trim().length > 0 && reasonBytes <= REASON_MAX_BYTES
  const dl = deadlineLine(job, now, windowSecs)

  return (
    <article className="card rise p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="display text-lg font-semibold">Job #{job.id.toString()}</h3>
          <StatusChip status={job.status} />
        </div>
        <p className="display inline-flex items-center gap-1.5 text-xl font-semibold tabular-nums">
          <TokenUSDC variant="branded" size={20} aria-hidden />
          {formatFee(job.fee)}
          <span className="text-xs font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
        </p>
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
        <div className="min-w-0">
          <dt className="label">Payer</dt>
          <dd className="mt-0.5"><AddressLink address={job.payer} me={me} /></dd>
        </div>
        <div className="min-w-0">
          <dt className="label">Cleaner</dt>
          <dd className="mt-0.5"><AddressLink address={job.cleaner} me={me} /></dd>
        </div>
        <div>
          <dt className="label">{dl.label}</dt>
          <dd className="mt-0.5 font-medium tabular-nums" style={{ color: dl.past && !TERMINAL.includes(job.status) ? 'var(--danger)' : undefined }}>
            {dl.text}
          </dd>
        </div>
        <div>
          <dt className="label">Panel output</dt>
          <dd className="mt-0.5 inline-flex items-center gap-1.5 font-medium tabular-nums">
            {job.outputBefore}% <ArrowRight size={14} aria-hidden style={{ color: 'var(--subtle)' }} />
            {job.outputAfter > 0 ? `${job.outputAfter}%` : <span style={{ color: 'var(--subtle)' }}>pending</span>}
          </dd>
        </div>
      </dl>

      <dl className="inset mt-4 grid gap-3 p-3.5 text-sm">
        <div className="min-w-0">
          <dt className="label">AI decision (0G request ID)</dt>
          <dd className="mt-0.5">
            {job.ogRequestId ? <CopyValue value={job.ogRequestId} short={false} /> : <span style={{ color: 'var(--subtle)' }}>Not recorded</span>}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="label">Meter proof</dt>
          <dd className="mt-0.5">
            {isZeroHash(job.proof) ? <span style={{ color: 'var(--subtle)' }}>Waiting for the meter</span> : <CopyValue value={job.proof} />}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="label">0G Storage episode log</dt>
          <dd className="mt-0.5">
            {isZeroHash(job.ogStorageRoot) ? <span style={{ color: 'var(--subtle)' }}>Not linked yet</span> : <CopyValue value={job.ogStorageRoot} />}
          </dd>
        </div>
      </dl>

      {hasActions && !disputing && (
        <div className="mt-4 flex flex-wrap gap-2">
          {canAccept && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAction('accept')}>
              Accept job
            </button>
          )}
          {canDispute && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setDisputing(true)}>
              Dispute
            </button>
          )}
          {canCancel && (
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onAction('cancel')}>
              Cancel job
            </button>
          )}
          {canRefund && (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAction('refund')}>
              Refund to payer
            </button>
          )}
        </div>
      )}

      {disputing && canDispute && (
        <form
          className="mt-4 grid gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            if (!reasonOk) return
            onAction('dispute', reason.trim())
            setDisputing(false)
            setReason('')
          }}
        >
          <label className="label" htmlFor={`reason-${job.id}`}>Why are you disputing?</label>
          <textarea
            id={`reason-${job.id}`}
            className="field"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="I cleaned the panel, but it is cloudy."
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className="btn btn-primary" disabled={!reasonOk || busy}>Submit dispute</button>
            <button type="button" className="btn btn-ghost" onClick={() => setDisputing(false)}>Back</button>
            <span className="ml-auto text-xs tabular-nums" style={{ color: reasonBytes > REASON_MAX_BYTES ? 'var(--danger)' : 'var(--subtle)' }}>
              {reasonBytes}/{REASON_MAX_BYTES} bytes
            </span>
          </div>
        </form>
      )}

      {!connected && !TERMINAL.includes(job.status) && (
        <p className="mt-3 text-[13px]" style={{ color: 'var(--subtle)' }}>Connect a wallet to act on this job.</p>
      )}
      {connected && !hasActions && job.status === Status.Disputed && (
        <p className="mt-3 text-[13px]" style={{ color: 'var(--muted)' }}>
          Disputed. The meter can still release it before the deadline, otherwise the committee decides.
        </p>
      )}
      {tx && <TxLine tx={tx} onClear={onClear} />}
    </article>
  )
}
