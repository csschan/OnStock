// PreStocks price fetcher
// API: https://prestocks.com/api/prestocks
// Returns markPrice (oracle/reference) and tokenPrice (current DEX price) for pre-IPO tokens on Solana

import type { DexQuote } from './oneinch.js'
import { TOKENS } from '../config/tokens.js'

interface PreStockEntry {
  symbol: string
  markPrice: number        // oracle reference price per token
  tokenPrice: number       // current on-chain trading price
  supply: number
  markValuation: number
  contract_address: string
}

const PRESTOCKS_TOKENS = TOKENS.filter(t => t.issuer === 'prestocks')

export async function fetchPreStocksPrices(): Promise<{ quotes: DexQuote[]; oraclePrices: Map<string, number> }> {
  const quotes: DexQuote[] = []
  const oraclePrices = new Map<string, number>()

  try {
    const res = await fetch('https://prestocks.com/api/prestocks', {
      headers: { 'Accept': 'application/json' },
      signal: AbortSignal.timeout(10_000),
    })

    if (!res.ok) {
      console.error(`[PreStocks] HTTP ${res.status}`)
      return { quotes, oraclePrices }
    }

    const data = await res.json() as PreStockEntry[]
    const bySymbol = new Map(data.map(d => [d.symbol.toUpperCase(), d]))

    for (const token of PRESTOCKS_TOKENS) {
      const entry = bySymbol.get(token.ticker.toUpperCase())
      if (!entry) continue

      const tokenPrice = entry.tokenPrice
      const markPrice = entry.markPrice

      if (!tokenPrice || tokenPrice <= 0) continue

      // oracle reference price for this ticker (used for premium calc)
      if (markPrice && markPrice > 0) {
        oraclePrices.set(token.ticker, markPrice)
      }

      quotes.push({
        ticker: token.ticker,
        issuer: 'prestocks',
        chain: 'solana',
        tokenSymbol: token.tokenSymbol,
        contractAddress: token.contractAddress,
        dexPrice: tokenPrice,
        liquidityUsd: entry.supply ? entry.supply * tokenPrice : null,
        source: 'prestocks',
      })
    }

    console.log(`[PreStocks] Got ${quotes.length} pre-IPO quotes`)
  } catch (err: any) {
    console.error(`[PreStocks] ${err.message ?? err}`)
  }

  return { quotes, oraclePrices }
}
