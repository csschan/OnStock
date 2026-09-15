// Web3 配置：支持 ETH / BNB / Base / Arbitrum
// Robinhood Chain (4663) 通过自定义链配置接入
// CLIENT-ONLY: this file uses wagmi/rainbowkit which require browser context

import { getDefaultConfig } from '@rainbow-me/rainbowkit'
import { mainnet, bsc, base, arbitrum } from 'wagmi/chains'
import { defineChain } from 'viem'

// Re-export pure chain constants (no wagmi dependency) for convenience
export { KYBER_SUPPORTED_CHAINS, USDC_BY_CHAIN, CHAIN_ID } from './chains'

export const robinhoodChain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.mainnet.chain.robinhood.com'] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
})

export const okxXLayer = defineChain({
  id: 196,
  name: 'OKX X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: {
    default: { http: ['https://rpc.xlayer.tech'] },
  },
  blockExplorers: {
    default: { name: 'OKX Explorer', url: 'https://www.okx.com/explorer/xlayer' },
  },
})

export const wagmiConfig = getDefaultConfig({
  appName: 'OnStock',
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_ID ?? 'b7a1e6c4d2f3a8b9c5d6e7f8a9b0c1d2',
  chains: [mainnet, bsc, base, arbitrum, robinhoodChain, okxXLayer],
  ssr: true,
})
