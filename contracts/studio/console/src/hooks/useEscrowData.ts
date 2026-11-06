import { useQuery } from '@tanstack/react-query'
import {
  ESCROW_ADDRESS,
  cleaningEscrowAbi,
  publicClient,
  type Job,
} from '@/contracts/cleaningEscrow'

const MAX_JOBS = 50

function requireAddress() {
  if (!ESCROW_ADDRESS) throw new Error('VITE_CLEANING_ESCROW_ADDRESS is not set')
  return ESCROW_ADDRESS
}

/** Contract-level facts shown in the header and used to gate actions. */
export function useEscrowInfo() {
  return useQuery({
    queryKey: ['escrow-info'],
    enabled: !!ESCROW_ADDRESS,
    refetchInterval: 15_000,
    queryFn: async () => {
      const address = requireAddress()
      const read = <F extends 'oracle' | 'owner' | 'RELEASE_PCT' | 'DISPUTE_WINDOW'>(functionName: F) =>
        publicClient.readContract({ address, abi: cleaningEscrowAbi, functionName })
      const [oracle, owner, releasePct, disputeWindow] = await Promise.all([
        read('oracle'),
        read('owner'),
        read('RELEASE_PCT'),
        read('DISPUTE_WINDOW'),
      ])
      return { oracle, owner, releasePct: Number(releasePct), disputeWindow: Number(disputeWindow) }
    },
  })
}

/** Newest-first jobs, polled every 3 seconds. */
export function useJobs() {
  return useQuery({
    queryKey: ['escrow-jobs'],
    enabled: !!ESCROW_ADDRESS,
    refetchInterval: 3_000,
    queryFn: async () => {
      const address = requireAddress()
      const next = await publicClient.readContract({
        address,
        abi: cleaningEscrowAbi,
        functionName: 'nextJobId',
      })
      const last = next - 1n
      const first = last > BigInt(MAX_JOBS) ? last - BigInt(MAX_JOBS) + 1n : 1n
      const ids: bigint[] = []
      for (let id = last; id >= first && id >= 1n; id--) ids.push(id)

      const rows = await Promise.all(
        ids.map((id) =>
          publicClient.readContract({ address, abi: cleaningEscrowAbi, functionName: 'jobs', args: [id] }),
        ),
      )
      const jobs: Job[] = rows.map((r, i) => ({
        id: ids[i],
        payer: r[0],
        cleaner: r[1],
        fee: r[2],
        deadline: Number(r[3]),
        outputBefore: r[4],
        outputAfter: r[5],
        status: r[6],
        proof: r[7],
        ogStorageRoot: r[8],
        ogRequestId: r[9],
      }))
      return { total: Number(last), jobs }
    },
  })
}
