// PancakeSwap V3 QuoterV2 — BNB 链主力 DEX 的链上报价
// PCS V3 是 Uniswap V3 的 fork，Quoter 接口完全一致

import { parseAbi } from 'viem'
import { clientByChainId } from '../config/rpcClients.js'
import { TOKENS } from '../config/tokens.js'
import type { DexQuote } from './oneinch.js'

// PancakeSwap V3 QuoterV2 合约地址
const PCS_QUOTER_V2: Record<number, `0x${string}`> = {
  56: '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997', // BNB
  1:  '0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997', // ETH (有部署但 RWA 流动性少)
}

const USDC: Record<number, `0x${string}`> = {
  56: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  1:  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
}

const QUOTER_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
])

// PancakeSwap V3 费率档：0.01%, 0.05%, 0.25%, 1%
const FEE_TIERS: number[] = [2500, 10000]

async function quoteAtFee(
  chainId: number,
  tokenIn: `0x${string}`,
  tokenOut: `0x${string}`,
  amountIn: bigint,
  fee: number,
): Promise<bigint | null> {
  const client = clientByChainId[chainId]
  const quoter = PCS_QUOTER_V2[chainId]
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

async function fetchPancakeV3Price(
  contractAddress: string,
  chainId: number,
  decimals: number,
  ticker: string,
  issuer: string,
  tokenSymbol: string,
  chain: string,
): Promise<DexQuote | null> {
  const usdc = USDC[chainId]
  const quoter = PCS_QUOTER_V2[chainId]
  if (!usdc || !quoter) return null

  const amountIn = BigInt(10 ** decimals)
  const tokenIn = contractAddress as `0x${string}`

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

  const price = chainId === 56
    ? Number(bestOut) / 1e18
    : Number(bestOut) / 1e6

  if (price <= 0) return null

  console.log(`[PCSv3] ${tokenSymbol} on ${chain} = $${price.toFixed(2)}`)

  return {
    ticker,
    issuer,
    chain,
    tokenSymbol,
    contractAddress,
    dexPrice: price,
    source: 'pancakeswap-v3',
  }
}

export async function fetchAllPancakeV3Quotes(): Promise<DexQuote[]> {
  // 主要查 BNB 链，ETH 链上 PancakeSwap RWA 流动性太少
  const tokens = TOKENS.filter(t => t.chainId === 56 && t.contractAddress)

  const results: DexQuote[] = []
  const batchSize = 2

  for (let i = 0; i < tokens.length; i += batchSize) {
    const batch = tokens.slice(i, i + batchSize)
    const batchResults = await Promise.allSettled(
      batch.map(t => fetchPancakeV3Price(
        t.contractAddress, t.chainId, t.decimals,
        t.ticker, t.issuer, t.tokenSymbol, t.chain
      ))
    )
    batchResults.forEach(r => {
      if (r.status === 'fulfilled' && r.value) results.push(r.value)
    })
    if (i + batchSize < tokens.length) {
      await new Promise(r => setTimeout(r, 500))
    }
  }

  console.log(`[PCSv3] Got ${results.length} quotes from PancakeSwap V3`)
  return results
}
