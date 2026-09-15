// Solana xStocks Ecosystem 板块
// 展示 Backed Finance 在 Solana 上的所有 xStock token 数据 + DeFi 收益

import Link from 'next/link'
import type { AssetOverview, EarnData } from '@/lib/api'

interface Props {
  overview: AssetOverview[]
  earn: EarnData | null
}

interface SolanaAsset {
  ticker: string
  xTicker: string
  name: string
  price: number | null
  aum: number
  tvl: number
  vol24h: number
  premium: number | null
  bestApy: number | null
  bestProtocol: string | null
}

function fmtUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function fmtPct(n: number | null): string {
  if (n == null) return '—'
  return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
}

export default function SolanaEcosystem({ overview, earn }: Props) {
  const solanaAssets: SolanaAsset[] = overview
    .flatMap(a => {
      const backed = a.issuers.find(i => i.issuer === 'backed' && i.chains.includes('solana'))
      if (!backed) return []
      const ticker = a.ticker
      const xTicker = `${ticker}x`
      const bestEarn = earn?.summary[xTicker] ?? null
      return [{
        ticker, xTicker, name: a.name, price: a.marketPrice,
        aum: backed.aumUsd, tvl: backed.tvlUsd, vol24h: backed.volume24hUsd,
        premium: backed.premiumPct,
        bestApy: bestEarn?.bestApy ?? null,
        bestProtocol: bestEarn?.bestProtocol ?? null,
      }]
    })
    .sort((a, b) => b.aum - a.aum)

  if (solanaAssets.length === 0) return null

  const totalAum = solanaAssets.reduce((s, a) => s + a.aum, 0)
  const totalTvl = solanaAssets.reduce((s, a) => s + a.tvl, 0)
  const totalVol = solanaAssets.reduce((s, a) => s + a.vol24h, 0)
  const bestApy  = Math.max(...solanaAssets.map(a => a.bestApy ?? 0))

  return (
    <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: 24, marginBottom: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 10,
            background: 'linear-gradient(135deg, #9945FF 0%, #14F195 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, fontWeight: 900, color: '#fff',
          }}>◎</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>
              Solana xStocks Ecosystem
            </div>
            <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
              Backed Finance · {solanaAssets.length} tokenized stocks on Raydium / Orca
            </div>
          </div>
        </div>
        <Link href="/earn" style={{
          fontSize: 12, fontWeight: 600, color: '#9945FF',
          textDecoration: 'none', padding: '6px 14px',
          border: '1px solid #9945FF33', borderRadius: 8,
          background: '#9945FF0A',
        }}>
          Earn up to {bestApy.toFixed(1)}% APY →
        </Link>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}>
        {[
          { label: 'Total AUM',    value: fmtUsd(totalAum), color: '#9945FF', bg: '#9945FF0D' },
          { label: 'DEX TVL',      value: fmtUsd(totalTvl), color: '#14F195', bg: '#14F1950D' },
          { label: '24h Volume',   value: fmtUsd(totalVol), color: '#2563EB', bg: '#EFF6FF'   },
          { label: 'Best Earn APY',value: `${bestApy.toFixed(2)}%`, color: '#F59E0B', bg: '#FFFBEB' },
        ].map(c => (
          <div key={c.label} style={{
            background: c.bg, borderRadius: 10, padding: '12px 14px',
            border: `1px solid ${c.color}22`,
          }}>
            <div style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              {c.label}
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Token grid — 最多展示 8 个（按 AUM 排序） */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {solanaAssets.slice(0, 8).map(a => {
          const premColor = a.premium == null ? '#94A3B8' : a.premium < 0 ? '#16A34A' : '#DC2626'
          const premBg    = a.premium == null ? '#F8FAFC'  : a.premium < 0 ? '#F0FDF4'  : '#FEF2F2'
          return (
            <Link key={a.ticker} href={`/asset/${a.ticker}`} style={{ textDecoration: 'none' }}>
              <div style={{
                borderRadius: 10, padding: '12px 14px',
                border: '1px solid #E2E8F0', background: '#FAFAFA',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div>
                    <span style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>{a.xTicker}</span>
                    <span style={{ fontSize: 10, color: '#94A3B8', marginLeft: 4 }}>{a.ticker}</span>
                  </div>
                  <span style={{
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
                    color: '#9945FF', background: '#9945FF15', borderRadius: 4, padding: '2px 5px',
                  }}>SOL</span>
                </div>

                <div style={{ fontSize: 15, fontWeight: 700, color: '#0F172A', fontFamily: 'monospace', marginBottom: 4 }}>
                  {a.price != null ? `$${a.price.toFixed(2)}` : '—'}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <span style={{ fontSize: 10, color: '#94A3B8' }}>vs Oracle</span>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: premColor,
                    background: premBg, borderRadius: 4, padding: '1px 5px',
                  }}>{fmtPct(a.premium)}</span>
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#64748B' }}>
                  <span>TVL {fmtUsd(a.tvl)}</span>
                  <span>Vol {fmtUsd(a.vol24h)}</span>
                </div>

                {a.bestApy != null && a.bestApy > 0 && (
                  <div style={{
                    marginTop: 6, fontSize: 10, fontWeight: 700,
                    color: '#F59E0B', background: '#FFFBEB',
                    borderRadius: 4, padding: '2px 6px', textAlign: 'center',
                  }}>
                    Earn {a.bestApy.toFixed(1)}% · {a.bestProtocol}
                  </div>
                )}
              </div>
            </Link>
          )
        })}
      </div>

      {/* 查看全部按钮 */}
      {solanaAssets.length > 8 && (
        <div style={{ textAlign: 'center', marginTop: 12 }}>
          <Link href="/markets?chain=solana" style={{
            fontSize: 12, color: '#9945FF', textDecoration: 'none', fontWeight: 600,
          }}>
            View all {solanaAssets.length} Solana xStocks →
          </Link>
        </div>
      )}
    </div>
  )
}
