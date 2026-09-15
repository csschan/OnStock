// 首页核心数据面板：每只股票 × 每个机构 的 AUM / 供应量 / 溢价 / 市占率
// Server component — 直接 fetch，无需 useEffect

import Link from 'next/link'
import { fetchMarketOverview, type AssetOverview } from '@/lib/api'

function fmt(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

function fmtSupply(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n.toFixed(0)
}

function PremiumBadge({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-[#94A3B8] text-xs">—</span>
  const positive = pct > 0
  const neutral = Math.abs(pct) < 0.1
  const color = neutral
    ? 'text-[#64748B]'
    : positive
      ? 'text-[#DC2626]'   // 溢价(贵) = 红
      : 'text-[#16A34A]'   // 折价(便宜) = 绿
  return (
    <span className={`text-xs font-mono font-medium ${color}`}>
      {positive ? '+' : ''}{pct.toFixed(2)}%
    </span>
  )
}

function IssuerBar({ share, issuer }: { share: number; issuer: string }) {
  const colors: Record<string, string> = {
    ondo:      'bg-[#2563EB]',
    backed:    'bg-[#7C3AED]',
    dinari:    'bg-[#059669]',
    robinhood: 'bg-[#DC2626]',
  }
  const color = colors[issuer] ?? 'bg-[#94A3B8]'
  return (
    <div className="flex items-center gap-1.5">
      <div className="w-20 h-1.5 bg-[#F1F5F9] rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full`} style={{ width: `${Math.min(share, 100)}%` }} />
      </div>
      <span className="text-[#64748B] text-xs tabular-nums">{share.toFixed(0)}%</span>
    </div>
  )
}

function AssetRow({ asset }: { asset: AssetOverview }) {
  const hasData = asset.issuers.length > 0

  return (
    <div className="border border-[#E2E8F0] rounded-xl overflow-hidden">
      {/* Asset header */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#F8FAFC] border-b border-[#E2E8F0]">
        <div className="flex items-center gap-3">
          <Link href={`/asset/${asset.ticker}`} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-7 h-7 rounded-lg bg-[#EFF6FF] flex items-center justify-center">
              <span className="text-[#2563EB] text-[10px] font-bold">{asset.ticker.slice(0, 2)}</span>
            </div>
            <span className="font-semibold text-[#0F172A] text-sm">{asset.ticker}</span>
            <span className="text-[#94A3B8] text-xs hidden sm:inline">{asset.name}</span>
          </Link>
          <span className="text-[10px] text-[#94A3B8] bg-[#F1F5F9] px-1.5 py-0.5 rounded uppercase tracking-wide">
            {asset.type}
          </span>
        </div>
        <div className="flex items-center gap-4 text-right">
          <div>
            <div className="text-xs text-[#94A3B8]">Oracle</div>
            <div className="text-sm font-mono font-medium text-[#0F172A]">
              {asset.marketPrice != null ? `$${asset.marketPrice.toFixed(2)}` : '—'}
            </div>
          </div>
          {asset.totalAumUsd > 0 && (
            <div>
              <div className="text-xs text-[#94A3B8]">Total AUM</div>
              <div className="text-sm font-semibold text-[#0F172A]">{fmt(asset.totalAumUsd)}</div>
            </div>
          )}
        </div>
      </div>

      {/* Issuer rows */}
      {hasData ? (
        <div className="divide-y divide-[#F1F5F9]">
          {/* Column headers — show only once */}
          <div className="grid grid-cols-[140px_1fr_1fr_1fr_100px] gap-2 px-4 py-1.5 text-[10px] text-[#94A3B8] uppercase tracking-wide font-medium">
            <span>Issuer</span>
            <span>Supply</span>
            <span>AUM</span>
            <span>Premium</span>
            <span>Market Share</span>
          </div>
          {asset.issuers.map(iss => (
            <div
              key={iss.issuer}
              className="grid grid-cols-[140px_1fr_1fr_1fr_100px] gap-2 items-center px-4 py-2.5 hover:bg-[#FAFBFF] transition-colors"
            >
              {/* Issuer name */}
              <div className="flex items-center gap-2">
                <IssuerDot issuer={iss.issuer} />
                <div>
                  <div className="text-xs font-medium text-[#0F172A]">{iss.issuerName}</div>
                  <div className="text-[10px] text-[#94A3B8]">{iss.chains.join(', ')}</div>
                </div>
              </div>

              {/* Supply */}
              <div className="text-xs font-mono text-[#334155]">
                {iss.totalSupplyTokens > 0 ? fmtSupply(iss.totalSupplyTokens) : '—'}
              </div>

              {/* AUM */}
              <div className="text-xs font-semibold text-[#0F172A]">
                {iss.aumUsd > 0 ? fmt(iss.aumUsd) : '—'}
              </div>

              {/* Premium */}
              <PremiumBadge pct={iss.premiumPct} />

              {/* Market share bar */}
              <IssuerBar share={iss.marketSharePct} issuer={iss.issuer} />
            </div>
          ))}
        </div>
      ) : (
        <div className="px-4 py-3 text-xs text-[#94A3B8]">
          Supply data loading… (updates every 5 min)
        </div>
      )}
    </div>
  )
}

function IssuerDot({ issuer }: { issuer: string }) {
  const colors: Record<string, string> = {
    ondo:      'bg-[#2563EB]',
    backed:    'bg-[#7C3AED]',
    dinari:    'bg-[#059669]',
    robinhood: 'bg-[#DC2626]',
  }
  return <div className={`w-2 h-2 rounded-full flex-shrink-0 ${colors[issuer] ?? 'bg-[#94A3B8]'}`} />
}

export default async function IssuerMarketTable() {
  const overview = await fetchMarketOverview()

  // 优先展示有 AUM 数据的；无数据的也显示（等待 supply 加载）
  const withAum = overview.filter(a => a.totalAumUsd > 0)
  const withoutAum = overview.filter(a => a.totalAumUsd === 0)
  const sorted = [...withAum, ...withoutAum]

  const totalAum = withAum.reduce((s, a) => s + a.totalAumUsd, 0)

  return (
    <section>
      <div className="flex items-end justify-between mb-4">
        <div>
          <h2 className="text-lg font-bold text-[#0F172A]">Issuer Market Data</h2>
          <p className="text-sm text-[#64748B] mt-0.5">
            Supply & AUM per institution — updated every 5 min from on-chain data
          </p>
        </div>
        {totalAum > 0 && (
          <div className="text-right">
            <div className="text-xs text-[#94A3B8]">Total OnStock AUM</div>
            <div className="text-xl font-bold text-[#0F172A]">{fmt(totalAum)}</div>
          </div>
        )}
      </div>

      {/* Issuer legend */}
      <div className="flex flex-wrap gap-3 mb-4">
        {[
          { id: 'ondo',      name: 'Ondo Finance',  color: 'bg-[#2563EB]' },
          { id: 'backed',    name: 'Backed xStocks', color: 'bg-[#7C3AED]' },
          { id: 'dinari',    name: 'Dinari',         color: 'bg-[#059669]' },
          { id: 'robinhood', name: 'Robinhood',      color: 'bg-[#DC2626]' },
        ].map(({ id, name, color }) => (
          <div key={id} className="flex items-center gap-1.5 text-xs text-[#64748B]">
            <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
            {name}
          </div>
        ))}
        <div className="ml-auto flex items-center gap-3 text-[10px] text-[#94A3B8]">
          <span className="text-[#16A34A] font-medium">Green = discount (buy opportunity)</span>
          <span className="text-[#DC2626] font-medium">Red = premium (paying above oracle)</span>
        </div>
      </div>

      <div className="space-y-3">
        {sorted.map(asset => (
          <AssetRow key={asset.ticker} asset={asset} />
        ))}
      </div>
    </section>
  )
}
