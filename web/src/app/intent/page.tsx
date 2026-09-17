import IntentPanel from '@/components/IntentPanel'

export const metadata = {
  title: 'Intent Router — OnStock',
  description: 'Describe your investment intent, the system generates optimal execution paths from real-time market signals',
}

export default function IntentPage({ searchParams }: { searchParams: { asset?: string } }) {
  const initialAsset = searchParams.asset?.toUpperCase() || 'TSLA'

  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', paddingTop: 32 }}>
      {/* Page Header */}
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '0 16px 24px' }}>
        <div style={{ marginBottom: 6 }}>
          <span style={{
            fontSize: 10, fontWeight: 800, letterSpacing: '0.1em',
            color: '#2563EB', textTransform: 'uppercase',
          }}>
            Dynamic Intent Router
          </span>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: '#0F172A', margin: '0 0 8px', lineHeight: 1.2 }}>
          Describe Your Intent<br />
          <span style={{ color: '#2563EB' }}>We Find the Optimal Path</span>
        </h1>
        <p style={{ fontSize: 14, color: '#64748B', margin: 0, lineHeight: 1.6 }}>
          Routes computed in real-time from on-chain premiums, 24h momentum, and protocol APYs —
          same intent, different market state, completely different recommendations.
        </p>
      </div>

      <IntentPanel initialAsset={initialAsset} />
    </div>
  )
}
