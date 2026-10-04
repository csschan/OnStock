'use client'

import { useAccount } from 'wagmi'
import YieldCardClient from './YieldCardClient'
import type { DefiYield } from '@/lib/api'

// Arbitrum Sepolia vault metadata — addresses filled after deployment
const ARB_VAULTS = [
  { symbol: 'TSLAx', name: 'Tesla',         apyPct: 4.50, vaultAddress: '0x5903bfd01B729d37CaA742709Ec1BA036d483931', tokenAddress: '0x6C1224ef5D09e4Abbe0fbD8430D633980E4953cf' },
  { symbol: 'NVDAx', name: 'NVIDIA',        apyPct: 4.50, vaultAddress: '0x244ECAc0d3458866d07B1E9e842F2b7dF00520AA', tokenAddress: '0x750d8B482e2E5E60204520cE266C692d52cEE624' },
  { symbol: 'SPYx',  name: 'S&P 500 ETF',   apyPct: 4.00, vaultAddress: '0x339B7dC6A641A1F8393724528B56ea50E1d149e4', tokenAddress: '0xa35bEc733819e2d3Bc79d3E46b6281eb3F80B5D3' },
  { symbol: 'AAPLx', name: 'Apple',         apyPct: 4.50, vaultAddress: '0xF2dB6823ae8cc56fa9eDf5D306960147CeB3e1ac', tokenAddress: '0xc6fAB27302A44Bf0Ab0e945344A64d69c8B1900D' },
  { symbol: 'GOOGLx',name: 'Google',        apyPct: 4.50, vaultAddress: '0x5C1e6aC2cB991d2292d9ee01C0D3076aC99267cD', tokenAddress: '0x7Ace8001A1fFbA17692A68234ABEB9293bB821b5' },
  { symbol: 'METAx', name: 'Meta',          apyPct: 4.50, vaultAddress: '0xc0d75D94173bbfD8fe57eBF90011547bE815923D', tokenAddress: '0x9F4666ed2eA3DD644D3ED0db0c8740192Bc28006' },
  { symbol: 'COINx', name: 'Coinbase',      apyPct: 5.80, vaultAddress: '0x1CF4212B49E4C966df7A0215d9d5c95086191BEF', tokenAddress: '0x6ade7bc80966ed040D1a7A8dFBCF1177649bB871' },
  { symbol: 'MSTRx', name: 'MicroStrategy', apyPct: 5.80, vaultAddress: '0x8841c470dD56d63D8e37868536fF42ACb4663584', tokenAddress: '0x5B4D33f9981D652D07391e4c828a09d6e2a09a25' },
]

function short(addr: string) { return addr ? addr.slice(0, 6) + '...' + addr.slice(-4) : '—' }

export default function ArbitrumVaultsPanel({ focusAsset }: { focusAsset?: string } = {}) {
  const { address, isConnected } = useAccount()

  // Check if contracts are deployed (vaultAddress is not empty)
  const hasDeployment = ARB_VAULTS.some(v => v.vaultAddress)

  const yields: DefiYield[] = ARB_VAULTS.map(v => ({
    protocol: 'arbitrum-vault',
    protocolName: 'OnStock Vault (Arbitrum)',
    type: 'lending' as const,
    asset: v.symbol,
    action: 'deposit',
    actionLabel: `Deposit ${v.symbol} into ERC4626 Vault on Arbitrum Sepolia`,
    supplyApy: v.apyPct,
    borrowApy: null,
    netApy: v.apyPct,
    ltv: null,
    liquidationThreshold: null,
    tvlUsd: 0,
    riskLevel: 'low' as const,
    details: JSON.stringify({ vaultAddress: v.vaultAddress, tokenAddress: v.tokenAddress }),
  }))

  return (
    <div style={{ marginTop: 32 }}>
      {/* Section header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, marginBottom: 20,
        paddingBottom: 16, borderBottom: '2px solid #28A0F022',
      }}>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          background: 'linear-gradient(135deg, #28A0F0 0%, #1868B7 100%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: '#fff', fontSize: 14, fontWeight: 800,
        }}>ARB</div>
        <div>
          <div style={{ fontSize: 20, fontWeight: 800, color: '#0F172A' }}>
            Arbitrum Vaults
            <span style={{
              marginLeft: 10, fontSize: 11, fontWeight: 700,
              background: '#EFF6FF', color: '#28A0F0',
              border: '1px solid #93C5FD', borderRadius: 6, padding: '2px 8px',
            }}>Sepolia Testnet · Chain 421614</span>
          </div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
            ERC4626 vaults on Arbitrum Sepolia — {hasDeployment ? 'same UI as Solana & X Layer' : 'deployment pending'}
          </div>
        </div>
        {isConnected && address && (
          <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#28A0F0' }}>EVM Connected</div>
            <div style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'monospace' }}>{short(address)}</div>
          </div>
        )}
      </div>

      {!hasDeployment ? (
        <div style={{
          background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 12,
          padding: '20px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: '#92400E', marginBottom: 4 }}>
            Arbitrum Contracts Pending Deployment
          </div>
          <div style={{ fontSize: 12, color: '#92400E' }}>
            Contracts will be deployed once testnet ETH is available. APY rates are pre-configured.
          </div>
        </div>
      ) : (
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
      )}

      <div style={{ marginTop: 14, textAlign: 'center' }}>
        <a
          href="https://sepolia.arbiscan.io"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 11, color: '#28A0F0', fontWeight: 600 }}
        >
          View contracts on Arbiscan →
        </a>
      </div>
    </div>
  )
}
