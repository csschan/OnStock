// 股票价格 fetcher - 获取真实股票公允价
// 使用 Yahoo Finance v8 API（免费，无需 API key）

import axios from 'axios'

const TICKERS = [
  'AAPL', 'TSLA', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'AMD', 'SPY', 'QQQ', 'COIN',
  'MSTR', 'PLTR', 'NFLX', 'CRWV', 'CRCL',  // Robinhood/Binance overlap
  'SNDK', 'INTC', 'MU',                       // Binance 独有
]

export async function fetchStockPrice(ticker: string): Promise<number | null> {
  try {
    const res = await axios.get(
      `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0',
          'Accept': 'application/json',
        },
        timeout: 8000,
      }
    )
    const price = res.data?.chart?.result?.[0]?.meta?.regularMarketPrice ?? null
    if (price) console.log(`[Yahoo] ${ticker} = $${price.toFixed(2)}`)
    return price
  } catch (err) {
    console.error(`[Yahoo] Failed to fetch ${ticker}:`, (err as Error).message)
    return null
  }
}

export async function fetchAllStockPrices(): Promise<Map<string, number>> {
  const results = await Promise.allSettled(TICKERS.map(t => fetchStockPrice(t)))
  const map = new Map<string, number>()
  TICKERS.forEach((ticker, i) => {
    const r = results[i]
    if (r.status === 'fulfilled' && r.value !== null) {
      map.set(ticker, r.value)
    }
  })
  return map
}
