'use client'

import { useState } from 'react'
import { useAccount, useConnect, useSendTransaction, useSwitchChain } from 'wagmi'
import { xlayerTestnet } from '@/components/Web3Provider'

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'

const VAULTS = [
  { symbol: 'TSLAx', name: 'Tesla',         apyPct: 4.20, address: '0x5903bfd01B729d37CaA742709Ec1BA036d483931' },
  { symbol: 'NVDAx', name: 'NVIDIA',        apyPct: 4.20, address: '0x244ECAc0d3458866d07B1E9e842F2b7dF00520AA' },
  { symbol: 'SPYx',  name: 'S&P 500 ETF',   apyPct: 3.80, address: '0x339B7dC6A641A1F8393724528B56ea50E1d149e4' },
  { symbol: 'AAPLx', name: 'Apple',         apyPct: 4.20, address: '0xF2dB6823ae8cc56fa9eDf5D306960147CeB3e1ac' },
  { symbol: 'GOOGLx',name: 'Google',        apyPct: 4.20, address: '0x5C1e6aC2cB991d2292d9ee01C0D3076aC99267cD' },
  { symbol: 'METAx', name: 'Meta',          apyPct: 4.20, address: '0xc0d75D94173bbfD8fe57eBF90011547bE815923D' },
  { symbol: 'COINx', name: 'Coinbase',      apyPct: 5.50, address: '0x1CF4212B49E4C966df7A0215d9d5c95086191BEF' },
  { symbol: 'MSTRx', name: 'MicroStrategy', apyPct: 5.50, address: '0x8841c470dD56d63D8e37868536fF42ACb4663584' },
]

function short(addr: string) { return addr.slice(0, 6) + '...' + addr.slice(-4) }

