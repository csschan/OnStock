import PortfolioBuilder from '@/components/PortfolioBuilder'

export const metadata = {
  title: 'Portfolio Builder — OnStock',
  description: 'Build multi-asset xStock portfolios, one-click buy and deposit to Vault for yield',
}

export default function PortfolioBuilderPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#F8FAFC', paddingTop: 32 }}>
      <div style={{ maxWidth: 700, margin: '0 auto', padding: '0 16px 24px' }}>
        <div style={{ marginBottom: 6 }}>
          <span style={{
            fontSize: 10, fontWeight: 800, letterSpacing: '0.1em',
            color: '#2563EB', textTransform: 'uppercase',
          }}>RWA Portfolio Builder</span>
        </div>
        <h1 style={{ fontSize: 28, fontWeight: 900, color: '#0F172A', margin: '0 0 8px', lineHeight: 1.2 }}>
          Build Your<br />
          <span style={{ color: '#2563EB' }}>xStock Portfolio</span>
        </h1>
        <p style={{ fontSize: 14, color: '#64748B', margin: 0, lineHeight: 1.6 }}>
          Select stocks, set weights, one-click buy and deposit to OnStock Vault —
          earn DeFi yield automatically while holding, redeem anytime.
        </p>
      </div>
      <PortfolioBuilder />
    </div>
  )
}
