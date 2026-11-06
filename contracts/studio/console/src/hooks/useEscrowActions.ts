import { useCallback, useState } from 'react'
import { useAccount, useSwitchChain, useWriteContract } from 'wagmi'
import { toast } from 'sonner'
import {
  CHAIN_ID,
  ESCROW_ADDRESS,
  cleaningEscrowAbi,
  publicClient,
} from '@/contracts/cleaningEscrow'
import { describeError } from '@/lib/format'

export type EscrowAction = 'accept' | 'dispute' | 'cancel' | 'refund'

export interface TxState {
  action: EscrowAction
  phase: 'wallet' | 'confirming' | 'done' | 'error'
  hash?: `0x${string}`
  message?: string
}

/** Wallet writes for the four actions a cleaner or payer can take. Owner/oracle calls come from the Pi. */
export function useEscrowActions(onMined: () => void) {
  const { chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const [txs, setTxs] = useState<Record<string, TxState>>({})

  const run = useCallback(
    async (jobId: bigint, action: EscrowAction, reason = '') => {
      if (!ESCROW_ADDRESS) return
      const key = jobId.toString()
      const set = (tx: TxState | undefined) =>
        setTxs((prev) => {
          const next = { ...prev }
          if (tx) next[key] = tx
          else delete next[key]
          return next
        })

      set({ action, phase: 'wallet' })
      try {
        if (chainId !== CHAIN_ID) await switchChainAsync({ chainId: CHAIN_ID })
        const base = { address: ESCROW_ADDRESS, abi: cleaningEscrowAbi, chainId: CHAIN_ID } as const
        let hash: `0x${string}`
        if (action === 'dispute') {
          hash = await writeContractAsync({ ...base, functionName: 'dispute', args: [jobId, reason] })
        } else if (action === 'accept') {
          hash = await writeContractAsync({ ...base, functionName: 'accept', args: [jobId] })
        } else if (action === 'cancel') {
          hash = await writeContractAsync({ ...base, functionName: 'cancel', args: [jobId] })
        } else {
          hash = await writeContractAsync({ ...base, functionName: 'refund', args: [jobId] })
        }
        set({ action, phase: 'confirming', hash })
        const receipt = await publicClient.waitForTransactionReceipt({ hash })
        if (receipt.status === 'success') {
          set({ action, phase: 'done', hash })
          toast.success(`Job #${key}: ${action} confirmed`)
        } else {
          set({ action, phase: 'error', hash, message: 'The transaction was mined but reverted.' })
        }
        onMined()
      } catch (error) {
        const message = describeError(error)
        if (message === null) set(undefined)
        else set({ action, phase: 'error', message })
      }
    },
    [chainId, switchChainAsync, writeContractAsync, onMined],
  )

  const clear = useCallback((jobId: bigint) => {
    setTxs((prev) => {
      const next = { ...prev }
      delete next[jobId.toString()]
      return next
    })
  }, [])

  return { txs, run, clear }
}
