// Robinhood Chain (chainId: 4663) 价格 fetcher
// 使用 Robinhood 官方 REST API — 免费，无需 API key
// 文档: https://docs.robinhood.com/chain/stock-token-apis/
// 价格来源：链上 Uniswap v4 池的实时 bid/ask 中间价

import axios from 'axios'
import { TOKENS } from '../config/tokens.js'
import type { DexQuote } from './oneinch.js'

const BASE_URL = 'https://api.robinhood.com/rhj'

interface RobinhoodQuote {
  tokenSymbol: string
  bid: string
  ask: string
  isTradingHalt: boolean
  dailyTradingVolume: string
  deployments: { contractAddress: string; chainId: number }[]
}

async function fetchRobinhoodPrice(
  ticker: string,
  tokenSymbol: string,
  contractAddress: string,
): Promise<DexQuote | null> {
  try {
    const res = await axios.get(`${BASE_URL}/prices/${ticker}`, {
      timeout: 8000,
      headers: { 'Accept': 'application/json' },
    })

    const quotes: RobinhoodQuote[] = res.data?.quotes ?? []
    if (quotes.length === 0) return null

    const q = quotes[0]

    if (q.isTradingHalt) {
      console.log(`[Robinhood] ${ticker} trading halted, skipping`)
      return null
    }

    const bid = parseFloat(q.bid)
    const ask = parseFloat(q.ask)
    if (!bid || !ask || bid <= 0 || ask <= 0) return null

    // 中间价
    const midPrice = (bid + ask) / 2
    const liquidityUsd = parseFloat(q.dailyTradingVolume) || null

    console.log(`[Robinhood] ${ticker} = $${midPrice.toFixed(2)} (bid=${bid} ask=${ask})`)

    return {
      ticker,
      issuer: 'robinhood',
      chain: 'robinhood-chain',
      tokenSymbol,
      contractAddress,
      dexPrice: midPrice,
      liquidityUsd,
      source: 'robinhood',
    }
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status
      const msg = err.response?.data?.message || err.message
      if (status !== 404) {
        console.error(`[Robinhood] ${ticker}: ${status} ${msg}`)
      }
    }
    return null
  }
}

export async function fetchAllRobinhoodQuotes(): Promise<DexQuote[]> {
  const rhTokens = TOKENS.filter(t => t.chain === 'robinhood-chain')
  if (rhTokens.length === 0) return []

  const results: DexQuote[] = []
  const batchSize = 5

  for (let i = 0; i < rhTokens.length; i += batchSize) {
    const batch = rhTokens.slice(i, i + batchSize)
    const batchResults = await Promise.allSettled(
      batch.map(t => fetchRobinhoodPrice(t.ticker, t.tokenSymbol, t.contractAddress))
    )
    batchResults.forEach(r => {
      if (r.status === 'fulfilled' && r.value) results.push(r.value)
    })
    if (i + batchSize < rhTokens.length) {
      await new Promise(r => setTimeout(r, 200))
    }
  }

  return results
}
