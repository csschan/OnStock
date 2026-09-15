'use client'

import { useState, useEffect, useCallback } from 'react'
import { Connection, PublicKey } from '@solana/web3.js'
import { usePhantom } from '@/components/PhantomProvider'
import { useSolanaNetwork } from '@/components/SolanaWalletProvider'

export interface TokenBalance {
  symbol: string
  mint: string
  amount: number
  decimals: number
}

// Network-aware xStock mint addresses (devnet includes MockUSDC for intent flow)
const MINTS_BY_NETWORK: Record<string, Record<string, string>> = {
  devnet: {
    USDC:   'DUyFygnq4QBfYF6NezG8A7t95PETDPWPz3PeBJVUhN8k', // Mock USDC (devnet only)
    TSLAx:  '57iTEvgXrXTELN2pXfP3hupauPah1Sep1jXeBJKSZase',
    NVDAx:  'HbxyTFGHosSW6JTjZJQDWgbwD1vjdCBrmM74yEPMYdmU',
    SPYx:   'ukQEM3AJMFcEUZ5wnwi5raqajapWGJz4LKrp61P34iX',
    AAPLx:  'FVRVha9Xv4mcADLbsigN5t6o1R6fQ4ZiF6NU9itTAMUn',
    GOOGLx: '3RfkE3oJCMH8LVny9wZUz8L1Ub6FjdaNMk88hc3Z5GdW',
    METAx:  '3jdTnxC2DMibnnfG7GuovCK9PMpro7p7tdaTPGDzobAU',
    COINx:  'D35oALKAHTHr2wKQSTVLUALCWCijjjdpQSq53jrQsFTC',
    MSTRx:  '9BqDyWHHmk4nK252REa48fCaMTWmCZg4muaWDcobpDcN',
  },
  localnet: {
    USDC:   'DUyFygnq4QBfYF6NezG8A7t95PETDPWPz3PeBJVUhN8k',
    TSLAx:  '57iTEvgXrXTELN2pXfP3hupauPah1Sep1jXeBJKSZase',
    NVDAx:  'HbxyTFGHosSW6JTjZJQDWgbwD1vjdCBrmM74yEPMYdmU',
    SPYx:   'ukQEM3AJMFcEUZ5wnwi5raqajapWGJz4LKrp61P34iX',
    AAPLx:  'FVRVha9Xv4mcADLbsigN5t6o1R6fQ4ZiF6NU9itTAMUn',
    GOOGLx: '3RfkE3oJCMH8LVny9wZUz8L1Ub6FjdaNMk88hc3Z5GdW',
    METAx:  '3jdTnxC2DMibnnfG7GuovCK9PMpro7p7tdaTPGDzobAU',
    COINx:  'D35oALKAHTHr2wKQSTVLUALCWCijjjdpQSq53jrQsFTC',
    MSTRx:  '9BqDyWHHmk4nK252REa48fCaMTWmCZg4muaWDcobpDcN',
  },
  mainnet: {
    TSLAx:  'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',
    NVDAx:  'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',
    SPYx:   'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W',
    QQQx:   'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ',
    AAPLx:  'XsQmv6PVbNMjaKiBbxnCbCg19FBNoR8Ks2GFVPVzrXq',
    GOOGLx: 'XsNYmeWqkNbqRiP9ekxXjf3MDmVPP3M1UJqzLDMKfFR',
    METAx:  'XsCqFRredZFCKAS9WJaWkFwax5oNfgnPJLPPDiPzfdS',
    COINx:  'Xs6CiCjqSEVMZPfPfWfMsfQ3ZLm3djJaH5W5s4J2Npb',
    MSTRx:  'XsMfJjQxk5TGsqpPiGk3tuJmNjQ8CZHARQb5qeuHb3b',
  },
}

export function useWalletBalances() {
  const { publicKey } = usePhantom()
  const { rpc, network } = useSolanaNetwork()
  const [balances, setBalances] = useState<TokenBalance[]>([])
  const [loading, setLoading] = useState(false)

  const fetchBalances = useCallback(async () => {
    if (!publicKey) { setBalances([]); return }
    setLoading(true)
    try {
      const connection = new Connection(rpc, 'confirmed')
      const xstockMints = MINTS_BY_NETWORK[network] ?? MINTS_BY_NETWORK.mainnet
      const mintToSymbol = Object.fromEntries(
        Object.entries(xstockMints).map(([sym, mint]) => [mint, sym])
      )

      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'),
      })

      const result: TokenBalance[] = []
      for (const { account } of tokenAccounts.value) {
        const parsed = account.data.parsed?.info
        if (!parsed) continue
        const symbol = mintToSymbol[parsed.mint]
        if (!symbol) continue
        const amount = parsed.tokenAmount?.uiAmount ?? 0
        if (amount > 0) result.push({ symbol, mint: parsed.mint, amount, decimals: parsed.tokenAmount?.decimals ?? 6 })
      }
      setBalances(result)
    } catch (err) {
      console.error('[balances]', err)
    } finally {
      setLoading(false)
    }
  }, [publicKey, rpc, network])

  useEffect(() => { fetchBalances() }, [fetchBalances])

  return { balances, loading, refresh: fetchBalances }
}
