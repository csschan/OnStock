// KyberSwap API fetcher — EVM 链报价
// 完全免费，无需 API key
// 文档: https://docs.kyberswap.com/kyberswap-solutions/kyberswap-aggregator/aggregator-api-specification/evm-swaps

import axios from 'axios'
import { TOKENS } from '../config/tokens.js'
import type { DexQuote } from './oneinch.js'

const BASE_URL = 'https://aggregator-api.kyberswap.com'

// KyberSwap 链名映射
const CHAIN_SLUG: Record<number, string> = {
  1:    'ethereum',
  56:   'bsc',
  8453: 'base',
  42161: 'arbitrum',
}

// USDC 地址（各链）
const USDC: Record<number, string> = {
  1:    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  56:   '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d',
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  42161:'0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8',
}

export async function fetchKyberPrice(
  contractAddress: string,
  chainId: number,
  decimals: number,
  ticker: string,
  issuer: string,
  tokenSymbol: string,
  chain: string,
): Promise<DexQuote | null> {
  const chainSlug = CHAIN_SLUG[chainId]
  const usdc = USDC[chainId]
  if (!chainSlug || !usdc) return null

  try {
    // 卖出 1 个 token，获得 USDC
    const amount = BigInt(10 ** decimals).toString()

    const res = await axios.get(
      `${BASE_URL}/${chainSlug}/api/v1/routes`,
      {
        params: {
          tokenIn: contractAddress,
          tokenOut: usdc,
          amountIn: amount,
        },
        headers: { 'x-client-id': 'rwa-aggregator' },
        timeout: 10000,
      }
    )

    const routeData = res.data?.data?.routeSummary
    if (!routeData) return null

    const usdcOut = Number(routeData.amountOut)
    const price = usdcOut / 1e6  // USDC 是 6 decimals（ETH/Base），BNB 链 USDC 是 18

    // BNB 链 USDC 是 18 decimals
    const finalPrice = chainId === 56 ? usdcOut / 1e18 : usdcOut / 1e6

    if (finalPrice <= 0) return null

    console.log(`[KyberSwap] ${tokenSymbol} on ${chain} = $${finalPrice.toFixed(2)}`)

    return {
      ticker,
      issuer,
      chain,
      tokenSymbol,
      contractAddress,
      dexPrice: finalPrice,
      source: 'kyberswap',
    }
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status
      const msg = err.response?.data?.message || err.message
      // 404 = token 没有流动性，正常跳过
      if (status !== 404) {
        console.error(`[KyberSwap] ${tokenSymbol} on ${chain}: ${status} ${msg}`)
      }
    }
    return null
  }
}

export async function fetchAllEvmQuotes(): Promise<DexQuote[]> {
  const evmTokens = TOKENS.filter(t => t.chain !== 'solana' && CHAIN_SLUG[t.chainId])

  const results: DexQuote[] = []
  const batchSize = 3

  for (let i = 0; i < evmTokens.length; i += batchSize) {
    const batch = evmTokens.slice(i, i + batchSize)
    const batchResults = await Promise.allSettled(
      batch.map(t => fetchKyberPrice(
        t.contractAddress, t.chainId, t.decimals,
        t.ticker, t.issuer, t.tokenSymbol, t.chain
      ))
    )
    batchResults.forEach(r => {
      if (r.status === 'fulfilled' && r.value) results.push(r.value)
    })
    if (i + batchSize < evmTokens.length) {
      await new Promise(r => setTimeout(r, 300))
    }
  }

  return results
}
