import { createPublicClient, http } from 'viem'
import { mainnet, bsc, base, arbitrum } from 'viem/chains'

export const ethClient = createPublicClient({
  chain: mainnet,
  transport: http(process.env.ETH_RPC_URL || 'https://ethereum-rpc.publicnode.com'),
})

export const bnbClient = createPublicClient({
  chain: bsc,
  transport: http(process.env.BNB_RPC_URL || 'https://bsc-dataseed.binance.org'),
})

export const baseClient = createPublicClient({
  chain: base,
  transport: http(process.env.BASE_RPC_URL || 'https://mainnet.base.org'),
})

export const arbitrumClient = createPublicClient({
  chain: arbitrum,
  transport: http(process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc'),
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const clientByChainId: Record<number, any> = {
  1: ethClient,
  56: bnbClient,
  8453: baseClient,
  42161: arbitrumClient,
}
