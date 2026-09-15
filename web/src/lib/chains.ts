// Pure chain data — no wagmi/viem imports, safe to use on server and client

export const KYBER_SUPPORTED_CHAINS = new Set([1, 56, 8453, 42161])

// Quote token per chain: USDC on EVM chains, USDG (Global Dollar by Paxos) on Robinhood Chain
export const USDC_BY_CHAIN: Record<number, string> = {
  1:     '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  56:    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  8453:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  42161: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
  4663:  '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168', // USDG on Robinhood Chain
}

export const CHAIN_ID: Record<string, number> = {
  ethereum: 1,
  bnb: 56,
  base: 8453,
  arbitrum: 42161,
  'robinhood-chain': 4663,
  hyperevm: 999,
}

// Uniswap v3 SwapRouter02 — standard CREATE2 address, same across all chains
export const UNISWAP_V3_ROUTER = '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45'
// Uniswap v3 QuoterV2 — standard address
export const UNISWAP_V3_QUOTER = '0x61fFE014bA17989E743c5F6cB21bF9697530B21e'
// Platform fee: 0.1% (10 bps) — collected by routing swap amount through platform wallet
export const PLATFORM_FEE_BPS = 10
