// 市场信号：折价 Top5（买入机会）+ 套利 Top5
// Server component

import Link from 'next/link'
import type { MarketStats, RawArbitrage } from '@/lib/api'

const ISSUER_SHORT: Record<string, string> = {
  ondo: 'Ondo', backed: 'Backed', dinari: 'Dinari', robinhood: 'Robin.',
}
const CHAIN_SHORT: Record<string, string> = {
  ethereum: 'ETH', bnb: 'BNB', base: 'Base', arbitrum: 'ARB',
  solana: 'SOL', 'robinhood-chain': 'RH',
}

function SignalRow({
  ticker, issuer, chain, premiumPct, marketPrice, type,
}: {
  ticker: string; issuer: string; chain: string
  premiumPct: number; marketPrice: number; type: 'discount' | 'premium'
}) {
  const isDiscount = type === 'discount'
  const color = isDiscount ? '#16A34A' : '#DC2626'
  const bg = isDiscount ? '#F0FDF4' : '#FEF2F2'

  return (
    <Link href={`/asset/${ticker}`} style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderRadius: 8, background: bg,
        marginBottom: 6, cursor: 'pointer',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: isDiscount ? '#DCFCE7' : '#FEE2E2',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 800, color,
          }}>
            {ticker.slice(0, 3)}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{ticker}</div>
            <div style={{ fontSize: 11, color: '#94A3B8' }}>
              {ISSUER_SHORT[issuer] ?? issuer} · {CHAIN_SHORT[chain] ?? chain}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color, fontFamily: 'monospace' }}>
            {premiumPct >= 0 ? '+' : ''}{premiumPct.toFixed(2)}%
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8', fontFamily: 'monospace' }}>
            ${marketPrice.toFixed(2)}
          </div>
        </div>
      </div>
    </Link>
  )
}

function ArbRow({ arb }: { arb: RawArbitrage }) {
  return (
    <Link href="/arbitrage" style={{ textDecoration: 'none', display: 'block' }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 14px', borderRadius: 8, background: '#FFFBEB',
        marginBottom: 6, cursor: 'pointer',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 36, height: 36, borderRadius: 8,
            background: '#FEF3C7',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 11, fontWeight: 800, color: '#D97706',
          }}>
            {arb.ticker.slice(0, 3)}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>{arb.ticker}</div>
            <div style={{ fontSize: 11, color: '#94A3B8' }}>
              {ISSUER_SHORT[arb.buyIssuer] ?? arb.buyIssuer}/{CHAIN_SHORT[arb.buyChain] ?? arb.buyChain}
              {' → '}
              {ISSUER_SHORT[arb.sellIssuer] ?? arb.sellIssuer}/{CHAIN_SHORT[arb.sellChain] ?? arb.sellChain}
            </div>
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 15, fontWeight: 800, color: '#D97706', fontFamily: 'monospace' }}>
            +{arb.spreadPct.toFixed(2)}%
          </div>
          <div style={{ fontSize: 11, color: '#94A3B8' }}>spread</div>
        </div>
      </div>
    </Link>
  )
}

interface Props {
  signals: MarketStats['signals']
  arbitrage: RawArbitrage[]
}

export default function MarketSignals({ signals, arbitrage }: Props) {
  const topArbs = arbitrage.slice(0, 5)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
      {/* Discount opportunities */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#16A34A' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Discount Opportunities</span>
          <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 2 }}>below oracle price</span>
        </div>
        {signals.discounts.length > 0 ? signals.discounts.map((d, i) => (
          <SignalRow key={i} {...d} type="discount" />
        )) : (
          <div style={{ color: '#94A3B8', fontSize: 13, padding: '20px 0' }}>No discounts detected</div>
        )}
      </div>

      {/* Premium warnings */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#DC2626' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Premium Warnings</span>
          <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 2 }}>above oracle price</span>
        </div>
        {signals.premiums.length > 0 ? signals.premiums.map((p, i) => (
          <SignalRow key={i} {...p} type="premium" />
        )) : (
          <div style={{ color: '#94A3B8', fontSize: 13, padding: '20px 0' }}>No premiums detected</div>
        )}
      </div>

      {/* Arbitrage */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#D97706' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: '#0F172A' }}>Arbitrage Spreads</span>
          <span style={{ fontSize: 11, color: '#94A3B8', marginLeft: 2 }}>cross-issuer / cross-chain</span>
        </div>
        {topArbs.length > 0 ? topArbs.map((a, i) => (
          <ArbRow key={i} arb={a} />
        )) : (
          <div style={{ color: '#94A3B8', fontSize: 13, padding: '20px 0' }}>No active spreads</div>
        )}
      </div>
    </div>
  )
}
