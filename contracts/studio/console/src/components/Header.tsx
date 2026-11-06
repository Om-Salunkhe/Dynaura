import { Gauge, Loader2, LogOut, Plug, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { CHAIN_ID, ESCROW_ADDRESS } from '@/contracts/cleaningEscrow'
import { shortAddr } from '@/lib/format'
import { AddressLink } from './Bits'

interface Info {
  oracle: `0x${string}`
  releasePct: number
}

function WalletButton() {
  const { address, chainId, isConnected } = useAccount()
  const { connectors, connectAsync, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChainAsync, isPending: switching } = useSwitchChain()

  const connect = async () => {
    const injected = connectors.find((c) => c.type === 'injected')
    if (!injected) {
      toast.error('No browser wallet found. Install an injected wallet such as MetaMask.')
      return
    }
    try {
      // Passing chainId makes the wallet switch to, or add, Arc Testnet.
      await connectAsync({ connector: injected, chainId: CHAIN_ID })
    } catch (error) {
      const text = error instanceof Error ? error.message.toLowerCase() : ''
      if (!text.includes('rejected') && !text.includes('denied')) {
        toast.error('Could not connect the wallet. Try again.')
      }
    }
  }

  if (!isConnected || !address) {
    return (
      <button type="button" className="btn btn-primary" onClick={() => void connect()} disabled={isPending}>
        {isPending ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Plug size={16} aria-hidden />}
        {isPending ? 'Connecting…' : 'Connect wallet'}
      </button>
    )
  }

  if (chainId !== CHAIN_ID) {
    return (
      <button
        type="button"
        className="btn btn-primary"
        disabled={switching}
        onClick={() => void switchChainAsync({ chainId: CHAIN_ID }).catch(() => toast.error('Could not switch network.'))}
      >
        {switching && <Loader2 size={16} className="animate-spin" aria-hidden />}
        Switch to Arc Testnet
      </button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <span className="chip mono tabular-nums" style={{ background: 'var(--success-soft)', color: 'var(--success)', minHeight: 44, padding: '0 0.9rem' }}>
        <span className="h-2 w-2 rounded-full" style={{ background: 'var(--success)' }} aria-hidden />
        {shortAddr(address)}
      </span>
      <button
        type="button"
        className="btn btn-ghost"
        style={{ width: 44, padding: 0 }}
        onClick={() => disconnect()}
        aria-label="Disconnect wallet"
        title="Disconnect"
      >
        <LogOut size={16} aria-hidden />
      </button>
    </div>
  )
}

export function Header({ info, loading, me }: { info?: Info; loading: boolean; me?: `0x${string}` }) {
  return (
    <header className="card p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="label flex items-center gap-1.5">
            <Sun size={13} aria-hidden /> Dynaura · Arc Testnet
          </p>
          <h1 className="display mt-2 text-balance text-[1.75rem] font-semibold leading-tight sm:text-4xl">
            Dynaura: Panel cleaning escrow
          </h1>
        </div>
        <WalletButton />
      </div>

      <div
        className="mt-5 flex items-start gap-3 rounded-2xl p-4"
        style={{ background: 'var(--info-soft)' }}
      >
        <Gauge size={20} className="mt-0.5 shrink-0" style={{ color: '#1061a6' }} aria-hidden />
        <p className="text-pretty text-[15px] leading-snug">
          <span className="font-semibold">Pays when the panel&apos;s meter reads ≥ {info?.releasePct ?? 90}%.</span>{' '}
          The fee stays locked in USDC until the building&apos;s meter confirms the clean panel. No one approves the payout by hand.
        </p>
      </div>

      <dl className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="min-w-0">
          <dt className="label">Contract</dt>
          <dd className="mt-1">
            {ESCROW_ADDRESS ? (
              <a
                className="link mono break-all text-[13px] tabular-nums"
                href={buildAddressExplorerUrl(CHAIN_ID, ESCROW_ADDRESS)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {ESCROW_ADDRESS}
              </a>
            ) : (
              <span style={{ color: 'var(--danger)' }}>Contract address is not configured.</span>
            )}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="label">Oracle (the building&apos;s Pi)</dt>
          <dd className="mt-1">
            {info ? (
              <AddressLink address={info.oracle} me={me} />
            ) : (
              <span style={{ color: 'var(--subtle)' }}>{loading ? 'Reading…' : 'Unavailable'}</span>
            )}
          </dd>
        </div>
      </dl>
    </header>
  )
}
