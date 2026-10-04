'use client'

import { useState, useCallback } from 'react'
import { useAccount, useWriteContract, useSwitchChain } from 'wagmi'
import { parseAbi, parseUnits, createPublicClient, http } from 'viem'
import { xlayerTestnet, arbitrumSepolia } from '@/components/Web3Provider'

const evmClients: Record<number, ReturnType<typeof createPublicClient>> = {}
function getClient(chain: { id: number; rpcUrls: { default: { http: string[] } } }) {
  if (!evmClients[chain.id]) evmClients[chain.id] = createPublicClient({ chain: chain as any, transport: http(chain.rpcUrls.default.http[0]) })
  return evmClients[chain.id]
}

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

const erc20Abi = parseAbi([
  'function approve(address spender, uint256 amount) returns (bool)',
])

const erc4626Abi = parseAbi([
  'function deposit(uint256 assets, address receiver) returns (uint256)',
])

export function useXLayerExecute() {
  const { address, chainId } = useAccount()
  const { switchChainAsync } = useSwitchChain()
  const { writeContractAsync } = useWriteContract()

  const [status, setStatus] = useState<XLayerStatus>('idle')
  const [error, setError]   = useState<string | null>(null)
  const [result, setResult] = useState<XLayerExecResult | null>(null)

  const reset = useCallback(() => {
    setStatus('idle'); setError(null); setResult(null)
  }, [])

  const execute = useCallback(async (asset: string, amountUsd: number, evmChain?: 'xlayer' | 'arbitrum') => {
    if (!address) { setError('Connect EVM wallet first'); return }
    const targetChain = evmChain === 'arbitrum' ? arbitrumSepolia : xlayerTestnet
    const apiPath = evmChain === 'arbitrum' ? 'arbitrum' : 'xlayer'

    setStatus('building')
    setError(null)
    setResult(null)

    try {
      // Switch to X Layer if needed
      if (chainId !== targetChain.id) {
        setStatus('switching_chain')
        await switchChainAsync({ chainId: targetChain.id })
      }

      // Build transactions from server (server also mints xStock to user)
      setStatus('building')
      const resp = await fetch(`${API_BASE}/${apiPath}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ asset, amountUsd, walletAddress: address }),
      })
      const json = await resp.json()
      if (!json.ok) throw new Error(json.error ?? 'Server error')

      const { mintTxHash, xstockSymbol, xstockOut, vaultAddress, tokenAddress, explorer } = json.data
      // Convert xstockOut to 18-decimal bigint
      const depositAmount = parseUnits(xstockOut.toString(), 18)

      // Tx 1: Approve vault to spend xStock
      setStatus('approving')
      const approveTxHash = await writeContractAsync({
        address: tokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: 'approve',
        args: [vaultAddress as `0x${string}`, depositAmount],
        chainId: targetChain.id,
      })

      setStatus('confirming_approve')
      await new Promise(r => setTimeout(r, 8000))

      // Tx 2: Deposit into vault
      setStatus('depositing')
      const depositTxHash = await writeContractAsync({
        address: vaultAddress as `0x${string}`,
        abi: erc4626Abi,
        functionName: 'deposit',
        args: [depositAmount, address],
        chainId: targetChain.id,
      })

      setStatus('confirming_deposit')
      await new Promise(r => setTimeout(r, 8000))

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
        setError(err?.shortMessage ?? err?.message ?? 'Execution failed')
        setStatus('error')
      }
    }
  }, [address, chainId, switchChainAsync, writeContractAsync])

  return { status, error, result, execute, reset }
}
