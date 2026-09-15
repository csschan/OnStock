import Link from 'next/link'
import { fetchMarketOverview, type AssetOverview, type IssuerOverview } from '@/lib/api'

const ISSUER_META: Record<string, { name: string; color: string; bg: string; border: string; website: string }> = {
  ondo:      { name: 'Ondo Finance',    color: '#2563EB', bg: '#EFF6FF', border: '#BFDBFE', website: 'https://ondo.finance' },
  backed:    { name: 'Backed xStocks',  color: '#7C3AED', bg: '#F5F3FF', border: '#DDD6FE', website: 'https://backed.fi' },
  dinari:    { name: 'Dinari',          color: '#059669', bg: '#ECFDF5', border: '#A7F3D0', website: 'https://dinari.com' },
  robinhood: { name: 'Robinhood',       color: '#DC2626', bg: '#FEF2F2', border: '#FECACA', website: 'https://robinhood.com' },
  binance:   { name: 'Binance bStocks', color: '#F0B90B', bg: '#FFFBEB', border: '#FDE68A', website: 'https://binance.com' },
}

const CHAIN_SHORT: Record<string, string> = {
  ethereum: 'ETH', bnb: 'BNB', base: 'Base',
  arbitrum: 'ARB', solana: 'SOL', 'robinhood-chain': 'RH',
}

function fmt(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`
  return n > 0 ? `$${n.toFixed(0)}` : '—'
}

function fmtSupply(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`
  return n > 0 ? n.toFixed(0) : '—'
}

interface TokenRow {
  ticker: string
  name: string
  type: string
  marketPrice: number | null
  change24h: number | null
  issuerData: IssuerOverview
}

