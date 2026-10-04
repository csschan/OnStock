'use client'

import { useState, useCallback, useEffect, useMemo } from 'react'
import { usePhantom } from '@/components/PhantomProvider'
import { useKaminoSupply } from '@/hooks/useKaminoSupply'
import { useWalletBalances } from '@/hooks/useWalletBalances'
import { useVaultDeposit } from '@/hooks/useVaultDeposit'
import { useAccount, useConnect, useWriteContract, useSwitchChain, useReadContracts } from 'wagmi'
import { parseAbi, parseUnits, formatUnits, createPublicClient, http } from 'viem'
import { xlayerTestnet, arbitrumSepolia } from '@/components/Web3Provider'
import type { DefiYield } from '@/lib/api'
import { shortAddress } from '@/lib/solana'

const evmClients: Record<number, ReturnType<typeof createPublicClient>> = {}
function getEvmClient(chain: { id: number; rpcUrls: { default: { http: string[] } } }) {
  if (!evmClients[chain.id]) {
    evmClients[chain.id] = createPublicClient({ chain: chain as any, transport: http(chain.rpcUrls.default.http[0]) })
  }
  return evmClients[chain.id]
}
const xlErc20Abi = parseAbi(['function approve(address spender, uint256 amount) returns (bool)'])
const xlVaultAbi = parseAbi([
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
])

// Protocol external fallback URLs
const PROTOCOL_URLS: Record<string, string> = {
  kamino:  'https://app.kamino.finance',
  nestusd: 'https://app.nestusd.com',
  raydium: 'https://raydium.io/liquidity/',
  shift:   'https://shiftrwa.com',
}

