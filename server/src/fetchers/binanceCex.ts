// Binance CEX 价格 fetcher — 免费公开 API，无需 API key
// 获取所有 bStock (TSLAB, AAPLB 等) 的 CEX 订单簿实时价格
// 文档: https://binance-docs.github.io/apidocs/spot/en/#symbol-price-ticker

import axios from 'axios'
import type { DexQuote } from './oneinch.js'

const TICKER_URL = 'https://api.binance.com/api/v3/ticker/price'

// bStock 交易对后缀 → ticker 映射
// 币安上交易对格式: TSLAB_USDT → ticker TSLA
const BSTOCK_PAIRS: Record<string, string> = {
  AAPLBUSDT:  'AAPL',
  TSLABUSDT:  'TSLA',
  NVDABUSDT:  'NVDA',
  MSFTBUSDT:  'MSFT',
  AMZNBUSDT:  'AMZN',
  GOOGLBUSDT: 'GOOGL',
  METABUSDT:  'META',
  AMDBUSDT:   'AMD',
  SPYBUSDT:   'SPY',
  QQQBUSDT:   'QQQ',
  COINBUSDT:  'COIN',
  NFLXBUSDT:  'NFLX',
  PLTRBUSDT:  'PLTR',
  SNDKBUSDT:  'SNDK',
  INTCBUSDT:  'INTC',
  MUBUSDT:    'MU',
  MSTRBUSDT:  'MSTR',
  CRWVBUSDT:  'CRWV',
}

export async function fetchBinanceCexPrices(): Promise<DexQuote[]> {
  try {
    // 批量获取所有交易对价格（单次请求）
    const symbols = Object.keys(BSTOCK_PAIRS)
    const { data } = await axios.get(TICKER_URL, {
      params: { symbols: JSON.stringify(symbols) },
      timeout: 10_000,
    })

    const quotes: DexQuote[] = []

    for (const item of data) {
      const ticker = BSTOCK_PAIRS[item.symbol]
      if (!ticker) continue

      const price = parseFloat(item.price)
      if (!price || price <= 0) continue

      // tokenSymbol = 交易对中的 base（如 TSLAB）
      const tokenSymbol = item.symbol.replace('USDT', '')

      quotes.push({
        ticker,
        issuer: 'binance-cex',
        chain: 'binance-cex',
        tokenSymbol,
        contractAddress: '',
        dexPrice: price,
        liquidityUsd: null,
        source: 'binance-cex',
      })

      console.log(`[Binance/CEX] ${tokenSymbol} = $${price.toFixed(2)}`)
    }

    console.log(`[Binance/CEX] Fetched ${quotes.length} bStock prices`)
    return quotes
  } catch (err: any) {
    // 币安 API 可能返回不同格式的错误
    if (err.response?.status === 400) {
      // 尝试逐个获取
      return fetchBinanceCexPricesFallback()
    }
    console.error(`[Binance/CEX] Fetch failed: ${err.message}`)
    return []
  }
}

// 降级方案：逐个获取（如果批量接口格式变化）
async function fetchBinanceCexPricesFallback(): Promise<DexQuote[]> {
  const quotes: DexQuote[] = []

  for (const [symbol, ticker] of Object.entries(BSTOCK_PAIRS)) {
    try {
      const { data } = await axios.get(TICKER_URL, {
        params: { symbol },
        timeout: 5_000,
      })
      const price = parseFloat(data.price)
      if (price > 0) {
        const tokenSymbol = symbol.replace('USDT', '')
        quotes.push({
          ticker,
          issuer: 'binance-cex',
          chain: 'binance-cex',
          tokenSymbol,
          contractAddress: '',
          dexPrice: price,
          liquidityUsd: null,
          source: 'binance-cex',
        })
        console.log(`[Binance/CEX] ${tokenSymbol} = $${price.toFixed(2)}`)
      }
    } catch {
      // skip individual failures
    }
  }

  console.log(`[Binance/CEX] Fallback fetched ${quotes.length} bStock prices`)
  return quotes
}