export default async function IssuerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const overview = await fetchMarketOverview()
  const meta = ISSUER_META[id] ?? { name: id, color: '#64748B', bg: '#F8FAFC', border: '#E2E8F0', website: '#' }

  // Filter assets that have this issuer
  const tokens: TokenRow[] = []
  for (const asset of overview) {
    const issuerData = asset.issuers.find(i => i.issuer === id)
    if (issuerData) {
      tokens.push({
        ticker: asset.ticker,
        name: asset.name,
        type: asset.type,
        marketPrice: asset.marketPrice,
        change24h: asset.change24h,
        issuerData,
      })
    }
  }

  // Aggregate stats
  const totalAum = tokens.reduce((s, t) => s + t.issuerData.aumUsd, 0)
  const totalTvl = tokens.reduce((s, t) => s + t.issuerData.tvlUsd, 0)
  const totalVol = tokens.reduce((s, t) => s + t.issuerData.volume24hUsd, 0)
  const totalSupply = tokens.reduce((s, t) => s + t.issuerData.totalSupplyTokens, 0)
  const allChains = new Set<string>()
  tokens.forEach(t => t.issuerData.chains.forEach(c => allChains.add(c)))

  const premiums = tokens.map(t => t.issuerData.premiumPct).filter((p): p is number => p != null)
  const avgPremium = premiums.length > 0 ? premiums.reduce((s, p) => s + p, 0) / premiums.length : null

  // Sort by AUM descending
  tokens.sort((a, b) => b.issuerData.aumUsd - a.issuerData.aumUsd)

  return (
    <div className="max-w-6xl mx-auto px-4 py-8">
      {/* Back link */}
      <Link href="/" className="text-sm text-[#64748B] hover:text-[#2563EB] transition-colors mb-6 inline-block">
        &larr; Back to Overview
      </Link>

      {/* Header */}
      <div className="rounded-2xl p-6 mb-8" style={{ background: meta.bg, border: `1px solid ${meta.border}` }}>
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-lg"
                style={{ background: meta.color }}>
                {meta.name.charAt(0)}
              </div>
              <h1 className="text-2xl font-bold text-[#0F172A]">{meta.name}</h1>
            </div>
            <div className="flex items-center gap-2 text-sm text-[#64748B]">
              {Array.from(allChains).map(c => (
                <span key={c} className="px-2 py-0.5 rounded-full text-xs font-medium"
                  style={{ background: 'rgba(255,255,255,0.7)', border: `1px solid ${meta.border}` }}>
                  {CHAIN_SHORT[c] ?? c}
                </span>
              ))}
              <span className="text-[#94A3B8]">·</span>
              <span>{tokens.length} stocks</span>
            </div>
          </div>

          <a href={meta.website} target="_blank" rel="noopener noreferrer"
            className="text-sm font-medium px-4 py-2 rounded-lg transition-colors text-white"
            style={{ background: meta.color }}>
            Visit {meta.name.split(' ')[0]} &rarr;
          </a>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-4 mt-6">
          {[
            { label: 'Total AUM', value: fmt(totalAum) },
            { label: 'TVL (DEX)', value: fmt(totalTvl) },
            { label: '24h Volume', value: fmt(totalVol) },
            { label: 'Total Supply', value: fmtSupply(totalSupply) },
            { label: 'Avg Premium', value: avgPremium != null ? `${avgPremium > 0 ? '+' : ''}${avgPremium.toFixed(2)}%` : '—' },
          ].map(s => (
            <div key={s.label} className="bg-white/60 rounded-xl px-4 py-3" style={{ border: `1px solid ${meta.border}` }}>
              <div className="text-[10px] text-[#94A3B8] uppercase tracking-wider mb-1">{s.label}</div>
              <div className="text-lg font-bold text-[#0F172A]">{s.value}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Token table */}
      <div className="bg-white rounded-2xl border border-[#E2E8F0] overflow-hidden">
        <div className="px-6 py-4 border-b border-[#E2E8F0]">
          <h2 className="text-base font-bold text-[#0F172A]">All Tokens by {meta.name}</h2>
          <p className="text-xs text-[#94A3B8] mt-1">Click any token to view full details and trade</p>
        </div>

        {/* Table header */}
        <div className="grid grid-cols-[60px_1fr_100px_100px_100px_100px_100px_80px] gap-2 px-6 py-2.5 text-[10px] text-[#94A3B8] uppercase tracking-wider font-medium border-b border-[#F1F5F9] bg-[#FAFBFC]">
          <span>Ticker</span>
          <span>Name</span>
          <span className="text-right">Oracle Price</span>
          <span className="text-right">AUM</span>
          <span className="text-right">TVL</span>
          <span className="text-right">24h Vol</span>
          <span className="text-right">Supply</span>
          <span className="text-right">Premium</span>
        </div>

        {/* Token rows */}
        {tokens.map(t => {
          const d = t.issuerData
          const premColor = d.premiumPct == null ? '#94A3B8'
            : Math.abs(d.premiumPct) < 0.05 ? '#64748B'
            : d.premiumPct > 0 ? '#DC2626' : '#16A34A'
          return (
            <Link
              key={t.ticker}
              href={`/asset/${t.ticker}`}
              className="grid grid-cols-[60px_1fr_100px_100px_100px_100px_100px_80px] gap-2 px-6 py-3 items-center hover:bg-[#F8FAFC] transition-colors border-b border-[#F1F5F9] last:border-b-0"
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              {/* Ticker */}
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: meta.bg, border: `1px solid ${meta.border}` }}>
                  <span className="text-[10px] font-bold" style={{ color: meta.color }}>{t.ticker.slice(0, 2)}</span>
                </div>
                <span className="text-sm font-semibold text-[#0F172A]">{t.ticker}</span>
              </div>

              {/* Name */}
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#334155] truncate">{t.name}</span>
                <span className="text-[10px] text-[#94A3B8] bg-[#F1F5F9] px-1.5 py-0.5 rounded uppercase">{t.type}</span>
                {d.chains.map(c => (
                  <span key={c} className="text-[10px] text-[#64748B] bg-[#F1F5F9] px-1.5 py-0.5 rounded">
                    {CHAIN_SHORT[c] ?? c}
                  </span>
                ))}
              </div>

              {/* Oracle Price */}
              <div className="text-right text-sm font-mono text-[#0F172A]">
                {t.marketPrice != null ? `$${t.marketPrice.toFixed(2)}` : '—'}
              </div>

              {/* AUM */}
              <div className="text-right text-sm font-semibold text-[#0F172A]">
                {d.aumUsd > 0 ? fmt(d.aumUsd) : '—'}
              </div>

              {/* TVL */}
              <div className="text-right text-sm text-[#334155]">
                {d.tvlUsd > 0 ? fmt(d.tvlUsd) : '—'}
              </div>

              {/* 24h Volume */}
              <div className="text-right text-sm text-[#334155]">
                {d.volume24hUsd > 0 ? fmt(d.volume24hUsd) : '—'}
              </div>

              {/* Supply */}
              <div className="text-right text-sm font-mono text-[#334155]">
                {d.totalSupplyTokens > 0 ? fmtSupply(d.totalSupplyTokens) : '—'}
              </div>

              {/* Premium */}
              <div className="text-right text-sm font-mono font-medium" style={{ color: premColor }}>
                {d.premiumPct != null ? `${d.premiumPct > 0 ? '+' : ''}${d.premiumPct.toFixed(2)}%` : '—'}
              </div>
            </Link>
          )
        })}

        {tokens.length === 0 && (
          <div className="px-6 py-12 text-center text-[#94A3B8] text-sm">
            No tokens found for this issuer.
          </div>
        )}
      </div>
    </div>
  )
}