const PROTOCOL_COLOR: Record<string, string> = {
  kamino: '#2563EB', nestusd: '#059669', raydium: '#7C3AED', shift: '#DC2626', onstock: '#0EA5E9', 'xlayer-vault': '#6366F1', 'arbitrum-vault': '#28A0F0',
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
          href={`https://solscan.io/tx/${txHash}?cluster=devnet`}
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

const API_BASE_XL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'

function XLayerVaultPanel({ yield: y, defaultTab }: { yield: DefiYield; defaultTab?: 'deposit' | 'withdraw' }) {
  const { address } = useAccount()
  const { connect, connectors } = useConnect()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()
  const [tab, setTab] = useState<'deposit' | 'withdraw'>(defaultTab ?? 'deposit')
  const [amount, setAmount] = useState('')
  const [status, setStatus] = useState<'idle' | 'switching' | 'approving' | 'depositing' | 'redeeming' | 'success' | 'error'>('idle')
  const [txHash, setTxHash] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Determine chain based on protocol
  const isArbitrum = y.protocol === 'arbitrum-vault'
  const chain = isArbitrum ? arbitrumSepolia : xlayerTestnet
  // Each chain needs its own public client for waitForTransactionReceipt
  const apiPath = isArbitrum ? 'arbitrum' : 'xlayer'
  const explorerBase = isArbitrum ? 'https://sepolia.arbiscan.io/tx/' : 'https://www.okx.com/explorer/xlayer-test/tx/'

  // y.details contains vault address as JSON: { vaultAddress, tokenAddress }
  const vaultMeta = useMemo(() => {
    try { return JSON.parse(y.details) } catch { return null }
  }, [y.details])
  const vaultAddress = vaultMeta?.vaultAddress as `0x${string}` | undefined
  const tokenAddress = vaultMeta?.tokenAddress as `0x${string}` | undefined

  // Read shares
  const shareContracts = useMemo(() => {
    if (!address || !vaultAddress) return []
    return [{ address: vaultAddress, abi: xlVaultAbi, functionName: 'balanceOf' as const, args: [address] as readonly [`0x${string}`], chainId: chain.id }]
  }, [address, vaultAddress, chain.id])
  const { data: shareData } = useReadContracts({ contracts: shareContracts, query: { enabled: !!address && !!vaultAddress } })
  const shares = shareData?.[0]?.status === 'success' ? (shareData[0].result as bigint) : 0n
  const sharesNum = Number(formatUnits(shares, 18))

  async function handleDeposit() {
    if (!address || !vaultAddress || !tokenAddress) return
    setStatus('switching'); setError(null); setTxHash(null)
    try {
      await switchChainAsync({ chainId: chain.id})
      setStatus('approving')
      const resp = await fetch(`${API_BASE_XL}/${apiPath}/execute`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset: y.asset.replace('x', ''), amountUsd: 500, walletAddress: address }),
      })
      const json = await resp.json()
      if (!json.ok) throw new Error(json.error)
      const depositAmount = parseUnits(json.data.xstockOut.toString(), 18)
      const appHash = await writeContractAsync({ address: tokenAddress, abi: xlErc20Abi, functionName: 'approve', args: [vaultAddress, depositAmount], chainId: chain.id})
      await new Promise(r => setTimeout(r, 8000))
      setStatus('depositing')
      const depHash = await writeContractAsync({ address: vaultAddress, abi: xlVaultAbi, functionName: 'deposit', args: [depositAmount, address], chainId: chain.id})
      await new Promise(r => setTimeout(r, 8000))
      setTxHash(depHash); setStatus('success')
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? 'Failed'); setStatus('error')
    }
  }

  async function handleWithdraw() {
    if (!address || !vaultAddress || shares === 0n) return
    const withdrawAmount = parseFloat(amount) || 0
    if (withdrawAmount <= 0 || shares === 0n) return
    setStatus('switching'); setError(null); setTxHash(null)
    try {
      await switchChainAsync({ chainId: chain.id})
      setStatus('redeeming')
      // Use full shares if amount matches MAX (avoid precision issues), otherwise parse
      const redeemShares = Math.abs(withdrawAmount - sharesNum) < 0.001 ? shares : parseUnits(withdrawAmount.toString(), 18)
      const hash = await writeContractAsync({ address: vaultAddress, abi: xlVaultAbi, functionName: 'redeem', args: [redeemShares, address, address], chainId: chain.id})
      await new Promise(r => setTimeout(r, 8000))
      setTxHash(hash); setStatus('success')
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? 'Withdraw failed'); setStatus('error')
    }
  }

  const parsedAmount = parseFloat(amount) || 0
  const canDeposit = tab === 'deposit' && status === 'idle'
  const canWithdraw = tab === 'withdraw' && parsedAmount > 0 && parsedAmount <= sharesNum + 0.0001 && status === 'idle'

  const isLoading = ['switching', 'approving', 'depositing', 'redeeming'].includes(status)
  const statusLabels: Record<string, string> = {
    switching: 'Switching to X Layer...', approving: 'Sign Approve...',
    depositing: 'Sign Vault Deposit...', redeeming: 'Redeeming from Vault...', success: 'Done!', error: 'Failed',
  }

  return (
    <div>
      {/* Position card — identical to Solana VaultPanel */}
      {sharesNum > 0.000001 && (
        <div style={{
          background: 'linear-gradient(135deg, #EEF2FF 0%, #F5F3FF 100%)',
          borderRadius: 10, padding: '12px 14px', marginBottom: 12,
          border: '1px solid #C7D2FE',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#6366F1', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Your Vault Position
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 0' }}>
            {[
              ['Shares', sharesNum.toFixed(6)],
              ['Deposited', `${sharesNum.toFixed(4)} ${y.asset}`],
              ['Current Value', `${sharesNum.toFixed(4)} ${y.asset}`],
              ['NAV/Share', '1.000000'],
            ].map(([label, val]) => (
              <div key={label}>
                <div style={{ fontSize: 10, color: '#94A3B8' }}>{label}</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>{val}</div>
              </div>
            ))}
            <div style={{ gridColumn: '1 / -1', marginTop: 4 }}>
              <div style={{ fontSize: 10, color: '#94A3B8' }}>PnL</div>
              <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', color: '#16A34A' }}>
                +0.0000 {y.asset}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Deposit / Withdraw tabs — identical to Solana */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 12 }}>
        {(['deposit', 'withdraw'] as const).map(t => (
          <button key={t} onClick={() => { setTab(t); setAmount(''); setStatus('idle'); setError(null) }} style={{
            flex: 1, padding: '7px', borderRadius: 8, fontSize: 12, fontWeight: 700,
            border: '1px solid', textTransform: 'capitalize',
            borderColor: tab === t ? '#6366F1' : '#E2E8F0',
            background: tab === t ? '#EEF2FF' : '#fff',
            color: tab === t ? '#6366F1' : '#94A3B8',
            cursor: 'pointer',
          }}>{t}</button>
        ))}
      </div>

      {/* Balance — identical to Solana */}
      <div style={{ background: '#F8FAFC', borderRadius: 8, padding: '8px 12px', marginBottom: 10, fontSize: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#64748B' }}>
          <span>{tab === 'deposit' ? `${y.asset} balance` : 'Shares balance'}</span>
          <span style={{ fontWeight: 700, color: '#0F172A', fontFamily: 'monospace' }}>
            {tab === 'withdraw'
              ? (sharesNum > 0 ? sharesNum.toFixed(6) : 'No position')
              : '—'}
          </span>
        </div>
      </div>

      {/* Amount input + MAX — identical to Solana */}
      {tab === 'withdraw' && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="number"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              min="0"
              max={sharesNum}
              step="0.01"
              style={{
                flex: 1, padding: '8px 12px', borderRadius: 8,
                border: '1px solid #E2E8F0', fontSize: 14, fontFamily: 'monospace',
                outline: 'none',
              }}
            />
            <button
              onClick={() => setAmount(sharesNum.toFixed(6))}
              style={{
                padding: '8px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700,
                background: '#EEF2FF', color: '#6366F1', border: '1px solid #C7D2FE',
                cursor: 'pointer',
              }}
            >
              MAX
            </button>
          </div>
        </div>
      )}

      {/* APY preview on deposit — identical to Solana */}
      {tab === 'deposit' && (
        <div style={{
          background: '#EEF2FF', borderRadius: 8, padding: '10px 12px',
          marginBottom: 12, fontSize: 12,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#334155' }}>
            <span>Estimated APY</span>
            <span style={{ fontWeight: 700, color: '#6366F1' }}>{y.netApy.toFixed(2)}%</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#334155', marginTop: 4 }}>
            <span>Strategy</span>
            <span style={{ fontWeight: 600 }}>ERC4626 Vault · X Layer</span>
          </div>
        </div>
      )}

      {/* Status / Submit — identical to Solana */}
      {status === 'success' ? (
        <div style={{ padding: '12px', borderRadius: 10, background: '#F0FDF4', border: '1px solid #86EFAC', marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#16A34A' }}>Transaction confirmed!</div>
          {txHash && (
            <a href={`${explorerBase}${txHash}`} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 11, color: '#6366F1', display: 'block', marginTop: 4 }}>
              View on OKX Explorer: {txHash.slice(0, 8)}... →
            </a>
          )}
          <button onClick={() => { setStatus('idle'); setTxHash(null); setAmount('') }}
            style={{ marginTop: 8, fontSize: 11, color: '#64748B', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Close</button>
        </div>
      ) : isLoading ? (
        <div style={{ padding: '12px', borderRadius: 10, background: '#EEF2FF', border: '1px solid #C7D2FE', display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid #6366F1', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#6366F1' }}>{statusLabels[status]}</span>
        </div>
      ) : (
        <>
          <button
            disabled={tab === 'deposit' ? !canDeposit : !canWithdraw}
            onClick={() => tab === 'deposit' ? handleDeposit() : handleWithdraw()}
            style={{
              width: '100%', padding: '12px', borderRadius: 10, fontSize: 14, fontWeight: 700,
              background: (tab === 'deposit' ? canDeposit : canWithdraw) ? '#6366F1' : '#E2E8F0',
              color: (tab === 'deposit' ? canDeposit : canWithdraw) ? '#fff' : '#94A3B8',
              border: 'none', cursor: (tab === 'deposit' ? canDeposit : canWithdraw) ? 'pointer' : 'not-allowed',
            }}
          >
            {tab === 'deposit'
              ? `Deposit ${y.asset} on X Layer`
              : (sharesNum < 0.000001 ? 'No position to withdraw' : `Withdraw ${parsedAmount > 0 ? parsedAmount.toFixed(6) : ''} shares`)}
          </button>
          {error && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 6, textAlign: 'center' }}>{error}</div>}
        </>
      )}
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
  const { address: evmAddr, isConnected: evmConnected } = useAccount()
  const isEvmProtocol = y.protocol === 'xlayer-vault' || y.protocol === 'arbitrum-vault'

  // Determine which wallet to show based on protocol
  const walletConnected = isEvmProtocol ? evmConnected : connected
  const walletLabel = isEvmProtocol
    ? (evmAddr ? `${evmAddr.slice(0, 6)}...${evmAddr.slice(-4)}` : '')
    : (publicKey ? shortAddress(publicKey.toBase58()) : '')
  const protocolLabel = isEvmProtocol
    ? (y.protocol === 'arbitrum-vault' ? 'Arbitrum Vault' : 'X Layer Vault')
    : y.protocol === 'kamino' ? 'Execute on OnStock'
    : y.protocol === 'onstock' ? 'OnStock Vault'
    : 'Strategy Details'

  return (
    <div style={{
      border: '1px solid #E2E8F0', borderRadius: 12, padding: '16px',
      marginTop: 12, background: '#FAFAFA',
    }}>
      {/* Wallet status bar — shows EVM or Solana based on protocol */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid #E2E8F0',
      }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#0F172A' }}>
          {protocolLabel}
        </div>
        {walletConnected ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: '50%', background: '#16A34A' }} />
            <span style={{ fontSize: 11, color: '#64748B', fontFamily: 'monospace' }}>
              {isEvmProtocol ? '⬡' : '◎'} {walletLabel}
            </span>
          </div>
        ) : isEvmProtocol ? (
          <span style={{ fontSize: 11, color: '#94A3B8' }}>
            Connect EVM wallet via top nav
          </span>
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
      {y.protocol === 'xlayer-vault' || y.protocol === 'arbitrum-vault' ? (
        <XLayerVaultPanel yield={y} defaultTab={defaultTab} />
      ) : y.protocol === 'kamino' ? (
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
