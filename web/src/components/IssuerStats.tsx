// 首页 Issuer 汇总卡片 — 聚合统计
// Server component

import Link from 'next/link'
import { fetchMarketOverview, type IssuerOverview } from '@/lib/api'

const ISSUER_META: Record<string, {
  name: string
  color: string
  bg: string
  border: string
  barColor: string
}> = {
  ondo:      { name: 'Ondo Finance',   color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE', barColor: '#2563EB' },
  backed:    { name: 'Backed xStocks', color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE', barColor: '#7C3AED' },
  dinari:    { name: 'Dinari',         color: '#059669', bg: '#ECFDF5', border: '#A7F3D0', barColor: '#059669' },
  robinhood: { name: 'Robinhood',      color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', barColor: '#DC2626' },
  binance:   { name: 'Binance bStocks', color: '#F0B90B', bg: '#FFFBEB', border: '#FDE68A', barColor: '#F0B90B' },
}

function fmt(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`
  return n > 0 ? `$${n.toFixed(0)}` : '—'
}

function premiumColor(pct: number | null): string {
  if (pct == null) return '#94A3B8'
  if (Math.abs(pct) < 0.05) return '#64748B'
  return pct > 0 ? '#DC2626' : '#16A34A'
}

function premiumLabel(pct: number | null): string {
  if (pct == null) return '—'
  return `${pct > 0 ? '+' : ''}${pct.toFixed(2)}%`
}

function trendArrow(trend: IssuerOverview['premiumTrend7d']): { symbol: string; color: string; title: string } | null {
  if (!trend || trend.direction == null) return null
  if (trend.direction === 'up')   return { symbol: '↑', color: '#DC2626', title: `Premium rose ${trend.delta > 0 ? '+' : ''}${trend.delta.toFixed(2)}% vs 7d ago` }
  if (trend.direction === 'down') return { symbol: '↓', color: '#16A34A', title: `Premium fell ${trend.delta.toFixed(2)}% vs 7d ago` }
  return { symbol: '→', color: '#94A3B8', title: 'Stable vs 7d ago' }
}

const CHAIN_SHORT: Record<string, string> = {
  ethereum: 'ETH', bnb: 'BNB', base: 'Base',
  arbitrum: 'ARB', solana: 'SOL', 'robinhood-chain': 'RH Chain',
}

export default async function IssuerStats() {
  const overview = await fetchMarketOverview()

  // 按 issuer 聚合
  const issuerAgg: Record<string, {
    aum: number; tvl: number; vol24h: number
    stockCount: number; premiumSum: number; premiumCount: number
    chains: Set<string>; trend: IssuerOverview['premiumTrend7d']
  }> = {}

  for (const asset of overview) {
    for (const iss of asset.issuers) {
      if (!issuerAgg[iss.issuer]) {
        issuerAgg[iss.issuer] = {
          aum: 0, tvl: 0, vol24h: 0,
          stockCount: 0, premiumSum: 0, premiumCount: 0,
          chains: new Set(), trend: iss.premiumTrend7d,
        }
      }
      const agg = issuerAgg[iss.issuer]
      agg.aum += iss.aumUsd
      agg.tvl += iss.tvlUsd ?? 0
      agg.vol24h += iss.volume24hUsd ?? 0
      agg.stockCount++
      if (iss.premiumPct != null) {
        agg.premiumSum += iss.premiumPct
        agg.premiumCount++
      }
      iss.chains.forEach(c => agg.chains.add(c))
      // Use first available trend (all stocks same issuer share same trend)
      if (!agg.trend && iss.premiumTrend7d) agg.trend = iss.premiumTrend7d
    }
  }

  const totalAum = Object.values(issuerAgg).reduce((s, v) => s + v.aum, 0)

  const ORDER = ['ondo', 'backed', 'binance', 'dinari', 'robinhood']
  const cards = ORDER
    .filter(id => issuerAgg[id])
    .map(id => {
      const agg = issuerAgg[id]
      const meta = ISSUER_META[id] ?? { name: id, color: '#64748B', bg: '#F8FAFC', border: '#E2E8F0', barColor: '#94A3B8' }
      const avgPremium = agg.premiumCount > 0 ? agg.premiumSum / agg.premiumCount : null
      const share = totalAum > 0 && agg.aum > 0 ? (agg.aum / totalAum) * 100 : 0
      const chains = Array.from(agg.chains).map(c => CHAIN_SHORT[c] ?? c).join(' · ')
      return { id, meta, aum: agg.aum, tvl: agg.tvl, vol24h: agg.vol24h, stockCount: agg.stockCount, avgPremium, share, chains, trend: agg.trend }
    })

  const totalVol = cards.reduce((s, c) => s + c.vol24h, 0)
  const totalTvl = cards.reduce((s, c) => s + c.tvl, 0)

  return (
    <div>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Issuer Overview</div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
            AUM · TVL · 24h volume · avg premium per institution
          </div>
        </div>
        {totalAum > 0 && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Total OnStock AUM
            </div>
            <div style={{ fontSize: 24, fontWeight: 700, color: '#0F172A' }}>{fmt(totalAum)}</div>
            {totalVol > 0 && (
              <div style={{ fontSize: 11, color: '#64748B' }}>
                {fmt(totalVol)} 24h vol · {fmt(totalTvl)} TVL
              </div>
            )}
          </div>
        )}
      </div>

      {/* 4 cards */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cards.length}, 1fr)`, gap: 12 }}>
        {cards.map(c => (
          <Link
            href={`/issuer/${c.id}`}
            key={c.id}
            className="hover:shadow-md hover:-translate-y-0.5 transition-all block no-underline"
            style={{
              borderRadius: 12,
              border: `1px solid ${c.meta.border}`,
              background: c.meta.bg,
              padding: '16px',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: c.meta.color, marginBottom: 12 }}>
              {c.meta.name}
            </div>

            {/* AUM — primary metric */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>AUM</div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#0F172A' }}>
                {c.aum > 0 ? fmt(c.aum) : '—'}
              </div>
              {c.share > 0 && (
                <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>{c.share.toFixed(0)}% market share</div>
              )}
            </div>

            {/* Secondary metrics grid */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 12px', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 10, color: '#94A3B8' }}>TVL (DEX)</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>
                  {c.tvl > 0 ? fmt(c.tvl) : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#94A3B8' }}>24h Volume</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>
                  {c.vol24h > 0 ? fmt(c.vol24h) : '—'}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#94A3B8' }}>Stocks</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#0F172A' }}>{c.stockCount}</div>
              </div>
              <div>
                <div style={{ fontSize: 10, color: '#94A3B8' }}>Avg Premium</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: 600, color: premiumColor(c.avgPremium) }}>
                    {premiumLabel(c.avgPremium)}
                  </span>
                  {(() => {
                    const arrow = trendArrow(c.trend)
                    return arrow ? (
                      <span
                        title={arrow.title}
                        style={{ fontSize: 12, color: arrow.color, fontWeight: 700, cursor: 'help' }}
                      >
                        {arrow.symbol}
                      </span>
                    ) : null
                  })()}
                </div>
              </div>
            </div>

            {/* Chain tags */}
            <div style={{ fontSize: 10, color: '#64748B', fontWeight: 500, marginBottom: 10 }}>
              {c.chains || '—'}
            </div>

            {/* Market share bar */}
            <div style={{ height: 3, background: 'rgba(255,255,255,0.6)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{
                height: '100%',
                width: `${Math.min(c.share, 100)}%`,
                background: c.meta.barColor,
                borderRadius: 2,
              }} />
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
