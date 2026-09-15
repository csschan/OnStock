// Hyperliquid 股票永续合约价格 fetcher
// API: POST https://api.hyperliquid.xyz/info { type: "allMids", dex: "xyz" }
// 返回所有 xyz: 前缀的股票永续合约 mid price
// 免费，无需 API key，24/7 有价

import { CANONICAL_ASSETS } from '../assets/canonical.js'

export interface HyperliquidPrice {
  ticker: string
  perpPrice: number    // 永续合约 mid price
}

export async function fetchHyperliquidPrices(): Promise<HyperliquidPrice[]> {
  try {
    const res = await fetch('https://api.hyperliquid.xyz/info', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'allMids', dex: 'xyz' }),
      signal: AbortSignal.timeout(8000),
    })

    if (!res.ok) {
      console.error(`[Hyperliquid] HTTP ${res.status}`)
      return []
    }

    const data = await res.json() as Record<string, string>

    // 只取我们已有的 canonical assets
    const ourTickers = new Set(CANONICAL_ASSETS.map(a => a.ticker))
    const results: HyperliquidPrice[] = []

    for (const [key, priceStr] of Object.entries(data)) {
      if (!key.startsWith('xyz:')) continue
      const ticker = key.slice(4) // remove "xyz:"
      if (!ourTickers.has(ticker)) continue

      const price = parseFloat(priceStr)
      if (!price || price <= 0) continue

      results.push({ ticker, perpPrice: price })
    }

    console.log(`[Hyperliquid] Got ${results.length} stock perp prices`)
    return results
  } catch (err: any) {
    console.error(`[Hyperliquid] ${err.message ?? err}`)
    return []
  }
}
