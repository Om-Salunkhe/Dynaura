import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAccount } from 'wagmi'
import { Sparkles } from 'lucide-react'
import { ESCROW_ADDRESS } from '@/contracts/cleaningEscrow'
import { useEscrowInfo, useJobs } from '@/hooks/useEscrowData'
import { useEscrowEvents } from '@/hooks/useEscrowEvents'
import { useEscrowActions } from '@/hooks/useEscrowActions'
import { EventFeed } from '@/components/EventFeed'
import { Header } from '@/components/Header'
import { JobCard } from '@/components/JobCard'

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

export default function App() {
  const { address } = useAccount()
  const now = useNow()
  const queryClient = useQueryClient()
  const info = useEscrowInfo()
  const jobs = useJobs()

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['escrow-jobs'] })
    void queryClient.invalidateQueries({ queryKey: ['escrow-info'] })
  }, [queryClient])

  const feed = useEscrowEvents(refresh)
  const { txs, run, clear } = useEscrowActions(refresh)

  const list = jobs.data?.jobs ?? []

  return (
    <div className="mx-auto min-h-dvh w-full max-w-5xl px-4 pb-24 pt-5 sm:px-6 sm:pt-8">
      <Header info={info.data} loading={info.isLoading} me={address} />

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start">
        <section aria-labelledby="jobs-title" className="grid gap-4">
          <div className="flex items-baseline justify-between px-1">
            <h2 id="jobs-title" className="display text-xl font-semibold">Cleaning jobs</h2>
            {jobs.data && (
              <span className="text-sm tabular-nums" style={{ color: 'var(--subtle)' }}>
                {jobs.data.total} total{jobs.data.total > list.length ? ` · latest ${list.length}` : ''}
              </span>
            )}
          </div>

          {!ESCROW_ADDRESS && (
            <div className="card p-5 text-sm" style={{ color: 'var(--danger)' }}>
              VITE_CLEANING_ESCROW_ADDRESS is not set. Add the deployed address to .env and restart the dev server.
            </div>
          )}

          {jobs.isLoading && ESCROW_ADDRESS && (
            <div className="card p-5 text-sm" style={{ color: 'var(--muted)' }} role="status">Reading jobs from Arc Testnet…</div>
          )}

          {jobs.isError && (
            <div className="card p-5 text-sm" style={{ color: 'var(--danger)' }} role="alert">
              Could not read jobs from the network. Retrying every few seconds.
            </div>
          )}

          {jobs.data && list.length === 0 && (
            <div className="card flex flex-col items-center gap-3 p-8 text-center">
              <span className="inline-flex h-12 w-12 items-center justify-center rounded-full" style={{ background: 'var(--info-soft)', color: '#1061a6' }}>
                <Sparkles size={22} aria-hidden />
              </span>
              <p className="max-w-sm text-pretty text-[15px]" style={{ color: 'var(--ink-2)' }}>
                No cleaning jobs yet. When the panel&apos;s output drops under 70%, the building&apos;s AI opens one automatically.
              </p>
            </div>
          )}

          {list.map((job) => (
            <JobCard
              key={job.id.toString()}
              job={job}
              me={address}
              info={info.data}
              now={now}
              tx={txs[job.id.toString()]}
              onAction={(action, reason) => void run(job.id, action, reason)}
              onClear={() => clear(job.id)}
            />
          ))}
        </section>

        <aside className="lg:sticky lg:top-6">
          <EventFeed items={feed.items} state={feed.state} startBlock={feed.startBlock} now={now} />
        </aside>
      </div>
    </div>
  )
}
