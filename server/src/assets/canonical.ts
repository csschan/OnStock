import { CanonicalAsset } from './types'

/**
 * 所有支持的 Canonical Assets
 * 这是用户搜索的维度 — 股票/ETF
 * instruments 会在 buildAssetGraph() 中从 tokens.ts 自动填充
 */
export const CANONICAL_ASSETS: Omit<CanonicalAsset, 'instruments' | 'bestBuy' | 'bestScore' | 'marketPrice' | 'change24h'>[] = [
  // ─── Tech ───
  { ticker: 'AAPL',  name: 'Apple Inc.',           sector: 'Technology', type: 'stock' },
  { ticker: 'TSLA',  name: 'Tesla Inc.',            sector: 'Automotive', type: 'stock' },
  { ticker: 'NVDA',  name: 'NVIDIA Corp.',          sector: 'Technology', type: 'stock' },
  { ticker: 'MSFT',  name: 'Microsoft Corp.',       sector: 'Technology', type: 'stock' },
  { ticker: 'GOOGL', name: 'Alphabet Inc.',         sector: 'Technology', type: 'stock' },
  { ticker: 'AMZN',  name: 'Amazon.com Inc.',       sector: 'Technology', type: 'stock' },
  { ticker: 'META',  name: 'Meta Platforms Inc.',    sector: 'Technology', type: 'stock' },
  { ticker: 'AMD',   name: 'Advanced Micro Devices', sector: 'Technology', type: 'stock' },
  { ticker: 'COIN',  name: 'Coinbase Global Inc.',  sector: 'Finance',    type: 'stock' },

  // ─── ETFs ───
  { ticker: 'SPY',   name: 'S&P 500 ETF',          sector: 'Index',      type: 'etf' },
  { ticker: 'QQQ',   name: 'Nasdaq-100 ETF',       sector: 'Index',      type: 'etf' },

  // ─── Robinhood / Binance 独家 ───
  { ticker: 'MSTR',  name: 'Strategy Inc.',          sector: 'Technology', type: 'stock' },
  { ticker: 'PLTR',  name: 'Palantir Technologies', sector: 'Technology', type: 'stock' },
  { ticker: 'NFLX',  name: 'Netflix Inc.',          sector: 'Entertainment', type: 'stock' },
  { ticker: 'SPCX',  name: 'SPDR S&P China ETF',   sector: 'Index',      type: 'etf' },
  { ticker: 'CRWV',  name: 'CrowdStrike Holdings',  sector: 'Technology', type: 'stock' },
  { ticker: 'CRCL',  name: 'Circle Internet Group', sector: 'Finance',    type: 'stock' },
  { ticker: 'SNDK',  name: 'SanDisk Corp.',         sector: 'Technology', type: 'stock' },
  { ticker: 'INTC',  name: 'Intel Corp.',           sector: 'Technology', type: 'stock' },
  { ticker: 'MU',    name: 'Micron Technology',     sector: 'Technology', type: 'stock' },
]
