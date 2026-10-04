'use client'

import { useAccount } from 'wagmi'
import YieldCardClient from './YieldCardClient'
import type { DefiYield } from '@/lib/api'

// X Layer vault metadata — same source of truth as server/src/config/xlayer.ts
const XLAYER_VAULTS = [
  { symbol: 'TSLAx', name: 'Tesla',         apyPct: 4.20, vaultAddress: '0x5903bfd01B729d37CaA742709Ec1BA036d483931', tokenAddress: '0x6C1224ef5D09e4Abbe0fbD8430D633980E4953cf' },
  { symbol: 'NVDAx', name: 'NVIDIA',        apyPct: 4.20, vaultAddress: '0x244ECAc0d3458866d07B1E9e842F2b7dF00520AA', tokenAddress: '0x750d8B482e2E5E60204520cE266C692d52cEE624' },
  { symbol: 'SPYx',  name: 'S&P 500 ETF',   apyPct: 3.80, vaultAddress: '0x339B7dC6A641A1F8393724528B56ea50E1d149e4', tokenAddress: '0xa35bEc733819e2d3Bc79d3E46b6281eb3F80B5D3' },
  { symbol: 'AAPLx', name: 'Apple',         apyPct: 4.20, vaultAddress: '0xF2dB6823ae8cc56fa9eDf5D306960147CeB3e1ac', tokenAddress: '0xc6fAB27302A44Bf0Ab0e945344A64d69c8B1900D' },
  { symbol: 'GOOGLx',name: 'Google',        apyPct: 4.20, vaultAddress: '0x5C1e6aC2cB991d2292d9ee01C0D3076aC99267cD', tokenAddress: '0x7Ace8001A1fFbA17692A68234ABEB9293bB821b5' },
  { symbol: 'METAx', name: 'Meta',          apyPct: 4.20, vaultAddress: '0xc0d75D94173bbfD8fe57eBF90011547bE815923D', tokenAddress: '0x9F4666ed2eA3DD644D3ED0db0c8740192Bc28006' },
  { symbol: 'COINx', name: 'Coinbase',      apyPct: 5.50, vaultAddress: '0x1CF4212B49E4C966df7A0215d9d5c95086191BEF', tokenAddress: '0x6ade7bc80966ed040D1a7A8dFBCF1177649bB871' },
  { symbol: 'MSTRx', name: 'MicroStrategy', apyPct: 5.50, vaultAddress: '0x8841c470dD56d63D8e37868536fF42ACb4663584', tokenAddress: '0x5B4D33f9981D652D07391e4c828a09d6e2a09a25' },
]

function short(addr: string) { return addr.slice(0, 6) + '...' + addr.slice(-4) }

export default function XLayerVaultsPanel({ focusAsset }: { focusAsset?: string } = {}) {
  const { address, isConnected } = useAccount()

  // Convert each vault to DefiYield format → reuse YieldCardClient (same UI as Solana)
  const yields: DefiYield[] = XLAYER_VAULTS.map(v => ({
    protocol: 'xlayer-vault',
    protocolName: 'OnStock Vault (X Layer)',
    type: 'lending' as const,
    asset: v.symbol,
    action: 'deposit',
    actionLabel: `Deposit ${v.symbol} into ERC4626 Vault on X Layer`,
    supplyApy: v.apyPct,
    borrowApy: null,
    netApy: v.apyPct,
    ltv: null,
    liquidationThreshold: null,
    tvlUsd: 0,
    riskLevel: 'low' as const,
    // Pass vault + token address to EarnActionPanel via details JSON
    details: JSON.stringify({ vaultAddress: v.vaultAddress, tokenAddress: v.tokenAddress }),
  }))

  return (
    <div style={{ marginTop: 16 }}>
      {/* Section header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20,
        paddingBottom: 16, borderBottom: '2px solid #8B5CF622',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 18, fontWeight: 800,
        }}>⬡</div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A' }}>
            X Layer Vaults
            <span style={{
              marginLeft: 10, fontSize: 11, fontWeight: 700,
              background: '#EEF2FF', color: '#6366F1',
              border: '1px solid #C7D2FE', borderRadius: 6, padding: '2px 8px',
            }}>OKX L2 · Chain 1952</span>
          </div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
            ERC4626 standard vaults on X Layer Testnet — same UI as Solana vaults
          </div>
        </div>
        {isConnected && address && (
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#6366F1' }}>⬡ EVM Connected</div>
            <div style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'monospace' }}>{short(address)}</div>
          </div>
        )}
      </div>

      {/* Vault cards — same 3-column layout as Solana */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
        {yields.map(y => (
          <YieldCardClient
            key={y.asset}
            y={y}
            autoExpand={focusAsset === y.asset}
            defaultTab={focusAsset === y.asset ? 'withdraw' : 'deposit'}
          />
        ))}
      </div>

      {/* Explorer link */}
      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <a
          href="https://www.okx.com/explorer/xlayer-test"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 11, color: '#6366F1', fontWeight: 600 }}
        >
          View all contracts on OKX X Layer Explorer →
        </a>
      </div>
    </div>
  )
}
