'use client'

import { useMemo, useState, createContext, useContext, useCallback } from 'react'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom'
import '@solana/wallet-adapter-react-ui/styles.css'

export type SolanaNetwork = 'localnet' | 'devnet' | 'mainnet'

const NETWORK_CONFIG: Record<SolanaNetwork, { label: string; rpc: string; color: string }> = {
  localnet: { label: 'Localnet',  rpc: 'http://127.0.0.1:8899',              color: '#F59E0B' },
  devnet:   { label: 'Devnet',    rpc: process.env.NEXT_PUBLIC_SOLANA_RPC ?? 'https://api.devnet.solana.com', color: '#8B5CF6' },
  mainnet:  { label: 'Mainnet',   rpc: 'https://api.mainnet-beta.solana.com', color: '#16A34A' },
}

interface SolanaNetworkCtx {
  network: SolanaNetwork
  setNetwork: (n: SolanaNetwork) => void
  rpc: string
  label: string
  color: string
}

const NetworkContext = createContext<SolanaNetworkCtx>({
  network: 'localnet', setNetwork: () => {}, rpc: NETWORK_CONFIG.localnet.rpc,
  label: 'Localnet', color: '#F59E0B',
})

export function useSolanaNetwork() {
  return useContext(NetworkContext)
}

function detectDefault(): SolanaNetwork {
  const envRpc = process.env.NEXT_PUBLIC_SOLANA_RPC ?? ''
  if (envRpc.includes('mainnet')) return 'mainnet'
  if (envRpc.includes('devnet') || envRpc.includes('alchemy') || envRpc.includes('helius')) return 'devnet'
  return 'devnet' // default to devnet
}

export default function SolanaWalletProvider({ children }: { children: React.ReactNode }) {
  const [network, setNetworkState] = useState<SolanaNetwork>(detectDefault)
  const config = NETWORK_CONFIG[network]

  const wallets = useMemo(() => [new PhantomWalletAdapter()], [])

  const setNetwork = useCallback((n: SolanaNetwork) => {
    setNetworkState(n)
  }, [])

  const ctx = useMemo(() => ({
    network, setNetwork, rpc: config.rpc, label: config.label, color: config.color,
  }), [network, setNetwork, config])

  return (
    <NetworkContext.Provider value={ctx}>
      <ConnectionProvider endpoint={config.rpc} key={network}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            {children}
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </NetworkContext.Provider>
  )
}
