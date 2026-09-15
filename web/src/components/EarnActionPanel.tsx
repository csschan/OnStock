'use client'

import { useState, useCallback, useEffect } from 'react'
import { usePhantom } from '@/components/PhantomProvider'
import { useKaminoSupply } from '@/hooks/useKaminoSupply'
import { useWalletBalances } from '@/hooks/useWalletBalances'
import { useVaultDeposit } from '@/hooks/useVaultDeposit'
import type { DefiYield } from '@/lib/api'
import { shortAddress } from '@/lib/solana'

// Protocol external fallback URLs
const PROTOCOL_URLS: Record<string, string> = {
  kamino:  'https://app.kamino.finance',
  nestusd: 'https://app.nestusd.com',
  raydium: 'https://raydium.io/liquidity/',
  shift:   'https://shiftrwa.com',
}

const PROTOCOL_COLOR: Record<string, string> = {
  kamino: '#2563EB', nestusd: '#059669', raydium: '#7C3AED', shift: '#DC2626', onstock: '#0EA5E9',
}

function TxStatusDisplay({ status, txHash, error, onClose }: {
  status: string; txHash: string | null; error: string | null; onClose: () => void
}) {
  if (status === 'idle') return null

  const isLoading = ['building', 'signing', 'confirming'].includes(status)
  const labels: Record<string, string> = {
    building: 'Building transaction...',
    signing: 'Waiting for signature...',
    confirming: 'Confirming on Solana...',
    success: 'Transaction confirmed!',
    error: 'Transaction failed',
  }

  return (
    <div style={{
      marginTop: 12, padding: '12px 16px', borderRadius: 10,
      background: status === 'success' ? '#F0FDF4' : status === 'error' ? '#FEF2F2' : '#EFF6FF',
      border: `1px solid ${status === 'success' ? '#86EFAC' : status === 'error' ? '#FECACA' : '#BFDBFE'}`,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isLoading && (
          <div style={{
            width: 14, height: 14, borderRadius: '50%',
            border: '2px solid #2563EB', borderTopColor: 'transparent',
            animation: 'spin 0.8s linear infinite',
          }} />
        )}
        <span style={{
          fontSize: 13, fontWeight: 600,
          color: status === 'success' ? '#16A34A' : status === 'error' ? '#DC2626' : '#2563EB',
        }}>
          {labels[status] ?? status}
        </span>
      </div>

      {error && (
        <div style={{ fontSize: 11, color: '#DC2626', marginTop: 4 }}>{error}</div>
      )}

      {txHash && (
        <a
          href={`https://solscan.io/tx/${txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 11, color: '#2563EB', display: 'block', marginTop: 4 }}
        >
          View on Solscan: {txHash.slice(0, 8)}... →
        </a>
      )}

      {(status === 'success' || status === 'error') && (
        <button
          onClick={onClose}
          style={{
            marginTop: 8, fontSize: 11, color: '#64748B', background: 'none',
            border: 'none', cursor: 'pointer', padding: 0,
          }}
        >
          Close
        </button>
      )}
    </div>
  )
}

function KaminoPanel({ yield: y }: { yield: DefiYield }) {
  const { publicKey } = usePhantom()
  const { balances, loading: balLoading } = useWalletBalances()
  const { status, txHash, error, supply, reset } = useKaminoSupply()
  const [amount, setAmount] = useState('')

  const bal = balances.find(b => b.symbol === y.asset)
  const maxAmount = bal?.amount ?? 0
  const parsedAmount = parseFloat(amount) || 0
  const canSubmit = parsedAmount > 0 && parsedAmount <= maxAmount && status === 'idle'

  return (
    <div>
      {/* Balance display */}
      <div style={{
        background: '#F8FAFC', borderRadius: 8, padding: '10px 12px',
        marginBottom: 12, fontSize: 12,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748B' }}>
          <span>Your {y.asset} balance</span>
          {balLoading ? (
            <span>Loading...</span>
          ) : (
            <span style={{ fontWeight: 700, color: '#0F172A' }}>
              {maxAmount > 0 ? maxAmount.toFixed(4) : 'None in wallet'}
            </span>
          )}
        </div>
      </div>

      {/* Amount input */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: '#94A3B8', display: 'block', marginBottom: 4 }}>
          Amount to Supply
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            min="0"
            max={maxAmount}
            step="0.01"
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 8,
              border: '1px solid #E2E8F0', fontSize: 14, fontFamily: 'monospace',
              outline: 'none',
            }}
          />
          <button
            onClick={() => setAmount(maxAmount.toFixed(4))}
            style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
              background: '#EFF6FF', color: '#2563EB', border: '1px solid #BFDBFE',
              cursor: 'pointer',
            }}
          >
            MAX
          </button>
        </div>
      </div>

      {/* Strategy preview */}
      {parsedAmount > 0 && (
        <div style={{
          background: '#EFF6FF', borderRadius: 8, padding: '10px 12px',
          marginBottom: 12, fontSize: 12,
        }}>
          <div style={{ color: '#2563EB', fontWeight: 700, marginBottom: 6 }}>Strategy Preview</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, color: '#334155' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Supply {y.asset}</span>
              <span style={{ fontWeight: 600, fontFamily: 'monospace' }}>{parsedAmount.toFixed(4)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Supply APY</span>
              <span style={{ fontWeight: 600, color: '#2563EB' }}>{y.supplyApy?.toFixed(2) ?? '~0'}%</span>
            </div>
            {y.ltv && (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>Max borrow (LTV {y.ltv}%)</span>
                <span style={{ fontWeight: 600 }}>
                  {/* estimate using price if available */}
                  up to {y.ltv}% of collateral value in USDC
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Submit */}
      <button
        disabled={!canSubmit}
        onClick={() => supply(y.asset, parsedAmount)}
        style={{
          width: '100%', padding: '12px', borderRadius: 10,
          background: canSubmit ? '#2563EB' : '#E2E8F0',
          color: canSubmit ? '#fff' : '#94A3B8',
          border: 'none', fontSize: 14, fontWeight: 700, cursor: canSubmit ? 'pointer' : 'not-allowed',
        }}
      >
        {maxAmount === 0
          ? `You need ${y.asset} to supply`
          : `Supply ${parsedAmount > 0 ? parsedAmount.toFixed(4) : ''} ${y.asset} to Kamino`}
      </button>

      <TxStatusDisplay status={status} txHash={txHash} error={error} onClose={reset} />
    </div>
  )
}

function VaultPanel({ yield: y, defaultTab }: { yield: DefiYield; defaultTab?: 'deposit' | 'withdraw' }) {
  const { balances, loading: balLoading } = useWalletBalances()
  const { status, txHash, error, position, positionLoading, deposit, withdraw, reset, refreshPosition } = useVaultDeposit()
  const [amount, setAmount] = useState('')
  const [tab, setTab] = useState<'deposit' | 'withdraw'>(defaultTab ?? 'deposit')

  const bal = balances.find(b => b.symbol === y.asset)
  const maxAmount = bal?.amount ?? 0
  const parsedAmount = parseFloat(amount) || 0
  const maxWithdraw = position?.userShares ?? 0
  const canDeposit = tab === 'deposit' && parsedAmount > 0 && parsedAmount <= maxAmount && status === 'idle'
  const canWithdraw = tab === 'withdraw' && parsedAmount > 0 && parsedAmount <= maxWithdraw && status === 'idle'

  useEffect(() => {
    refreshPosition(y.asset)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [y.asset])

  return (
    <div>
      {/* Position card */}
      {(position || positionLoading) && (
        <div style={{
          background: 'linear-gradient(135deg, #EFF6FF 0%, #F0FDF4 100%)',
          borderRadius: 10, padding: '12px 14px', marginBottom: 12,
          border: '1px solid #BFDBFE',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#1D4ED8', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Your Vault Position
          </div>
          {positionLoading ? (
            <div style={{ fontSize: 12, color: '#64748B' }}>Loading...</div>
          ) : position && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 0' }}>
              {[
                ['Shares', position.userShares.toFixed(6)],
                ['Deposited', `${position.depositedAmount.toFixed(4)} ${y.asset}`],
                ['Current Value', `${position.currentValue.toFixed(4)} ${y.asset}`],
                ['NAV/Share', position.nav.toFixed(6)],
              ].map(([label, val]) => (
                <div key={label}>
                  <div style={{ fontSize: 10, color: '#94A3B8' }}>{label}</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{val}</div>
                </div>
              ))}
              <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
                <div style={{ fontSize: 10, color: '#94A3B8' }}>PnL</div>
                <div style={{
                  fontSize: 13, fontWeight: 700, fontFamily: 'monospace',
                  color: position.pnl >= 0 ? '#16A34A' : '#DC2626',
                }}>
                  {position.pnl >= 0 ? '+' : ''}{position.pnl.toFixed(4)} {y.asset}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Deposit / Withdraw tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {(['deposit', 'withdraw'] as const).map(t => (
          <button
            key={t}
            onClick={() => { setTab(t); setAmount(''); reset() }}
            style={{
              flex: 1, padding: '7px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              border: '1px solid',
              borderColor: tab === t ? '#2563EB' : '#E2E8F0',
              background: tab === t ? '#EFF6FF' : '#fff',
              color: tab === t ? '#2563EB' : '#94A3B8',
              cursor: 'pointer',
              textTransform: 'capitalize',
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Balance */}
      <div style={{
        background: '#F8FAFC', borderRadius: 8, padding: '8px 12px',
        marginBottom: 10, fontSize: 12,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748B' }}>
          <span>{tab === 'deposit' ? `${y.asset} balance` : 'Shares balance'}</span>
          {balLoading ? (
            <span>Loading...</span>
          ) : (
            <span style={{ fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>
              {tab === 'deposit'
                ? (maxAmount > 0 ? maxAmount.toFixed(4) : 'None in wallet')
                : (maxWithdraw > 0 ? maxWithdraw.toFixed(6) : 'No position')}
            </span>
          )}
        </div>
      </div>

      {/* Amount input */}
      <div style={{ marginBottom: 12 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="number"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            min="0"
            step="0.01"
            style={{
              flex: 1, padding: '8px 12px', borderRadius: 8,
              border: '1px solid #E2E8F0', fontSize: 14, fontFamily: 'monospace',
              outline: 'none',
            }}
          />
          <button
            onClick={() => setAmount(tab === 'deposit' ? maxAmount.toFixed(4) : maxWithdraw.toFixed(6))}
            style={{
              padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
              background: '#EFF6FF', color: '#2563EB', border: '1px solid #BFDBFE',
              cursor: 'pointer',
            }}
          >
            MAX
          </button>
        </div>
      </div>

      {/* APY preview */}
      {parsedAmount > 0 && tab === 'deposit' && (
        <div style={{
          background: '#EFF6FF', borderRadius: 8, padding: '10px 12px',
          marginBottom: 12, fontSize: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#334155' }}>
            <span>Estimated APY</span>
            <span style={{ fontWeight: 700, color: '#2563EB' }}>{y.netApy.toFixed(2)}%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#334155', marginTop: 4 }}>
            <span>Strategy</span>
            <span style={{ fontWeight: 600 }}>Kamino Supply + Auto-Harvest</span>
          </div>
        </div>
      )}

      {/* Submit */}
      <button
        disabled={tab === 'deposit' ? !canDeposit : !canWithdraw}
        onClick={() => tab === 'deposit' ? deposit(y.asset, parsedAmount) : withdraw(y.asset, parsedAmount)}
        style={{
          width: '100%', padding: '12px', borderRadius: 10,
          background: (tab === 'deposit' ? canDeposit : canWithdraw) ? '#2563EB' : '#E2E8F0',
          color: (tab === 'deposit' ? canDeposit : canWithdraw) ? '#fff' : '#94A3B8',
          border: 'none', fontSize: 14, fontWeight: 700,
          cursor: (tab === 'deposit' ? canDeposit : canWithdraw) ? 'pointer' : 'not-allowed',
        }}
      >
        {tab === 'deposit'
          ? (maxAmount === 0 ? `You need ${y.asset} to deposit` : `Deposit ${parsedAmount > 0 ? parsedAmount.toFixed(4) : ''} ${y.asset}`)
          : (maxWithdraw === 0 ? 'No position to withdraw' : `Withdraw ${parsedAmount > 0 ? parsedAmount.toFixed(6) : ''} shares`)}
      </button>

      <TxStatusDisplay status={status} txHash={txHash} error={error} onClose={reset} />
    </div>
  )
}

function ExternalPanel({ yield: y }: { yield: DefiYield }) {
  const url = PROTOCOL_URLS[y.protocol] ?? '#'
  const color = PROTOCOL_COLOR[y.protocol] ?? '#64748B'

  const steps: string[] = y.protocol === 'nestusd'
    ? ['Deposit your xStock token as collateral', 'Mint nUSD stablecoin (3% APR borrow cost)', 'Stake nUSD as sNUSD to earn 6% APY', 'Net yield: ~3% APY on your xStock value']
    : y.protocol === 'raydium'
    ? ['Provide xStock + USDC as a pair', 'Earn trading fees from Raydium pool', 'Risk: Impermanent loss if price diverges', `Current fee APR: ${y.netApy.toFixed(1)}%`]
    : y.protocol === 'shift'
    ? ['Buy leveraged token on Jupiter', 'No margin calls — position degrades in NAV', 'Tracks underlying xStock with leverage', 'Suitable for short-term directional trades']
    : []

  return (
    <div>
      <div style={{
        background: '#F8FAFC', borderRadius: 8, padding: '12px 14px', marginBottom: 12,
      }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', marginBottom: 8 }}>
          How it works
        </div>
        <ol style={{ padding: '0 0 0 16px', margin: 0 }}>
          {steps.map((step, i) => (
            <li key={i} style={{ fontSize: 12, color: '#334155', marginBottom: 4, lineHeight: 1.5 }}>
              {step}
            </li>
          ))}
        </ol>
      </div>

      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: 'block', textAlign: 'center', padding: '12px',
          borderRadius: 10, textDecoration: 'none',
          background: color, color: '#fff',
          fontSize: 14, fontWeight: 700,
        }}
      >
        Open {y.protocolName} →
      </a>
      <div style={{ fontSize: 11, color: '#94A3B8', textAlign: 'center', marginTop: 6 }}>
        Opens in new tab — transaction in {y.protocolName} UI
      </div>
    </div>
  )
}

export default function EarnActionPanel({ yield: y, defaultTab }: { yield: DefiYield; defaultTab?: 'deposit' | 'withdraw' }) {
  const { connected, publicKey, disconnect, connect: connectPhantom } = usePhantom()

  return (
    <div style={{
      border: '1px solid #E2E8F0', borderRadius: 12, padding: '16px',
      marginTop: 12, background: '#FAFAFA',
    }}>
      {/* Wallet status bar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #E2E8F0',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>
          {y.protocol === 'kamino' ? 'Execute on OnStock' : y.protocol === 'onstock' ? 'OnStock Vault' : 'Strategy Details'}
        </div>
        {connected && publicKey ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A' }} />
            <span style={{ fontSize: 11, color: '#64748B', fontFamily: 'monospace' }}>
              {shortAddress(publicKey.toBase58())}
            </span>
            <button
              onClick={() => disconnect()}
              style={{
                fontSize: 10, color: '#94A3B8', background: 'none',
                border: 'none', cursor: 'pointer', padding: 0,
              }}
            >
              Disconnect
            </button>
          </div>
        ) : (
          <button
            onClick={() => connectPhantom()}
            style={{
              padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
              background: '#9945FF', color: '#fff', border: 'none', cursor: 'pointer',
            }}
          >
            Connect Phantom
          </button>
        )}
      </div>

      {/* Protocol-specific panel */}
      {y.protocol === 'kamino' ? (
        connected
          ? <KaminoPanel yield={y} />
          : (
            <div style={{ textAlign: 'center', padding: '16px 0', color: '#64748B', fontSize: 13 }}>
              Connect your Phantom wallet to supply {y.asset} directly on Kamino
            </div>
          )
      ) : y.protocol === 'onstock' ? (
        connected
          ? <VaultPanel yield={y} defaultTab={defaultTab} />
          : (
            <div style={{ textAlign: 'center', padding: '16px 0', color: '#64748B', fontSize: 13 }}>
              Connect your wallet to deposit {y.asset} into the OnStock Vault
            </div>
          )
      ) : (
        <ExternalPanel yield={y} />
      )}
    </div>
  )
}
