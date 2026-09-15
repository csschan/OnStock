import Link from "next/link";
import IssuerStats from "@/components/IssuerStats";
import PremiumHeatmap from "@/components/PremiumHeatmap";
import MarketSignals from "@/components/MarketSignals";
import PriceDivergence from "@/components/PriceDivergence";
import MarketStatusBanner from "@/components/MarketStatusBanner";
import SolanaEcosystem from "@/components/SolanaEcosystem";
import { fetchMarketStats, fetchArbitrage, fetchDivergence, fetchMarketOverview, fetchEarnOverview } from "@/lib/api";

function fmt(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000)     return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)         return `$${(n / 1_000).toFixed(0)}K`
  return `$${n.toFixed(0)}`
}

const CHAIN_LABEL: Record<string, string> = {
  ethereum: 'ETH', bnb: 'BNB', base: 'Base',
  arbitrum: 'ARB', solana: 'SOL', 'robinhood-chain': 'RH Chain',
}

export default async function Home() {
  const [stats, arbitrage, divergence, overview, earn] = await Promise.all([
    fetchMarketStats(),
    fetchArbitrage(),
    fetchDivergence(),
    fetchMarketOverview(),
    fetchEarnOverview(),
  ])

  const s = stats?.summary

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">

      {/* ── Page header ── */}
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', margin: 0 }}>
          OnStock Market Dashboard
        </h1>
        <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 4 }}>
          Real-time data across all tokenized stock issuers and chains
        </p>
      </div>

      {/* ── Market Status ── */}
      <MarketStatusBanner />

      {/* ── Summary bar ── */}
      {s && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 12,
          marginBottom: 28,
        }}>
          {[
            {
              label: 'Total AUM',
              value: fmt(s.totalAumUsd),
              sub: `${s.assetCount} tokenized stocks`,
              color: '#2563EB',
              bg: '#EFF6FF',
            },
            {
              label: 'Market Avg Premium',
              value: s.avgPremiumPct != null
                ? `${s.avgPremiumPct >= 0 ? '+' : ''}${s.avgPremiumPct.toFixed(2)}%`
                : '—',
              sub: s.avgPremiumPct != null && s.avgPremiumPct < 0
                ? 'Market trading below oracle' : 'Market trading above oracle',
              color: s.avgPremiumPct != null && s.avgPremiumPct < 0 ? '#16A34A' : '#DC2626',
              bg: s.avgPremiumPct != null && s.avgPremiumPct < 0 ? '#F0FDF4' : '#FEF2F2',
            },
            {
              label: 'Tradeable Routes',
              value: String(s.tradeableRoutes),
              sub: 'active DEX routes now',
              color: '#7C3AED',
              bg: '#F5F3FF',
            },
            {
              label: 'Active Chains',
              value: String(s.activeChains.length),
              sub: s.activeChains.map(c => CHAIN_LABEL[c] ?? c).join(' · '),
              color: '#059669',
              bg: '#ECFDF5',
            },
          ].map(card => (
            <div key={card.label} style={{
              background: card.bg,
              borderRadius: 12,
              padding: '16px 20px',
              border: `1px solid ${card.color}22`,
            }}>
              <div style={{ fontSize: 11, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>
                {card.label}
              </div>
              <div style={{ fontSize: 26, fontWeight: 800, color: card.color, lineHeight: 1 }}>
                {card.value}
              </div>
              <div style={{ fontSize: 11, color: '#64748B', marginTop: 6 }}>
                {card.sub}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Issuer Overview ── */}
      <div style={{
        background: '#fff',
        border: '1px solid #E2E8F0',
        borderRadius: 16,
        padding: 24,
        marginBottom: 20,
      }}>
        <IssuerStats />
      </div>

      {/* ── Solana xStocks Ecosystem ── */}
      <SolanaEcosystem overview={overview} earn={earn} />

      {/* ── Price Divergence ── */}
      {divergence && (
        <div style={{
          background: '#fff',
          border: '1px solid #E2E8F0',
          borderRadius: 16,
          padding: 24,
          marginBottom: 20,
        }}>
          <PriceDivergence data={divergence} />
        </div>
      )}

      {/* ── Top Movers ── */}
      {stats?.heatmap && stats.heatmap.some(r => r.change24h != null) && (() => {
        const movers = [...stats.heatmap]
          .filter(r => r.change24h != null && r.marketPrice != null)
          .sort((a, b) => Math.abs(b.change24h!) - Math.abs(a.change24h!))
          .slice(0, 8)
        return (
          <div style={{ background: '#fff', border: '1px solid #E2E8F0', borderRadius: 16, padding: 24, marginBottom: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A' }}>Top Movers (24h)</div>
                <div style={{ fontSize: 12, color: '#94A3B8', marginTop: 2 }}>Largest oracle price moves today</div>
              </div>
              <Link href="/markets" style={{ fontSize: 12, color: '#2563EB', textDecoration: 'none', fontWeight: 600 }}>
                View All →
              </Link>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              {movers.map(r => {
                const up = r.change24h! >= 0
                const color = up ? '#16A34A' : '#DC2626'
                const bg = up ? '#F0FDF4' : '#FEF2F2'
                return (
                  <Link key={r.ticker} href={`/asset/${r.ticker}`} style={{ textDecoration: 'none' }}>
                    <div style={{ background: bg, borderRadius: 10, padding: '12px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 800, color: '#0F172A' }}>{r.ticker}</div>
                        <div style={{ fontSize: 11, color: '#64748B', fontFamily: 'monospace' }}>
                          ${r.marketPrice!.toFixed(2)}
                        </div>
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 800, color, fontFamily: 'monospace' }}>
                        {up ? '+' : ''}{r.change24h!.toFixed(2)}%
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* ── Premium Heatmap ── */}
      {stats?.heatmap && stats.heatmap.length > 0 && (
        <div style={{
          background: '#fff',
          border: '1px solid #E2E8F0',
          borderRadius: 16,
          padding: 24,
          marginBottom: 20,
        }}>
          <PremiumHeatmap heatmap={stats.heatmap} />
        </div>
      )}

      {/* ── Market Signals ── */}
      {stats?.signals && (
        <div style={{
          background: '#fff',
          border: '1px solid #E2E8F0',
          borderRadius: 16,
          padding: 24,
          marginBottom: 20,
        }}>
          <div style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginBottom: 16 }}>
            Market Signals
          </div>
          <MarketSignals signals={stats.signals} arbitrage={arbitrage} />
        </div>
      )}

    </div>
  )
}
