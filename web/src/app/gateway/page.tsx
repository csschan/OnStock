import GatewayPanel from '@/components/GatewayPanel'

export const metadata = {
  title: 'Trade & Swap — OnStock',
  description: 'Buy, sell, and cross-chain swap RWA stock tokens',
}

export default function GatewayPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', paddingTop: 32 }}>
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px 24px' }}>
        <div style={{ marginBottom: 6 }}>
          <span style={{
            fontSize: 10, fontWeight: 800, letterSpacing: '0.1em',
            color: '#059669', textTransform: 'uppercase',
          }}>
            Cross-Chain RWA Trading
          </span>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: '#0F172A', margin: '0 0 8px', lineHeight: 1.2 }}>
          Buy, Sell & Swap<br />
          <span style={{ color: '#059669' }}>Stocks Across Chains</span>
        </h1>
        <p style={{ fontSize: 14, color: '#64748B', margin: 0, lineHeight: 1.6 }}>
          Trade tokenized stocks at real-time prices. Cross-chain swap moves your position
          between Arbitrum and Solana — you sign once, we handle the rest. Only fee: 0.05% on cross-chain swaps.
        </p>
      </div>

      <GatewayPanel />
    </div>
  )
}
