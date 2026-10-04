'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { WagmiProvider, createConfig, http } from 'wagmi'
import { mainnet } from 'wagmi/chains'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { defineChain } from 'viem'

export const xlayerTestnet = defineChain({
  id: 1952,
  name: 'X Layer Testnet',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: ['https://testrpc.xlayer.tech'] } },
  blockExplorers: { default: { name: 'OKX Explorer', url: 'https://www.okx.com/explorer/xlayer-test' } },
  testnet: true,
})

export const arbitrumSepolia = defineChain({
  id: 421614,
  name: 'Arbitrum Sepolia',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://sepolia-rollup.arbitrum.io/rpc'] } },
  blockExplorers: { default: { name: 'Arbiscan', url: 'https://sepolia.arbiscan.io' } },
  testnet: true,
})

export const robinhoodTestnet = defineChain({
  id: 46630,
  name: 'Robinhood Testnet',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.chain.robinhood.com'] } },
  blockExplorers: { default: { name: 'Explorer', url: 'https://explorer.testnet.chain.robinhood.com' } },
  testnet: true,
})

// Use EIP-6963 multi-injected provider discovery (wagmi built-in)
// This lets wagmi discover ALL installed wallets separately
// No manual injected() needed — wagmi auto-discovers MetaMask, Phantom, etc.
const wagmiConfig = createConfig({
  chains: [mainnet, xlayerTestnet, arbitrumSepolia, robinhoodTestnet],
  transports: {
    [mainnet.id]: http(),
    [xlayerTestnet.id]: http('https://testrpc.xlayer.tech'),
    [arbitrumSepolia.id]: http('https://sepolia-rollup.arbitrum.io/rpc'),
    [robinhoodTestnet.id]: http('https://rpc.testnet.chain.robinhood.com'),
  },
  // multiInjectedProviderDiscovery: true is the DEFAULT
  // wagmi will use EIP-6963 to discover each wallet as separate connector
})

const queryClient = new QueryClient()

export default function Web3Provider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        {mounted ? children : null}
      </QueryClientProvider>
    </WagmiProvider>
  )
}
