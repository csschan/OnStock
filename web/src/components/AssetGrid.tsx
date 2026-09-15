'use client'

import { useState } from 'react'
import { TrendingUp, TrendingDown, Star, ShoppingCart } from 'lucide-react'
import type { AssetSummary } from '@/lib/api'

interface AssetGridProps {
  assets: AssetSummary[]
}

const CHAIN_COLORS: Record<string, string> = {
  ethereum: '#627EEA',
  bnb: '#F0B90B',
  base: '#0052FF',
  arbitrum: '#28A0F0',
  solana: '#9945FF',
  'rh-chain': '#00C805',
}

function ScoreBar({ score }: { score: number | null }) {
  if (score == null) return null
  const color = score >= 80 ? '#16A34A' : score >= 60 ? '#D97706' : '#94A3B8'
  return (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 h-1 bg-[#F1F5F9] rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${score}%`, background: color }} />
      </div>
      <span className="text-xs font-medium" style={{ color }}>{score}</span>
    </div>
  )
}

export default function AssetGrid({ assets }: AssetGridProps) {
  const [filter, setFilter] = useState<'all' | 'stock' | 'etf'>('all')
  const [sort, setSort] = useState<'score' | 'premium' | 'name'>('score')

  const filtered = assets
    .filter(a => filter === 'all' || a.type === filter)
    .sort((a, b) => {
      if (sort === 'name') return a.ticker.localeCompare(b.ticker)
      if (sort === 'premium') {
        const pa = a.bestBuy?.premiumPct ?? 999
        const pb = b.bestBuy?.premiumPct ?? 999
        return pa - pb
      }
      // score: sort by bestScore descending
      const sa = a.bestScore?.score ?? 0
      const sb = b.bestScore?.score ?? 0
      return sb - sa
    })

  return (
    <div>
      {/* Controls */}
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <h2 className="font-semibold text-[#0F172A]">All Assets</h2>
        <div className="flex items-center gap-2">
          <div className="flex bg-[#F1F5F9] rounded-lg p-0.5 text-xs">
            {(['all', 'stock', 'etf'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 rounded-md transition-colors font-medium capitalize ${filter === f ? 'bg-white text-[#0F172A] shadow-sm' : 'text-[#64748B] hover:text-[#0F172A]'}`}
              >
                {f}
              </button>
            ))}
          </div>
          <select
            value={sort}
            onChange={e => setSort(e.target.value as typeof sort)}
            className="text-xs border border-[#E2E8F0] rounded-lg px-3 py-1.5 bg-white text-[#0F172A] outline-none cursor-pointer"
          >
            <option value="score">Sort: Best Score</option>
            <option value="premium">Sort: Best Price</option>
            <option value="name">Sort: Name</option>
          </select>
        </div>
      </div>

      {/* Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {filtered.map(asset => {
          const best = asset.bestBuy ?? asset.bestScore
          const canTrade = asset.tradeableCount > 0

          return (
            <a
              key={asset.ticker}
              href={`/asset/${asset.ticker}`}
              className="block bg-white border border-[#E2E8F0] rounded-xl p-4 hover:border-[#2563EB] hover:shadow-sm transition-all group"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 bg-[#F1F5F9] rounded-xl flex items-center justify-center flex-shrink-0 group-hover:bg-[#EFF6FF] transition-colors">
                    <span className="font-bold text-xs text-[#334155]">{asset.ticker}</span>
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-[#0F172A] leading-tight">{asset.name}</p>
                    <p className="text-xs text-[#94A3B8]">{asset.sector}</p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="font-price font-semibold text-sm text-[#0F172A]">
                    {asset.marketPrice ? `$${asset.marketPrice.toFixed(2)}` : '—'}
                  </p>
                  {asset.change24h != null && (
                    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${asset.change24h >= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'}`}>
                      {asset.change24h >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                      {Math.abs(asset.change24h).toFixed(2)}%
                    </span>
                  )}
                </div>
              </div>

              {/* Best route */}
              {best ? (
                <div className="bg-[#F8FAFC] rounded-lg px-3 py-2 mb-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-medium text-[#0F172A] truncate">{best.issuer}</span>
                        <span
                          className="text-xs px-1.5 py-0.5 rounded border flex-shrink-0"
                          style={{
                            color: CHAIN_COLORS[best.chain] ?? '#94A3B8',
                            borderColor: `${CHAIN_COLORS[best.chain] ?? '#94A3B8'}40`,
                            background: `${CHAIN_COLORS[best.chain] ?? '#94A3B8'}10`,
                          }}
                        >
                          {best.chain}
                        </span>
                      </div>
                      <p className="font-price text-xs font-medium text-[#0F172A] mt-0.5">
                        {best.price != null ? `$${best.price.toFixed(2)}` : '—'}{' '}
                        <span className={best.premiumPct != null && best.premiumPct <= 0 ? 'text-[#16A34A]' : 'text-[#DC2626]'}>
                          {best.premiumPct != null ? `(${best.premiumPct >= 0 ? '+' : ''}${best.premiumPct.toFixed(2)}%)` : ''}
                        </span>
                      </p>
                    </div>
                    <div className="flex-shrink-0">
                      <div className="flex items-center gap-1 text-xs text-[#64748B]">
                        <Star className="w-3 h-3" />
                        {best.score ?? '—'}
                      </div>
                    </div>
                  </div>
                  <ScoreBar score={best.score} />
                </div>
              ) : (
                <div className="bg-[#F8FAFC] rounded-lg px-3 py-2 mb-2.5 text-xs text-[#94A3B8]">
                  No live data
                </div>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between">
                <span className="text-xs text-[#94A3B8]">
                  {asset.instrumentCount} versions · {asset.tradeableCount} tradeable
                </span>
                {canTrade && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-[#2563EB] group-hover:gap-1.5 transition-all">
                    <ShoppingCart className="w-3 h-3" />
                    Buy
                  </span>
                )}
              </div>
            </a>
          )
        })}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-16 text-[#94A3B8] text-sm">
          No assets match this filter.
        </div>
      )}
    </div>
  )
}
