'use client'

import { WagmiProvider, createConfig, http } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { defineChain } from 'viem'

// X Layer Testnet chain definition
export const xlayerTestnet = defineChain({
  id: 195,
  name: 'X Layer Testnet',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://testrpc.xlayer.tech'] },
  },
  blockExplorers: {
    default: { name: 'OKX Explorer', url: 'https://www.okx.com/explorer/xlayer-test' },
  },
  testnet: true,
})

const wagmiConfig = createConfig({
  chains: [mainnet, xlayerTestnet],
  transports: {
    [mainnet.id]: http(),
    [xlayerTestnet.id]: http('https://testrpc.xlayer.tech'),
  },
})

const queryClient = new QueryClient()

export default function Web3Provider({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {children}
      </QueryClientProvider>
    </WagmiProvider>
  )
}
