// Solana tokenized stock price fetcher
// 使用 DexScreener API（免费，无需 API key，支持 Raydium/Orca 等 DEX）

import { TOKENS } from '../config/tokens.js'
import type { DexQuote } from './oneinch.js'

const DEXSCREENER_URL = 'https://api.dexscreener.com/latest/dex/tokens'

interface DsPair {
  chainId: string
  dexId: string
  priceUsd: string
  baseToken: { address: string }
  liquidity?: { usd: number }
}

export async function fetchAllSolanaQuotes(): Promise<DexQuote[]> {
  const solanaTokens = TOKENS.filter(t => t.chain === 'solana' && t.contractAddress)
  if (solanaTokens.length === 0) return []

  const results: DexQuote[] = []

  // 逐个查询，每次间隔 300ms 避免限流
  for (const token of solanaTokens) {
    try {
      const res = await fetch(`${DEXSCREENER_URL}/${token.contractAddress}`, {
        signal: AbortSignal.timeout(10000),
      })
      if (!res.ok) {
        console.error(`[Solana/DS] ${token.tokenSymbol}: HTTP ${res.status}`)
        continue
      }
      const data = await res.json() as { pairs?: DsPair[] }
      const pairs = (data.pairs ?? []).filter(
        p => p.chainId === 'solana' && p.priceUsd && p.baseToken.address === token.contractAddress
      )
      if (pairs.length === 0) continue

      // 取流动性最高的池子
      const best = pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0]
      const price = parseFloat(best.priceUsd)
      if (!price || price <= 0) continue

      const liquidityUsd = best.liquidity?.usd ?? null
      console.log(`[Solana/DS] ${token.tokenSymbol} = $${price.toFixed(2)} (liq: $${liquidityUsd?.toFixed(0) ?? '?'}, dex: ${best.dexId})`)

      results.push({
        ticker: token.ticker,
        issuer: token.issuer,
        chain: 'solana',
        tokenSymbol: token.tokenSymbol,
        contractAddress: token.contractAddress,
        dexPrice: price,
        liquidityUsd,
        source: 'dexscreener',
      })
    } catch (err: any) {
      console.error(`[Solana/DS] ${token.tokenSymbol}: ${err.message ?? err}`)
    }

    // 间隔避免限流
    if (solanaTokens.indexOf(token) < solanaTokens.length - 1) {
      await new Promise(r => setTimeout(r, 300))
    }
  }

  return results
}