export default function XLayerVaultsPanel() {
  const { address, isConnected } = useAccount()
  const { connect, connectors } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()
  const [execState, setExecState] = useState<Record<string, 'idle'|'switching'|'approving'|'depositing'|'success'|'error'>>({})
  const [execTx, setExecTx] = useState<Record<string, string>>({})
  const [execErr, setExecErr] = useState<Record<string, string>>({})

  async function handleDeposit(symbol: string, amountUsd = 500) {
    if (!address) { connect({ connector: connectors[0] }); return }
    setExecState(s => ({ ...s, [symbol]: 'switching' }))
    setExecErr(s => ({ ...s, [symbol]: '' }))
    try {
      await switchChainAsync({ chainId: xlayerTestnet.id })
      setExecState(s => ({ ...s, [symbol]: 'approving' }))

      // Server mints + builds approve + deposit txs
      const resp = await fetch(`${API_BASE}/xlayer/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset: symbol.replace('x', ''), amountUsd, walletAddress: address }),
      })
      const json = await resp.json()
      if (!json.ok) throw new Error(json.error)
      const { approveTx, depositTx } = json.data

      await sendTransactionAsync({ to: approveTx.to, data: approveTx.data })
      setExecState(s => ({ ...s, [symbol]: 'depositing' }))
      await new Promise(r => setTimeout(r, 2000))
      const depHash = await sendTransactionAsync({ to: depositTx.to, data: depositTx.data })
      setExecTx(s => ({ ...s, [symbol]: depHash }))
      setExecState(s => ({ ...s, [symbol]: 'success' }))
    } catch (e: any) {
      setExecErr(s => ({ ...s, [symbol]: e?.message ?? 'Failed' }))
      setExecState(s => ({ ...s, [symbol]: 'error' }))
    }
  }

  const statusLabel: Record<string, string> = {
    switching: 'Switching to X Layer...', approving: 'Sign Approve...',
    depositing: 'Sign Vault Deposit...', success: 'Deposited!', error: 'Failed',
  }

  return (
    <div style={{ marginTop: 48 }}>
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
            }}>OKX L2 · Chain 195</span>
          </div>
          <div style={{ fontSize: 12, color: '#64748B', marginTop: 2 }}>
            ERC4626 standard vaults deployed on X Layer Testnet — deposit xStock tokens to earn yield on OKX's ZK-Rollup
          </div>
        </div>
        <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
          {isConnected ? (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#6366F1' }}>⬡ EVM Connected</div>
              <div style={{ fontSize: 10, color: '#94A3B8', fontFamily: 'monospace' }}>{short(address!)}</div>
            </div>
          ) : (
            <button
              onClick={() => connect({ connector: connectors[0] })}
              style={{
                padding: '8px 16px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
                color: '#fff', border: 'none', cursor: 'pointer',
              }}
            >
              Connect EVM Wallet
            </button>
          )}
        </div>
      </div>

      {/* What this solves */}
      <div style={{
        background: '#1E1B4B', borderRadius: 12, padding: '14px 18px',
        marginBottom: 20, color: '#fff',
        display: 'flex', gap: 20, flexWrap: 'wrap', alignItems: 'center',
      }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 11, color: '#A5B4FC', fontWeight: 700, marginBottom: 4, letterSpacing: '0.05em' }}>
            WHY X LAYER?
          </div>
          <div style={{ fontSize: 13, color: '#E0E7FF', lineHeight: 1.6 }}>
            OnStock's Intent Router compares yield opportunities across <span style={{ color: '#14F195', fontWeight: 700 }}>Solana</span> and{' '}
            <span style={{ color: '#8B5CF6', fontWeight: 700 }}>X Layer (OKX L2)</span> — when X Layer vaults offer higher APY,
            the router automatically recommends cross-chain execution.
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <div style={{ textAlign: 'center', background: '#312E81', borderRadius: 10, padding: '10px 16px' }}>
            <div style={{ fontSize: 10, color: '#A5B4FC' }}>ERC4626 Standard</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#8B5CF6' }}>8 Vaults</div>
          </div>
          <div style={{ textAlign: 'center', background: '#312E81', borderRadius: 10, padding: '10px 16px' }}>
            <div style={{ fontSize: 10, color: '#A5B4FC' }}>Max APY</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#34D399' }}>5.50%</div>
          </div>
          <div style={{ textAlign: 'center', background: '#312E81', borderRadius: 10, padding: '10px 16px' }}>
            <div style={{ fontSize: 10, color: '#A5B4FC' }}>Network</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: '#fff' }}>OKB Gas</div>
          </div>
        </div>
      </div>

      {/* Vault cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {VAULTS.map(v => {
          const state = execState[v.symbol] ?? 'idle'
          const tx = execTx[v.symbol]
          const err = execErr[v.symbol]
          const isLoading = ['switching', 'approving', 'depositing'].includes(state)

          return (
            <div key={v.symbol} style={{
              borderRadius: 12,
              border: state === 'success' ? '1.5px solid #6366F1' : '1px solid #DDD6FE',
              background: state === 'success' ? '#EEF2FF' : '#fff',
              padding: '16px',
            }}>
              {/* Asset */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <div style={{
                  width: 32, height: 32, borderRadius: 8,
                  background: 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#fff', fontSize: 9, fontWeight: 800,
                }}>{v.symbol.slice(0, 4)}</div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: '#0F172A' }}>{v.symbol}</div>
                  <div style={{ fontSize: 10, color: '#94A3B8' }}>{v.name}</div>
                </div>
              </div>

              {/* APY */}
              <div style={{ marginBottom: 10 }}>
                <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 2 }}>Vault APY</div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#6366F1', lineHeight: 1 }}>
                  {v.apyPct.toFixed(2)}%
                </div>
                <div style={{ fontSize: 10, color: '#94A3B8', marginTop: 2 }}>ERC4626 · X Layer</div>
              </div>

              {/* Contract */}
              <a
                href={`https://www.okx.com/explorer/xlayer-test/address/${v.address}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ fontSize: 10, color: '#6366F1', display: 'block', marginBottom: 10, fontFamily: 'monospace' }}
              >
                {short(v.address)} ↗
              </a>

              {/* Action */}
              {state === 'success' ? (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: '#6366F1', marginBottom: 4 }}>✓ Deposited</div>
                  {tx && (
                    <a
                      href={`https://www.okx.com/explorer/xlayer-test/tx/${tx}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ fontSize: 10, color: '#6366F1' }}
                    >
                      View on OKX Explorer →
                    </a>
                  )}
                </div>
              ) : isLoading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <div style={{
                    width: 10, height: 10, borderRadius: '50%',
                    border: '2px solid #6366F1', borderTopColor: 'transparent',
                    animation: 'spin 0.8s linear infinite',
                  }} />
                  <span style={{ fontSize: 10, color: '#6366F1' }}>{statusLabel[state]}</span>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => handleDeposit(v.symbol)}
                    style={{
                      width: '100%', padding: '8px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                      background: isConnected
                        ? 'linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%)'
                        : '#EEF2FF',
                      color: isConnected ? '#fff' : '#6366F1',
                      border: isConnected ? 'none' : '1px solid #C7D2FE',
                      cursor: 'pointer',
                    }}
                  >
                    {isConnected ? 'Deposit on X Layer →' : 'Connect Wallet'}
                  </button>
                  {err && <div style={{ fontSize: 10, color: '#DC2626', marginTop: 4 }}>{err}</div>}
                </>
              )}
            </div>
          )
        })}
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
