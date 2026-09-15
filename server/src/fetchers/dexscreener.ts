// DexScreener API fetcher
// 完全免费，无需 API key
// 文档: https://docs.dexscreener.com/api/reference

import axios from 'axios'
import { TOKENS } from '../config/tokens.js'
import type { DexQuote } from './oneinch.js'

const BASE_URL = 'https://api.dexscreener.com/latest/dex'

const CHAIN_MAP: Record<string, string> = {
  ethereum: 'ethereum',
  bnb: 'bsc',
  base: 'base',
  arbitrum: 'arbitrum',
  solana: 'solana',
}

interface DexScreenerPair {
  chainId: string
  dexId: string
  priceUsd: string
  liquidity?: { usd: number }
  baseToken: { address: string; symbol: string }
  quoteToken: { symbol: string }
  volume?: { h24: number }
}

export async function fetchDexScreenerPrice(
  contractAddress: string,
  chain: string,
  ticker: string,
  issuer: string,
  tokenSymbol: string,
): Promise<DexQuote | null> {
  const chainId = CHAIN_MAP[chain] ?? chain

  try {
    const res = await axios.get(`${BASE_URL}/tokens/${contractAddress}`, {
      timeout: 10000,
    })

    const pairs: DexScreenerPair[] = res.data?.pairs ?? []

    // 找匹配链的报价，取流动性最高的
    const matching = pairs
      .filter(p => p.chainId === chainId && p.priceUsd)
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))

    if (matching.length === 0) {
      console.log(`[DexScreener] No pairs found for ${tokenSymbol} on ${chain}`)
      return null
    }

    const best = matching[0]
    const price = parseFloat(best.priceUsd)

    console.log(
      `[DexScreener] ${tokenSymbol} on ${chain} = $${price.toFixed(2)}` +
      ` (${best.dexId}, liquidity: $${(best.liquidity?.usd ?? 0).toLocaleString()})`
    )

    return {
      ticker,
      issuer,
      chain,
      tokenSymbol,
      contractAddress,
      dexPrice: price,
      liquidityUsd: best.liquidity?.usd ?? null,
      source: best.dexId,
    }
  } catch (err) {
    if (axios.isAxiosError(err)) {
      console.error(`[DexScreener] ${tokenSymbol}: ${err.response?.status} ${err.message}`)
    } else {
      console.error(`[DexScreener] ${tokenSymbol}:`, (err as Error).message)
    }
    return null
  }
}

export async function fetchAllDexPrices(): Promise<DexQuote[]> {
  const tokensWithAddress = TOKENS.filter(t => t.contractAddress)

  // 分批，每批3个，避免 rate limit
  const results: DexQuote[] = []
  const batchSize = 3

  for (let i = 0; i < tokensWithAddress.length; i += batchSize) {
    const batch = tokensWithAddress.slice(i, i + batchSize)
    const batchResults = await Promise.allSettled(
      batch.map(t =>
        fetchDexScreenerPrice(t.contractAddress, t.chain, t.ticker, t.issuer, t.tokenSymbol)
      )
    )
    batchResults.forEach(r => {
      if (r.status === 'fulfilled' && r.value) results.push(r.value)
    })
    if (i + batchSize < tokensWithAddress.length) {
      await new Promise(r => setTimeout(r, 300))
    }
  }

  return results
}
