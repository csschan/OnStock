'use client'

import { useState, useCallback } from 'react'
import { useAccount, useSendTransaction, useSwitchChain, useWaitForTransactionReceipt } from 'wagmi'
import { xlayerTestnet } from '@/components/Web3Provider'

export type XLayerStatus =
  | 'idle'
  | 'building'
  | 'switching_chain'
  | 'approving'
  | 'confirming_approve'
  | 'depositing'
  | 'confirming_deposit'
  | 'success'
  | 'error'

export interface XLayerExecResult {
  mintTxHash: string | null
  approveTxHash: string | null
  depositTxHash: string | null
  xstockOut: number
  xstockSymbol: string
  vaultAddress: string
  explorer: string
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api'

export function useXLayerExecute() {
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { sendTransactionAsync } = useSendTransaction()

  const [status, setStatus] = useState<XLayerStatus>('idle')
  const [error, setError]   = useState<string | null>(null)
  const [result, setResult] = useState<XLayerExecResult | null>(null)

  const reset = useCallback(() => {
    setStatus('idle'); setError(null); setResult(null)
  }, [])

  const execute = useCallback(async (asset: string, amountUsd: number) => {
    if (!address) { setError('Connect EVM wallet first'); return }

    setStatus('building')
    setError(null)
    setResult(null)

    try {
      // Switch to X Layer if needed
      if (chainId !== xlayerTestnet.id) {
        setStatus('switching_chain')
        await switchChainAsync({ chainId: xlayerTestnet.id })
      }

      // Build transactions from server
      setStatus('building')
      const resp = await fetch(`${API_BASE}/xlayer/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, amountUsd, walletAddress: address }),
      })
      const json = await resp.json()
      if (!json.ok) throw new Error(json.error ?? 'Server error')

      const { approveTx, depositTx, mintTxHash, xstockSymbol, xstockOut, vaultAddress, explorer } = json.data

      // Tx 1: Approve vault to spend xStock
      setStatus('approving')
      const approveTxHash = await sendTransactionAsync({
        to: approveTx.to as `0x${string}`,
        data: approveTx.data as `0x${string}`,
      })

      setStatus('confirming_approve')
      // Wait a bit for confirmation
      await new Promise(r => setTimeout(r, 3000))

      // Tx 2: Deposit into vault
      setStatus('depositing')
      const depositTxHash = await sendTransactionAsync({
        to: depositTx.to as `0x${string}`,
        data: depositTx.data as `0x${string}`,
      })

      setStatus('confirming_deposit')
      await new Promise(r => setTimeout(r, 3000))

      setStatus('success')
      setResult({
        mintTxHash,
        approveTxHash,
        depositTxHash,
        xstockOut,
        xstockSymbol,
        vaultAddress,
        explorer,
      })
    } catch (err: any) {
      console.error('[XLayerExecute]', err)
      if (err?.message?.includes('User rejected') || err?.message?.includes('rejected')) {
        setStatus('idle')
      } else {
        setError(err?.message ?? 'Execution failed')
        setStatus('error')
      }
    }
  }, [address, chainId, switchChainAsync, sendTransactionAsync])

  return { status, error, result, execute, reset }
}
