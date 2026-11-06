import { createPublicClient, http, isAddress, type Address } from 'viem'
import { arcTestnet } from 'viem/chains'
import { requireChain } from '@/onchain-facts'
import { cleaningEscrowAbi } from './cleaningEscrowAbi'

export { cleaningEscrowAbi }

export const CHAIN_ID = arcTestnet.id // 5042002

const rawAddress = import.meta.env.VITE_CLEANING_ESCROW_ADDRESS as string | undefined
/** Deployed CleaningEscrow on Arc Testnet (set in .env as VITE_CLEANING_ESCROW_ADDRESS). */
export const ESCROW_ADDRESS: Address | undefined =
  rawAddress && isAddress(rawAddress) ? rawAddress : undefined

/** Block the contract was deployed at; the event feed never reads before it. */
export const DEPLOY_BLOCK = BigInt((import.meta.env.VITE_CLEANING_ESCROW_DEPLOY_BLOCK as string | undefined) || '0')

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(requireChain(CHAIN_ID).rpcUrls[0], { batch: true }),
})

export const STATUS_LABELS = [
  'None',
  'Open',
  'Accepted',
  'Paid',
  'Refunded',
  'Cancelled',
  'Disputed',
] as const

export const Status = {
  None: 0,
  Open: 1,
  Accepted: 2,
  Paid: 3,
  Refunded: 4,
  Cancelled: 5,
  Disputed: 6,
} as const

export interface Job {
  id: bigint
  payer: Address
  cleaner: Address
  fee: bigint
  deadline: number
  outputBefore: number
  outputAfter: number
  status: number
  proof: `0x${string}`
  ogStorageRoot: `0x${string}`
  ogRequestId: string
}
