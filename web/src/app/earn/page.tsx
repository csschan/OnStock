import Link from 'next/link'
import { fetchEarnOverview, type DefiYield } from '@/lib/api'
import YieldCardClient from '@/components/YieldCardClient'

const TYPE_LABEL: Record<string, string> = {
  lending: 'Lending', cdp: 'CDP / Mint', lp: 'Liquidity Pool', leveraged: 'Leveraged Token',
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`
  return n > 0 ? `$${n.toFixed(0)}` : '-'
}

function AssetSection({ asset, yields, focusAsset }: { asset: string; yields: DefiYield[]; focusAsset?: string }) {
  const sorted = [...yields].sort((a, b) => b.netApy - a.netApy)
  const best = sorted[0]
  const ticker = asset.endsWith('x') ? asset.slice(0, -1) : asset

  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
        <Link href={`/asset/${ticker}`} style={{ display: 'flex', alignItems: 'center', gap: 8, textDecoration: 'none' }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: 'linear-gradient(135deg, #9945FF 0%, #14F195 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#fff', fontSize: 11, fontWeight: 800,
          }}>
            {asset.slice(0, 3)}
          </div>
          <span style={{ fontSize: 18, fontWeight: 800, color: '#0F172A' }}>{asset}</span>
        </Link>
        {best && best.netApy > 0 && (
          <div style={{
            fontSize: 12, fontWeight: 700, color: '#16A34A',
            background: '#F0FDF4', borderRadius: 6, padding: '3px 10px',
          }}>
            Best: {best.netApy.toFixed(2)}% on {best.protocolName}
          </div>
        )}
        <div style={{ fontSize: 11, color: '#94A3B8' }}>
          {yields.length} opportunities
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {sorted.map((y, i) => (
          <YieldCardClient
            key={`${y.protocol}-${y.action}-${i}`}
            y={y}
            autoExpand={focusAsset === asset && y.protocol === 'onstock'}
            defaultTab={focusAsset === asset && y.protocol === 'onstock' ? 'withdraw' : 'deposit'}
          />
        ))}
      </div>
    </div>
  )
}

export default async function EarnPage({ searchParams }: { searchParams: Promise<{ asset?: string }> }) {
  const { asset: focusAsset } = await searchParams
  const data = await fetchEarnOverview()

  if (!data || data.yields.length === 0) {
    return (
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '48px 16px' }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0F172A', marginBottom: 8 }}>Earn on Stock Tokens</h1>
        <div style={{ color: '#94A3B8', fontSize: 13 }}>Loading yield data...</div>
      </div>
    )
  }

  // Group by asset
  const byAsset = new Map<string, DefiYield[]>()
  for (const y of data.yields) {
    if (!byAsset.has(y.asset)) byAsset.set(y.asset, [])
    byAsset.get(y.asset)!.push(y)
  }

  const assetOrder = Array.from(byAsset.entries())
    .sort((a, b) => {
      // If redirected from portfolio, put the focused asset first
      if (focusAsset) {
        if (a[0] === focusAsset) return -1
        if (b[0] === focusAsset) return 1
      }
      return Math.max(...b[1].map(y => y.netApy)) - Math.max(...a[1].map(y => y.netApy))
    })

  const totalProtocols = new Set(data.yields.map(y => y.protocol)).size
  const bestOverall = data.yields.reduce((best, y) => y.netApy > best.netApy ? y : best, data.yields[0])
  const totalTvl = data.yields.reduce((s, y) => s + y.tvlUsd, 0)

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto', padding: '32px 16px' }}>

      {/* Header */}
      <div style={{ marginBottom: 28 }}>
        <div style={{ marginBottom: 8 }}>
          <Link href="/" style={{ fontSize: 12, color: '#94A3B8', textDecoration: 'none' }}>
            ← Dashboard
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
          <div style={{
            width: 40, height: 40, borderRadius: 12,
            background: 'linear-gradient(135deg, #9945FF 0%, #14F195 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 20, color: '#fff',
          }}>◎</div>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: '#0F172A', margin: 0 }}>
            Earn on Solana xStocks
          </h1>
        </div>
        <p style={{ fontSize: 13, color: '#64748B', margin: 0 }}>
          Supply, mint, or provide liquidity with your tokenized stocks — all executed directly on OnStock.
          Kamino transactions are signed in-app via Phantom.
        </p>
      </div>

      {/* Summary stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 28 }}>
        {[
          { label: 'Protocols',     value: String(totalProtocols), color: '#9945FF', bg: '#9945FF0D' },
          { label: 'Opportunities', value: String(data.yields.length), color: '#2563EB', bg: '#EFF6FF' },
          { label: 'Best APY',      value: `${bestOverall.netApy.toFixed(1)}%`,
            sub: `${bestOverall.asset} · ${bestOverall.protocolName}`,
            color: '#16A34A', bg: '#F0FDF4' },
          { label: 'Total TVL',     value: fmt(totalTvl), color: '#7C3AED', bg: '#F5F3FF' },
        ].map(c => (
          <div key={c.label} style={{
            background: c.bg, borderRadius: 12, padding: '14px 16px',
            border: `1px solid ${c.color}22`,
          }}>
            <div style={{ fontSize: 10, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 4 }}>
              {c.label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: c.color, lineHeight: 1 }}>{c.value}</div>
            {'sub' in c && <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 3 }}>{c.sub}</div>}
          </div>
        ))}
      </div>

      {/* Protocol legend + Phantom note */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 24, padding: '10px 14px',
        background: '#9945FF0A', border: '1px solid #9945FF22', borderRadius: 10,
      }}>
        <div style={{ display: 'flex', gap: 16 }}>
          {[
            { id: 'kamino',  label: 'Kamino Lending', color: '#2563EB', note: '⚡ In-app tx' },
            { id: 'nestusd', label: 'NestUSD CDP',    color: '#059669', note: '↗ External' },
            { id: 'raydium', label: 'Raydium LP',     color: '#7C3AED', note: '↗ External' },
            { id: 'shift',   label: 'Shift Leveraged',color: '#DC2626', note: '↗ External' },
          ].map(p => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: p.color }} />
              <span style={{ fontSize: 11, color: '#334155', fontWeight: 600 }}>{p.label}</span>
              <span style={{ fontSize: 10, color: '#94A3B8' }}>{p.note}</span>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#9945FF', fontWeight: 600 }}>
          <span>◎</span>
          <span>Kamino: sign with Phantom, no redirect needed</span>
        </div>
      </div>

      {/* Redeem banner — shown when redirected from portfolio */}
      {focusAsset && (
        <div style={{
          marginBottom: 24, padding: '14px 18px', borderRadius: 12,
          background: 'linear-gradient(135deg, #F0FDF4 0%, #ECFDF5 100%)',
          border: '1px solid #86EFAC',
          display: 'flex', alignItems: 'center', gap: 12,
        }}>
          <span style={{ fontSize: 20 }}>◎</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: '#15803D' }}>
              Redeeming {focusAsset} from OnStock Vault
            </div>
            <div style={{ fontSize: 12, color: '#16A34A', marginTop: 2 }}>
              Your vault position is shown below. Switch to the Withdraw tab to redeem your receipt tokens.
            </div>
          </div>
        </div>
      )}

      {/* Asset sections */}
      {assetOrder.map(([asset, yields]) => (
        <AssetSection key={asset} asset={asset} yields={yields} focusAsset={focusAsset} />
      ))}
    </div>
  )
}
