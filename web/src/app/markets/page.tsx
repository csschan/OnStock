import AssetGrid from "@/components/AssetGrid";
import { fetchAllAssets } from "@/lib/api";

export default async function MarketsPage() {
  const assets = await fetchAllAssets();

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <div style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 22, fontWeight: 800, color: '#0F172A', margin: 0 }}>
          All Tokenized Stocks
        </h1>
        <p style={{ fontSize: 13, color: '#94A3B8', marginTop: 4 }}>
          {assets.length} stocks · {assets.reduce((n, a) => n + a.tradeableCount, 0)} tradeable routes across all issuers and chains
        </p>
      </div>
      {assets.length === 0 ? (
        <div style={{ backgroundColor: '#FEF3C7', border: '1px solid #FDE68A', borderRadius: 12, padding: 24, textAlign: 'center' }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#92400E', margin: 0 }}>No data available</p>
          <p style={{ fontSize: 13, color: '#A16207', marginTop: 8 }}>Backend may be starting up. Refresh in a few seconds.</p>
        </div>
      ) : (
        <AssetGrid assets={assets} />
      )}
    </div>
  )
}
