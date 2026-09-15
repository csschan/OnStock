// Uniswap V3 QuoterV2 — 链上直接查询真实 swap 报价
// 不依赖任何 API key，直接调链上合约

import { parseAbi } from 'viem'
import { clientByChainId } from '../config/rpcClients.js'
import { TOKENS } from '../config/tokens.js'
import type { DexQuote } from './oneinch.js'

// QuoterV2 合约地址（Uniswap 官方部署）
const QUOTER_V2: Record<number, `0x${string}`> = {
  1:     '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', // Ethereum
  56:    '0x78D78E420Da98ad378D7799bE8f4AF69033EB077', // BNB
  8453:  '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a', // Base
  42161: '0x61fFE014bA17989E743c5F6cB21bF9697530B21e', // Arbitrum
}

// USDC 地址
const USDC: Record<number, `0x${string}`> = {
  1:     '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  56:    '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  8453:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  42161: '0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
}

// quoteExactInputSingle ABI
const QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
])

// RWA 代币常见费率档：0.3% 和 1%
const FEE_TIERS: number[] = [3000, 10000]

async function quoteAtFee(
  chainId: number,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  fee: number,
): Promise<bigint | null> {
  const client = clientByChainId[chainId]
  const quoter = QUOTER_V2[chainId]
  if (!client || !quoter) return null

  try {
    const { result } = await client.simulateContract({
      address: quoter,
      abi: QUOTER_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{
        tokenIn,
        tokenOut,
        amountIn,
        fee,
        sqrtPriceLimitX96: 0n,
      }],
    })
    return result[0] as bigint
  } catch {
    return null
  }
}

async function fetchUniswapV3Price(
  contractAddress: string,
  chainId: number,
  decimals: number,
  ticker: string,
  issuer: string,
  tokenSymbol: string,
  chain: string,
): Promise<DexQuote | null> {
  const usdc = USDC[chainId]
  if (!usdc || !QUOTER_V2[chainId]) return null

  const amountIn = BigInt(10 ** decimals) // 1 token
  const tokenIn = contractAddress as `0x${string}`

  // 并行尝试所有费率档，取最优
  const results = await Promise.allSettled(
    FEE_TIERS.map(fee => quoteAtFee(chainId, tokenIn, usdc, amountIn, fee))
  )

  let bestOut: bigint | null = null
  for (const r of results) {
    if (r.status === 'fulfilled' && r.value != null) {
      if (bestOut == null || r.value > bestOut) {
        bestOut = r.value
      }
    }
  }

  if (bestOut == null || bestOut === 0n) return null

  // BNB 链 USDC 是 18 decimals，其他链是 6
  const price = chainId === 56
    ? Number(bestOut) / 1e18
    : Number(bestOut) / 1e6

  if (price <= 0) return null

  console.log(`[UniV3] ${tokenSymbol} on ${chain} = $${price.toFixed(2)}`)

  return {
    ticker,
    issuer,
    chain,
    tokenSymbol,
    contractAddress,
    dexPrice: price,
    source: 'uniswap-v3',
  }
}

export async function fetchAllUniswapV3Quotes(): Promise<DexQuote[]> {
  const evmTokens = TOKENS.filter(t => t.chain !== 'solana' && t.chain !== 'robinhood-chain' && QUOTER_V2[t.chainId])

  const results: DexQuote[] = []
  const batchSize = 5 // 并行处理更多 token，减少总耗时

  for (let i = 0; i < evmTokens.length; i += batchSize) {
    const batch = evmTokens.slice(i, i + batchSize)
    const batchResults = await Promise.allSettled(
      batch.map(t => fetchUniswapV3Price(
        t.contractAddress, t.chainId, t.decimals,
        t.ticker, t.issuer, t.tokenSymbol, t.chain
      ))
    )
    batchResults.forEach(r => {
      if (r.status === 'fulfilled' && r.value) results.push(r.value)
    })
    if (i + batchSize < evmTokens.length) {
      await new Promise(r => setTimeout(r, 100))
    }
  }

  console.log(`[UniV3] Got ${results.length} quotes from Uniswap V3`)
  return results
}
