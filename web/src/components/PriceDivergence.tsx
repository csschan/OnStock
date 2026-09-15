// 价格发散面板：同一只股票在不同平台的实时价格对比
// 包含 RWA 现货 + Hyperliquid 永续合约

import Link from 'next/link'
import type { DivergenceData } from '@/lib/api'

const ISSUER_COLOR: Record<string, string> = {
  ondo: '#2563EB', backed: '#7C3AED', binance: '#F0B90B',
  dinari: '#059669', robinhood: '#DC2626', hyperliquid: '#00D1FF',
}

const CHAIN_SHORT: Record<string, string> = {
  ethereum: 'ETH', bnb: 'BNB', base: 'Base', arbitrum: 'ARB',
  solana: 'SOL', 'robinhood-chain': 'RH', hyperliquid: 'HL',
}

const ISSUER_SHORT: Record<string, string> = {
  ondo: 'Ondo', backed: 'Backed', binance: 'Binance',
  robinhood: 'Robin.', hyperliquid: 'HL Perp',
}

function platformColor(issuer: string, chain: string): string {
  if (issuer === 'backed' && chain === 'solana') return '#9945FF'
  return ISSUER_COLOR[issuer] ?? '#94A3B8'
}

function platformLabel(issuer: string, chain: string, type: string): string {
  if (type === 'perp') return 'HL Perp'
  const base = ISSUER_SHORT[issuer] ?? issuer
  const chainTag = CHAIN_SHORT[chain] ?? chain
  return `${base}/${chainTag}`
}

function pctColor(pct: number): string {
  if (Math.abs(pct) < 0.3) return '#64748B'
  return pct > 0 ? '#DC2626' : '#16A34A'
}

interface Props {
  data: DivergenceData
}

export default function PriceDivergence({ data }: Props) {
  // 只显示价差 > 0.5% 的股票（有意义的发散）
  const meaningful = data.stocks.filter(s => s.maxSpreadPct > 0.5).slice(0, 8)

  if (meaningful.length === 0) {
    return (
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Price Divergence</div>
          <div style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
            background: data.market.isOpen ? '#F0FDF4' : '#FEF2F2',
            color: data.market.isOpen ? '#16A34A' : '#DC2626',
          }}>
            {data.market.status.toUpperCase()}
          </div>
        </div>
        <div style={{ color: '#94A3B8', fontSize: 13, padding: '20px 0' }}>
          No significant price divergence detected — all platforms within 0.5%
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Price Divergence</div>
          <div style={{
            fontSize: 11, fontWeight: 600, padding: '2px 8px', borderRadius: 10,
            background: data.market.isOpen ? '#F0FDF4' : '#FEF2F2',
            color: data.market.isOpen ? '#16A34A' : '#DC2626',
          }}>
            {data.market.status.toUpperCase()}
          </div>
          {data.hyperliquidCount > 0 && (
            <div style={{
              fontSize: 11, fontWeight: 500, padding: '2px 8px', borderRadius: 10,
              background: '#F0F9FF', color: '#0284C7',
            }}>
              +{data.hyperliquidCount} HL Perps
            </div>
          )}
        </div>
      </div>
      <div style={{ fontSize: 12, color: '#94A3B8', marginBottom: 16 }}>
        Same stock, different platforms — sorted by max price spread
      </div>

      {/* Stock divergence rows */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {meaningful.map(stock => {
          const spreadColor = stock.maxSpreadPct > 3 ? '#DC2626' : stock.maxSpreadPct > 1 ? '#D97706' : '#64748B'

          // Find cheapest spot platform (exclude perps — can't buy RWA tokens there)
          const cheapestSpot = stock.platforms.find(p => p.type === 'spot' && p.liquidityStatus === 'tradeable')
            ?? stock.platforms.find(p => p.type === 'spot')

          return (
            <div key={stock.ticker} style={{
              border: '1px solid #E2E8F0', borderRadius: 10, padding: '12px 16px',
              display: 'flex', alignItems: 'center', gap: 16,
            }}>
              {/* Ticker + Oracle */}
              <Link href={`/asset/${stock.ticker}`} style={{ textDecoration: 'none', minWidth: 80 }}>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#0F172A' }}>{stock.ticker}</div>
                <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'monospace' }}>
                  ${stock.oraclePrice.toFixed(2)}
                </div>
              </Link>

              {/* Spread badge */}
              <div style={{
                minWidth: 60, textAlign: 'center',
                fontSize: 13, fontWeight: 800, fontFamily: 'monospace',
                color: spreadColor,
              }}>
                {stock.maxSpreadPct.toFixed(1)}%
                <div style={{ fontSize: 9, fontWeight: 400, color: '#94A3B8' }}>spread</div>
              </div>

              {/* Price bars */}
              <div style={{ flex: 1, display: 'flex', flexWrap: 'wrap', gap: '4px 6px' }}>
                {stock.platforms.map((p, i) => {
                  const isCheapest = cheapestSpot && p.issuer === cheapestSpot.issuer && p.chain === cheapestSpot.chain
                  const isSolana = p.chain === 'solana'
                  const dotColor = platformColor(p.issuer, p.chain)
                  return (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '3px 8px', borderRadius: 6,
                      background: isCheapest ? '#F0FDF4' : isSolana ? '#9945FF0A' : p.type === 'perp' ? '#F0F9FF' : '#F8FAFC',
                      border: `1px solid ${isCheapest ? '#86EFAC' : isSolana ? '#9945FF33' : p.type === 'perp' ? '#BAE6FD' : '#E2E8F0'}`,
                      fontSize: 11,
                    }}>
                      <div style={{
                        width: 6, height: 6, borderRadius: '50%',
                        background: dotColor,
                      }} />
                      <span style={{ color: isSolana ? '#9945FF' : '#64748B', fontWeight: isSolana ? 700 : 500 }}>
                        {platformLabel(p.issuer, p.chain, p.type)}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#0F172A' }}>
                        ${p.price.toFixed(2)}
                      </span>
                      <span style={{ fontFamily: 'monospace', fontWeight: 600, color: pctColor(p.vsOraclePct), fontSize: 10 }}>
                        {p.vsOraclePct >= 0 ? '+' : ''}{p.vsOraclePct.toFixed(1)}%
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* Buy Cheapest button */}
              {cheapestSpot && (
                <Link
                  href={`/asset/${stock.ticker}?buy=${cheapestSpot.issuer}&chain=${cheapestSpot.chain}`}
                  style={{
                    flexShrink: 0, textDecoration: 'none',
                    background: '#2563EB', color: '#fff',
                    fontSize: 12, fontWeight: 700,
                    padding: '8px 14px', borderRadius: 10,
                    display: 'flex', flexDirection: 'column', alignItems: 'center',
                    lineHeight: 1.3,
                  }}
                >
                  <span>Buy ${cheapestSpot.price.toFixed(0)}</span>
                  <span style={{ fontSize: 9, fontWeight: 400, opacity: 0.8 }}>
                    {platformLabel(cheapestSpot.issuer, cheapestSpot.chain, cheapestSpot.type)}
                  </span>
                </Link>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
