"use client";

import { useEffect, useState } from "react";
import { TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import { fetchStocks, fetchMarketStatus, type MarketDeviation } from "@/lib/api";
import { POPULAR_STOCKS } from "@/lib/mock-data";
import { formatPrice, formatPercent } from "@/lib/utils";

interface StockRow {
  ticker: string
  company: string
  sector: string
  oraclePrice: number | null
  dexPrice: number
  change24h: number | null
  premiumPct: number | null
  crossChainSpreadPct: number
  sourceCount: number
}

export default function StockTable() {
  const [rows, setRows] = useState<StockRow[]>([])
  const [loading, setLoading] = useState(true)
  const [deviationMap, setDeviationMap] = useState<Map<string, MarketDeviation>>(new Map())
  const [marketOpen, setMarketOpen] = useState(true)

  useEffect(() => {
    fetchMarketStatus().then(ms => {
      if (!ms) return
      setMarketOpen(ms.market.isOpen)
      const map = new Map(ms.deviations.map(d => [d.ticker, d]))
      setDeviationMap(map)
    })
  }, [])

  useEffect(() => {
    fetchStocks().then(apiStocks => {
      if (apiStocks.length === 0) {
        // 后端没数据时 fallback 到 mock
        setRows(POPULAR_STOCKS.map(s => ({
          ticker: s.ticker,
          company: s.company,
          sector: s.sector,
          oraclePrice: s.basePrice,
          dexPrice: s.basePrice,
          change24h: s.change24h ?? null,
          premiumPct: null,
          crossChainSpreadPct: 0,
          sourceCount: 1,
        })))
      } else {
        // 合并：真实价格 + mock 的公司名/sector
        const merged = apiStocks
          .filter(api => {
            // 过滤掉只有单一 source 且没有 oracle 的股票（数据太少无法展示有价值信息）
            if (api.sourceCount <= 1 && api.oraclePrice == null) return false
            return true
          })
          .map(api => {
            const meta = POPULAR_STOCKS.find(s => s.ticker === api.ticker)
            return {
              ticker: api.ticker,
              company: meta?.company ?? api.ticker,
              sector: meta?.sector ?? '—',
              oraclePrice: api.oraclePrice,
              dexPrice: api.dexPrice,
              change24h: api.change24h ?? meta?.change24h ?? null,
              premiumPct: api.premiumPct,
              crossChainSpreadPct: api.crossChainSpreadPct,
              sourceCount: api.sourceCount,
            }
          })
        setRows(merged)
      }
      setLoading(false)
    })
  }, [])

  if (loading) {
    return (
      <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-[#E2E8F0]">
          <h2 className="font-semibold text-base">Top Tokenized Stocks</h2>
        </div>
        <div className="flex items-center justify-center py-16 text-[#94A3B8]">
          <div className="w-4 h-4 border-2 border-[#2563EB] border-t-transparent rounded-full animate-spin mr-2" />
          Loading live prices...
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white border border-[#E2E8F0] rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[#E2E8F0] flex items-center justify-between">
        <h2 className="font-semibold text-base">Top Tokenized Stocks</h2>
        <div className="flex items-center gap-1 text-xs text-[#94A3B8]">
          <div className="w-2 h-2 bg-[#16A34A] rounded-full animate-pulse" />
          Live
        </div>
      </div>
      <table className="w-full">
        <thead>
          <tr className="text-xs text-[#94A3B8] uppercase tracking-wider">
            <th className="text-left px-5 py-3 font-medium">#</th>
            <th className="text-left px-5 py-3 font-medium">Asset</th>
            <th className="text-right px-5 py-3 font-medium">Market Price</th>
            <th className="text-right px-5 py-3 font-medium">24h</th>
            <th className="text-right px-5 py-3 font-medium">Premium</th>
            <th className="text-right px-5 py-3 font-medium">
              {marketOpen ? "Spread" : "vs Close"}
            </th>
            <th className="text-right px-5 py-3 font-medium"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((stock, i) => {
            const deviation = deviationMap.get(stock.ticker)
            return (
              <tr
                key={stock.ticker}
                className="border-t border-[#F1F5F9] hover:bg-[#F8FAFC] transition-colors"
              >
                <td className="px-5 py-4 text-sm text-[#94A3B8]">{i + 1}</td>
                <td className="px-5 py-4">
                  <a href={`/asset/${stock.ticker}`} className="flex items-center gap-3">
                    <div className="w-9 h-9 bg-[#F1F5F9] rounded-lg flex items-center justify-center flex-shrink-0">
                      <span className="font-semibold text-xs text-[#334155]">{stock.ticker}</span>
                    </div>
                    <div>
                      <p className="font-medium text-sm">{stock.company}</p>
                      <p className="text-xs text-[#94A3B8]">{stock.sourceCount} sources · {stock.sector}</p>
                    </div>
                  </a>
                </td>
                <td className="px-5 py-4 text-right">
                  <span className="font-price text-sm font-medium">
                    ${formatPrice(stock.oraclePrice ?? stock.dexPrice)}
                  </span>
                </td>
                <td className="px-5 py-4 text-right">
                  {stock.change24h != null ? (
                    <span className={`inline-flex items-center gap-0.5 text-sm font-medium ${
                      stock.change24h >= 0 ? "text-[#16A34A]" : "text-[#DC2626]"
                    }`}>
                      {stock.change24h >= 0
                        ? <TrendingUp className="w-3 h-3" />
                        : <TrendingDown className="w-3 h-3" />}
                      {stock.change24h >= 0 ? "+" : ""}{stock.change24h.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-[#94A3B8] text-sm">—</span>
                  )}
                </td>
                <td className="px-5 py-4 text-right">
                  {stock.premiumPct != null ? (
                    <span className={`inline-flex items-center gap-1 text-sm font-medium ${
                      stock.premiumPct > 1 ? "text-[#DC2626]" :
                      stock.premiumPct < -0.1 ? "text-[#16A34A]" :
                      "text-[#64748B]"
                    }`}>
                      {stock.premiumPct > 1 && <AlertCircle className="w-3 h-3" />}
                      {stock.premiumPct >= 0 ? "+" : ""}{stock.premiumPct.toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-[#94A3B8] text-sm">—</span>
                  )}
                </td>
                <td className="px-5 py-4 text-right">
                  {/* Off-hours: show DEX deviation from last oracle close */}
                  {!marketOpen && deviation ? (
                    <span className={`inline-flex items-center gap-1 text-sm font-medium ${
                      deviation.opportunity === "discount" ? "text-[#16A34A]" :
                      deviation.opportunity === "premium" ? "text-[#DC2626]" :
                      "text-[#64748B]"
                    }`}>
                      {deviation.opportunity === "discount" && <TrendingDown className="w-3 h-3" />}
                      {deviation.opportunity === "premium" && <TrendingUp className="w-3 h-3" />}
                      {deviation.deviationPct >= 0 ? "+" : ""}{deviation.deviationPct.toFixed(2)}%
                    </span>
                  ) : (stock.crossChainSpreadPct ?? 0) > 0 ? (
                    <span className={`text-sm font-medium ${
                      stock.crossChainSpreadPct > 0.5 ? "text-[#D97706]" : "text-[#64748B]"
                    }`}>
                      {(stock.crossChainSpreadPct ?? 0).toFixed(2)}%
                    </span>
                  ) : (
                    <span className="text-[#94A3B8] text-sm">—</span>
                  )}
                </td>
                <td className="px-5 py-4 text-right">
                  <a
                    href={`/asset/${stock.ticker}`}
                    className="text-[#2563EB] hover:text-[#1D4ED8] text-sm font-medium transition-colors"
                  >
                    Compare
                  </a>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  );
}
