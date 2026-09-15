// 溢价热力图：股票 × 机构 的溢价/折价矩阵
// 绿色 = 折价（便宜），红色 = 溢价（贵），灰色 = 无数据

import Link from 'next/link'
import type { MarketStats } from '@/lib/api'

const ALL_ISSUERS = [
  { id: 'ondo',        short: 'Ondo',        color: '#2563EB' },
  { id: 'backed-eth',  short: 'Backed ETH',  color: '#7C3AED' },
  { id: 'backed-sol',  short: 'Backed SOL',  color: '#9945FF' },
  { id: 'binance',     short: 'Binance',     color: '#F0B90B' },
  { id: 'dinari',      short: 'Dinari',      color: '#059669' },
  { id: 'robinhood',   short: 'Robin.',      color: '#DC2626' },
]

function cellStyle(pct: number | null): { background: string; color: string } {
  if (pct == null) return { background: '#F8FAFC', color: '#CBD5E1' }
  const abs = Math.abs(pct)
  if (abs < 0.2) return { background: '#F1F5F9', color: '#64748B' }          // ≈ flat
  if (pct < 0) {
    // discount (green) — intensity by magnitude
    const intensity = Math.min(abs / 5, 1)
    const g = Math.round(220 - intensity * 80)
    return { background: `rgba(22, 163, 74, ${0.1 + intensity * 0.35})`, color: '#15803D' }
  } else {
    // premium (red)
    const intensity = Math.min(abs / 5, 1)
    return { background: `rgba(220, 38, 38, ${0.1 + intensity * 0.35})`, color: '#B91C1C' }
  }
}

interface Props {
  heatmap: MarketStats['heatmap']
}

export default function PremiumHeatmap({ heatmap }: Props) {
  // Filter out issuers where ALL cells are orderbook (no real DEX premium data)
  const ISSUERS = ALL_ISSUERS.filter(iss =>
    heatmap.some(row => {
      const cell = row.cells.find(c => c.issuer === iss.id)
      return cell && cell.note !== 'orderbook'
    })
  )

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Premium / Discount Heatmap</div>
          <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>
            DEX price vs oracle price — green = cheaper than market, red = more expensive
          </div>
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#64748B' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: 'rgba(22,163,74,0.35)' }} />
            Discount (buy)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: 'rgba(220,38,38,0.35)' }} />
            Premium (expensive)
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: '#F1F5F9', border: '1px solid #E2E8F0' }} />
            No data
          </div>
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 12px 6px 0', fontSize: 11, color: '#94A3B8', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', width: 80 }}>
                Stock
              </th>
              <th style={{ textAlign: 'right', padding: '6px 8px', fontSize: 11, color: '#94A3B8', fontWeight: 500, width: 80 }}>
                Oracle
              </th>
              {ISSUERS.map(iss => (
                <th key={iss.id} style={{ textAlign: 'center', padding: '6px 4px', fontSize: 11, fontWeight: 700, color: iss.color, width: 90 }}>
                  {iss.short}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmap.map((row, i) => (
              <tr key={row.ticker} style={{ borderTop: '1px solid #F1F5F9' }}>
                {/* Ticker */}
                <td style={{ padding: '7px 12px 7px 0' }}>
                  <Link href={`/asset/${row.ticker}`} style={{ textDecoration: 'none' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, color: '#0F172A' }}>{row.ticker}</span>
                  </Link>
                </td>

                {/* Oracle price */}
                <td style={{ textAlign: 'right', padding: '7px 8px', fontFamily: 'monospace', fontSize: 12, color: '#64748B' }}>
                  {row.marketPrice != null ? `$${row.marketPrice.toFixed(2)}` : '—'}
                </td>

                {/* Premium cells — only show issuers that passed the filter */}
                {ISSUERS.map(iss => {
                  const cell = row.cells.find(c => c.issuer === iss.id)
                  if (!cell) return <td key={iss.id} />

                  const style = cellStyle(cell.premiumPct)
                  const label = cell.premiumPct == null
                    ? '—'
                    : `${cell.premiumPct >= 0 ? '+' : ''}${cell.premiumPct.toFixed(2)}%`
                  return (
                    <td key={cell.issuer} style={{ padding: '4px' }}>
                      <div style={{
                        ...style,
                        borderRadius: 6,
                        padding: '5px 4px',
                        textAlign: 'center',
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: 'monospace',
                        minWidth: 72,
                      }}>
                        {label}
                        {cell.chain && cell.premiumPct != null && (
                          <div style={{ fontSize: 9, fontWeight: 400, opacity: 0.7, fontFamily: 'sans-serif', marginTop: 1 }}>
                            {cell.chain}
                          </div>
                        )}
                      </div>
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
