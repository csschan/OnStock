// 所有 tokenized stock 官方合约地址
// 来源：
//   Ondo: github.com/ondoprotocol/ondo-global-markets-token-list (tokenlist.json v11.0.0)
//   Backed/xStocks: github.com/backed-fi/cowswap-xstocks-tokenlist
//   Dinari: app.dinari.com embedded JSON

export interface TokenConfig {
  ticker: string
  issuer: string
  chain: string
  chainId: number       // EVM chain ID（Solana 用 0）
  tokenSymbol: string
  contractAddress: string
  decimals: number
}

export const TOKENS: TokenConfig[] = [

  // ─── Ondo Finance — ETH ───
  { ticker: 'AAPL',  issuer: 'ondo', chain: 'ethereum', chainId: 1,  tokenSymbol: 'AAPLon',  contractAddress: '0x14c3abF95Cb9C93a8b82C1CdCB76D72Cb87b2d4c', decimals: 18 },
  { ticker: 'TSLA',  issuer: 'ondo', chain: 'ethereum', chainId: 1,  tokenSymbol: 'TSLAon',  contractAddress: '0xf6b1117ec07684D3958caD8BEb1b302bfD21103f', decimals: 18 },
  { ticker: 'NVDA',  issuer: 'ondo', chain: 'ethereum', chainId: 1,  tokenSymbol: 'NVDAon',  contractAddress: '0x2D1F7226Bd1F780AF6B9A49DCC0aE00E8Df4bDEE', decimals: 18 },
  { ticker: 'MSFT',  issuer: 'ondo', chain: 'ethereum', chainId: 1,  tokenSymbol: 'MSFTon',  contractAddress: '0xB812837b81a3a6b81d7CD74CfB19A7f2784555E5', decimals: 18 },
  { ticker: 'AMZN',  issuer: 'ondo', chain: 'ethereum', chainId: 1,  tokenSymbol: 'AMZNon',  contractAddress: '0xbb8774FB97436d23d74C1b882E8E9A69322cFD31', decimals: 18 },
  { ticker: 'GOOGL', issuer: 'ondo', chain: 'ethereum', chainId: 1,  tokenSymbol: 'GOOGLon', contractAddress: '0xbA47214eDd2bb43099611b208f75E4b42FDcfEDc', decimals: 18 },
  { ticker: 'META',  issuer: 'ondo', chain: 'ethereum', chainId: 1,  tokenSymbol: 'METAon',  contractAddress: '0x59644165402b611b350645555B50Afb581C71EB2', decimals: 18 },
  { ticker: 'AMD',   issuer: 'ondo', chain: 'ethereum', chainId: 1,  tokenSymbol: 'AMDon',   contractAddress: '0x0C1f3412A44Ff99E40bF14e06e5Ea321aE7B3938', decimals: 18 },
  { ticker: 'SPY',   issuer: 'ondo', chain: 'ethereum', chainId: 1,  tokenSymbol: 'SPYon',   contractAddress: '0xFeDC5f4a6c38211c1338aa411018DFAf26612c08', decimals: 18 },
  { ticker: 'QQQ',   issuer: 'ondo', chain: 'ethereum', chainId: 1,  tokenSymbol: 'QQQon',   contractAddress: '0x0e397938C1Aa0680954093495B70A9F5e2249aBa', decimals: 18 },
  { ticker: 'COIN',  issuer: 'ondo', chain: 'ethereum', chainId: 1,  tokenSymbol: 'COINon',  contractAddress: '0xF042cfa86cf1D598a75Bdb55c3507a1F39f9493b', decimals: 18 },

  // ─── Ondo Finance — BNB Chain ───
  { ticker: 'AAPL',  issuer: 'ondo', chain: 'bnb', chainId: 56, tokenSymbol: 'AAPLon',  contractAddress: '0x390a684EF9cADE28A7AD0DFa61AB1Eb3842618c4', decimals: 18 },
  { ticker: 'TSLA',  issuer: 'ondo', chain: 'bnb', chainId: 56, tokenSymbol: 'TSLAon',  contractAddress: '0x2494b603319d4D9F9715c9f4496d9E0364B59d93', decimals: 18 },
  { ticker: 'NVDA',  issuer: 'ondo', chain: 'bnb', chainId: 56, tokenSymbol: 'NVDAon',  contractAddress: '0xA9eE28C80f960B889dFbd1902055218cBa016F75', decimals: 18 },
  { ticker: 'MSFT',  issuer: 'ondo', chain: 'bnb', chainId: 56, tokenSymbol: 'MSFTon',  contractAddress: '0x6Bfe75D1ad432050eA973C3A3DcD88F02e2444C3', decimals: 18 },
  { ticker: 'AMZN',  issuer: 'ondo', chain: 'bnb', chainId: 56, tokenSymbol: 'AMZNon',  contractAddress: '0x4553cFe1C09f37f38b12dC509F676964e392F8Fc', decimals: 18 },
  { ticker: 'GOOGL', issuer: 'ondo', chain: 'bnb', chainId: 56, tokenSymbol: 'GOOGLon', contractAddress: '0x091FC7778e6932d4009B087B191D1EE3bac5729A', decimals: 18 },
  { ticker: 'META',  issuer: 'ondo', chain: 'bnb', chainId: 56, tokenSymbol: 'METAon',  contractAddress: '0xD7dF5863A3e742F0c767768cDfcb63f09E0422f6', decimals: 18 },
  { ticker: 'AMD',   issuer: 'ondo', chain: 'bnb', chainId: 56, tokenSymbol: 'AMDon',   contractAddress: '0x9f16E46c73b43BDB70861247d537bEE4eA18F639', decimals: 18 },
  { ticker: 'SPY',   issuer: 'ondo', chain: 'bnb', chainId: 56, tokenSymbol: 'SPYon',   contractAddress: '0x6a708EAD771238919D85930b5a0f10454E1C331a', decimals: 18 },
  { ticker: 'QQQ',   issuer: 'ondo', chain: 'bnb', chainId: 56, tokenSymbol: 'QQQon',   contractAddress: '0x0cdE6936d305d5B34667fC46425E852efd73559a', decimals: 18 },
  { ticker: 'COIN',  issuer: 'ondo', chain: 'bnb', chainId: 56, tokenSymbol: 'COINon',  contractAddress: '0xf8589b526FdD65F7F301c605a6e04F0F1b4B3620', decimals: 18 },

  // ─── Backed Finance (xStocks) — Ethereum ───
  { ticker: 'AAPL',  issuer: 'backed', chain: 'ethereum', chainId: 1, tokenSymbol: 'AAPLx',  contractAddress: '0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a', decimals: 18 },
  { ticker: 'TSLA',  issuer: 'backed', chain: 'ethereum', chainId: 1, tokenSymbol: 'TSLAx',  contractAddress: '0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0', decimals: 18 },
  { ticker: 'NVDA',  issuer: 'backed', chain: 'ethereum', chainId: 1, tokenSymbol: 'NVDAx',  contractAddress: '0xc845b2894dbddd03858fd2d643b4ef725fe0849d', decimals: 18 },
  { ticker: 'MSFT',  issuer: 'backed', chain: 'ethereum', chainId: 1, tokenSymbol: 'MSFTx',  contractAddress: '0x5621737f42dae558b81269fcb9e9e70c19aa6b35', decimals: 18 },
  { ticker: 'AMZN',  issuer: 'backed', chain: 'ethereum', chainId: 1, tokenSymbol: 'AMZNx',  contractAddress: '0x3557ba345b01efa20a1bddc61f573bfd87195081', decimals: 18 },
  { ticker: 'GOOGL', issuer: 'backed', chain: 'ethereum', chainId: 1, tokenSymbol: 'GOOGLx', contractAddress: '0xe92f673ca36c5e2efd2de7628f815f84807e803f', decimals: 18 },
  { ticker: 'META',  issuer: 'backed', chain: 'ethereum', chainId: 1, tokenSymbol: 'METAx',  contractAddress: '0x96702be57cd9777f835117a809c7124fe4ec989a', decimals: 18 },
  { ticker: 'SPY',   issuer: 'backed', chain: 'ethereum', chainId: 1, tokenSymbol: 'SPYx',   contractAddress: '0x90a2a4c76b5d8c0bc892a69ea28aa775a8f2dd48', decimals: 18 },
  { ticker: 'QQQ',   issuer: 'backed', chain: 'ethereum', chainId: 1, tokenSymbol: 'QQQx',   contractAddress: '0xa753a7395cae905cd615da0b82a53e0560f250af', decimals: 18 },
  { ticker: 'COIN',  issuer: 'backed', chain: 'ethereum', chainId: 1, tokenSymbol: 'COINx',  contractAddress: '0x364f210f430ec2448fc68a49203040f6124096f0', decimals: 18 },
  { ticker: 'AMD',   issuer: 'backed', chain: 'ethereum', chainId: 1, tokenSymbol: 'AMDx',   contractAddress: '0x3522513e5f146a2006e2901b05f16b2821485e19', decimals: 18 },

  // ─── Backed Finance (xStocks) — BNB Chain ───
  { ticker: 'AAPL',  issuer: 'backed', chain: 'bnb', chainId: 56, tokenSymbol: 'AAPLx',  contractAddress: '0x9d275685dc284c8eb1c79f6aba7a63dc75ec890a', decimals: 18 },
  { ticker: 'TSLA',  issuer: 'backed', chain: 'bnb', chainId: 56, tokenSymbol: 'TSLAx',  contractAddress: '0x8ad3c73f833d3f9a523ab01476625f269aeb7cf0', decimals: 18 },
  { ticker: 'NVDA',  issuer: 'backed', chain: 'bnb', chainId: 56, tokenSymbol: 'NVDAx',  contractAddress: '0xc845b2894dbddd03858fd2d643b4ef725fe0849d', decimals: 18 },

  // ─── Backed Finance (xStocks) — Solana ───
  { ticker: 'AAPL',  issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'AAPLx',  contractAddress: 'XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp', decimals: 6 },
  { ticker: 'TSLA',  issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'TSLAx',  contractAddress: 'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB', decimals: 6 },
  { ticker: 'NVDA',  issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'NVDAx',  contractAddress: 'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh', decimals: 6 },
  { ticker: 'MSFT',  issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'MSFTx',  contractAddress: 'XspzcW1PRtgf6Wj92HCiZdjzKCyFekVD8P5Ueh3dRMX', decimals: 6 },
  { ticker: 'META',  issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'METAx',  contractAddress: 'Xsa62P5mvPszXL1krVUnU5ar38bBSVcWAB6fmPCo5Zu', decimals: 6 },
  { ticker: 'AMZN',  issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'AMZNx',  contractAddress: 'Xs3eBt7uRfJX8QUs4suhyU8p2M6DoUDrJyWBa8LLZsg', decimals: 6 },
  { ticker: 'COIN',  issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'COINx',  contractAddress: 'Xs7ZdzSHLU9ftNJsii5fCeJhoRWSC32SQGzGQtePxNu', decimals: 6 },
  { ticker: 'GOOGL', issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'GOOGLx', contractAddress: 'XsCPL9dNWBMvFtTmwcCA5v3xWPSMEBCszbQdiLLq6aN', decimals: 6 },
  { ticker: 'SPY',   issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'SPYx',   contractAddress: 'XsoCS1TfEyfFhfvj8EtZ528L3CaKBDBRqRapnBbDF2W', decimals: 6 },
  { ticker: 'QQQ',   issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'QQQx',   contractAddress: 'Xs8S1uUs1zvS2p7iwtsG3b6fkhpvmwz4GYU3gWAmWHZ', decimals: 6 },
  { ticker: 'MSTR',  issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'MSTRx',  contractAddress: 'XsP7xzNPvEHS1m6qfanPUGjNmdnmsLKEoNAnHjdxxyZ', decimals: 6 },
  { ticker: 'CRCL',  issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'CRCLx',  contractAddress: 'XsueG8BtpquVJX9LVLLEGuViXUungE6WmK5YZ3p3bd1', decimals: 6 },
  { ticker: 'PLTR',  issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'PLTRx',  contractAddress: 'XsoBhf2ufR8fTyNSjqfU71DYGaE6Z3SUGAidpzriAA4', decimals: 6 },
  { ticker: 'INTC',  issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'INTCx',  contractAddress: 'XshPgPdXFRWB8tP1j82rebb2Q9rPgGX37RuqzohmArM', decimals: 6 },
  { ticker: 'AMD',   issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'AMDx',   contractAddress: 'XsXcJ6GZ9kVnjqGsjBnktRcuwMBmvKWh8S93RefZ1rF', decimals: 6 },
  { ticker: 'NFLX',  issuer: 'backed', chain: 'solana', chainId: 0, tokenSymbol: 'NFLXx',  contractAddress: 'XsEH7wWfJJu2ZT3UCFeVfALnVA6CP5ur7Ee11KmzVpL', decimals: 6 },

  // ─── Dinari — Ethereum ───
  { ticker: 'AAPL',  issuer: 'dinari', chain: 'ethereum', chainId: 1, tokenSymbol: 'dAAPL',  contractAddress: '0x68E670D2f9B792f034a1826cF4A8F180C9952Cb6', decimals: 18 },
  { ticker: 'TSLA',  issuer: 'dinari', chain: 'ethereum', chainId: 1, tokenSymbol: 'dTSLA',  contractAddress: '0xEa142f62ed971651691c6E22c6b78eC488c61F9D', decimals: 18 },
  { ticker: 'NVDA',  issuer: 'dinari', chain: 'ethereum', chainId: 1, tokenSymbol: 'dNVDA',  contractAddress: '0x62Ec03C917FaCE0E6841AFdAfC166bF571E55E4F', decimals: 18 },
  { ticker: 'MSFT',  issuer: 'dinari', chain: 'ethereum', chainId: 1, tokenSymbol: 'dMSFT',  contractAddress: '0x69bb721889FA2714aB0fd769e9c5D5BA3ecA0494', decimals: 18 },
  { ticker: 'AMZN',  issuer: 'dinari', chain: 'ethereum', chainId: 1, tokenSymbol: 'dAMZN',  contractAddress: '0x149Ae2607D2d3C79bf053D720CacCF831d48D55F', decimals: 18 },
  { ticker: 'GOOGL', issuer: 'dinari', chain: 'ethereum', chainId: 1, tokenSymbol: 'dGOOGL', contractAddress: '0x12dd3F826Cf73e30203476B2988bCaefcC3AC68c', decimals: 18 },
  { ticker: 'META',  issuer: 'dinari', chain: 'ethereum', chainId: 1, tokenSymbol: 'dMETA',  contractAddress: '0x0bbeB8decEEccb8Ba651bC08e0482b006b8A4459', decimals: 18 },
  { ticker: 'SPY',   issuer: 'dinari', chain: 'ethereum', chainId: 1, tokenSymbol: 'dSPY',   contractAddress: '0xC45fB996F73f23F61d08b5B3618Ef3CaB53D6DCA', decimals: 18 },
  { ticker: 'COIN',  issuer: 'dinari', chain: 'ethereum', chainId: 1, tokenSymbol: 'dCOIN',  contractAddress: '0xd71B200bF061509B85dF50Cc0D8CDee8818A4577', decimals: 18 },

  // ─── Dinari — Arbitrum ───
  { ticker: 'AAPL',  issuer: 'dinari', chain: 'arbitrum', chainId: 42161, tokenSymbol: 'dAAPL',  contractAddress: '0xCe38e140fC3982a6bCEbc37b040913EF2Cd6C5a7', decimals: 18 },
  { ticker: 'TSLA',  issuer: 'dinari', chain: 'arbitrum', chainId: 42161, tokenSymbol: 'dTSLA',  contractAddress: '0x36d37B6cbCA364Cf1D843efF8C2f6824491bcF81', decimals: 18 },
  { ticker: 'NVDA',  issuer: 'dinari', chain: 'arbitrum', chainId: 42161, tokenSymbol: 'dNVDA',  contractAddress: '0x4DaFFfDDEa93DdF1e0e7B61E844331455053Ce5c', decimals: 18 },
  { ticker: 'MSFT',  issuer: 'dinari', chain: 'arbitrum', chainId: 42161, tokenSymbol: 'dMSFT',  contractAddress: '0x77308F8B63A99b24b262D930E0218ED2f49F8475', decimals: 18 },
  { ticker: 'AMZN',  issuer: 'dinari', chain: 'arbitrum', chainId: 42161, tokenSymbol: 'dAMZN',  contractAddress: '0x8240aFFe697CdE618AD05c3c8963f5Bfe152650b', decimals: 18 },
  { ticker: 'GOOGL', issuer: 'dinari', chain: 'arbitrum', chainId: 42161, tokenSymbol: 'dGOOGL', contractAddress: '0x8E50D11a54CFF859b202b7Fe5225353bE0646410', decimals: 18 },
  { ticker: 'META',  issuer: 'dinari', chain: 'arbitrum', chainId: 42161, tokenSymbol: 'dMETA',  contractAddress: '0x519062155B0591627C8A0C0958110A8C5639DcA6', decimals: 18 },
  { ticker: 'SPY',   issuer: 'dinari', chain: 'arbitrum', chainId: 42161, tokenSymbol: 'dSPY',   contractAddress: '0xF4BD09B048248876E39Fcf2e0CDF1aee1240a9D2', decimals: 18 },
  { ticker: 'COIN',  issuer: 'dinari', chain: 'arbitrum', chainId: 42161, tokenSymbol: 'dCOIN',  contractAddress: '0x46b979440AC257151EE5a5bC9597B76386907FA1', decimals: 18 },

  // ─── Dinari — Base ───
  { ticker: 'AAPL',  issuer: 'dinari', chain: 'base', chainId: 8453, tokenSymbol: 'dAAPL',  contractAddress: '0x41F7A63713e76c0aB800Be03Bae9F17B8A356348', decimals: 18 },
  { ticker: 'TSLA',  issuer: 'dinari', chain: 'base', chainId: 8453, tokenSymbol: 'dTSLA',  contractAddress: '0x74Ed07d83999bC5DB0ffd850da0a6Bd782AbD39c', decimals: 18 },
  { ticker: 'NVDA',  issuer: 'dinari', chain: 'base', chainId: 8453, tokenSymbol: 'dNVDA',  contractAddress: '0x92ECF64fDb76E60b76d78A29Ad4BF9D38B7b1b97', decimals: 18 },
  { ticker: 'MSFT',  issuer: 'dinari', chain: 'base', chainId: 8453, tokenSymbol: 'dMSFT',  contractAddress: '0xF9011e88d8f1B5BB9B1f0b3BD604D250cf114afB', decimals: 18 },
  { ticker: 'AMZN',  issuer: 'dinari', chain: 'base', chainId: 8453, tokenSymbol: 'dAMZN',  contractAddress: '0xf393d07e6ca9818A601055b4bb3c48A5bb98E701', decimals: 18 },
  { ticker: 'META',  issuer: 'dinari', chain: 'base', chainId: 8453, tokenSymbol: 'dMETA',  contractAddress: '0xf6e697F80a2c0C77e9C896a23542EFAb2F0d16DF', decimals: 18 },
  { ticker: 'SPY',   issuer: 'dinari', chain: 'base', chainId: 8453, tokenSymbol: 'dSPY',   contractAddress: '0x8A768Ef1d44939E2C6e36b83A948295962D6f795', decimals: 18 },
  { ticker: 'COIN',  issuer: 'dinari', chain: 'base', chainId: 8453, tokenSymbol: 'dCOIN',  contractAddress: '0xA559c1A28874Bea40056E61cfee29b051B7D8C9d', decimals: 18 },

  // ─── Binance bStocks — BNB Chain ───
  // 来源: BscScan + CoinGecko (2026-08), BEP-8056 代币
  { ticker: 'AAPL',  issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'AAPLB',  contractAddress: '0x431a3bee82e2ca41e49895cbece5bb0f76a89b7a', decimals: 18 },
  { ticker: 'TSLA',  issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'TSLAB',  contractAddress: '0x5b1910eaad6450e50f816082aa078c41f10c292f', decimals: 18 },
  { ticker: 'NVDA',  issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'NVDAB',  contractAddress: '0x02fca66c1d1afb4e2a7884261eb00f63598a7436', decimals: 18 },
  { ticker: 'MSFT',  issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'MSFTB',  contractAddress: '0x80106cb3ead06659a5ad19df39d9b4733863b9b0', decimals: 18 },
  { ticker: 'AMZN',  issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'AMZNB',  contractAddress: '0x1a4b499833a79a09ad7cf1d42d7dacf71e92eb00', decimals: 18 },
  { ticker: 'GOOGL', issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'GOOGLB', contractAddress: '0x3f53de71c126bdabae20f9cd64848d317f6c3238', decimals: 18 },
  { ticker: 'META',  issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'METAB',  contractAddress: '0x7425889fe94f9d693e8daefe88bcced6acfef4c0', decimals: 18 },
  { ticker: 'AMD',   issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'AMDB',   contractAddress: '0x75fd4cf6f8392e41e70391d60c90c0d5211603a1', decimals: 18 },
  { ticker: 'SPY',   issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'SPYB',   contractAddress: '0x7138b48df7d98d7e3cc221bfe7192d0a178182d8', decimals: 18 },
  { ticker: 'QQQ',   issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'QQQB',   contractAddress: '0x205812cdbed920aff76c6580abd681a46d11efc7', decimals: 18 },
  { ticker: 'COIN',  issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'COINB',  contractAddress: '0x585bde7c54abb5ccd7791f923d6c2187635f3952', decimals: 18 },
  { ticker: 'NFLX',  issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'NFLXB',  contractAddress: '0xd6829ea836b6fa224d099d40e54b31262f874631', decimals: 18 },
  { ticker: 'PLTR',  issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'PLTRB',  contractAddress: '0x0ca5d51d0277bd006fd9607d3e560785ebad8222', decimals: 18 },
  // Binance 独有代币
  { ticker: 'SNDK',  issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'SNDKB',  contractAddress: '0x3ee4df61bd4f867e349beae8bfe07bc31b4850fb', decimals: 18 },
  { ticker: 'INTC',  issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'INTCB',  contractAddress: '0xe614e2fc6c787035ff51f452e8e826bfd32d5283', decimals: 18 },
  { ticker: 'MU',    issuer: 'binance', chain: 'bnb', chainId: 56, tokenSymbol: 'MUB',    contractAddress: '0xcdf2f3e0fa43c47a6662a91c9e4a7c5f69762699', decimals: 18 },

  // ─── Robinhood Chain (chainId: 4663) ───
  // 来源: https://api.robinhood.com/rhj/assets (2026-08)
  // 价格通过 /rhj/prices/{symbol} REST API 获取，无需 KyberSwap
  { ticker: 'AAPL',  issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'AAPL',  contractAddress: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', decimals: 18 },
  { ticker: 'TSLA',  issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'TSLA',  contractAddress: '0x322F0929c4625eD5bAd873c95208D54E1c003b2d', decimals: 18 },
  { ticker: 'NVDA',  issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'NVDA',  contractAddress: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', decimals: 18 },
  { ticker: 'MSFT',  issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'MSFT',  contractAddress: '0xe93237C50D904957Cf27E7B1133b510C669c2e74', decimals: 18 },
  { ticker: 'GOOGL', issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'GOOGL', contractAddress: '0x2e0847E8910a9732eB3fb1bb4b70a580ADAD4FE3', decimals: 18 },
  { ticker: 'AMZN',  issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'AMZN',  contractAddress: '0x12f190a9F9d7D37a250758b26824B97CE941bF54', decimals: 18 },
  { ticker: 'META',  issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'META',  contractAddress: '0xc0D6457C16Cc70d6790Dd43521C899C87ce02f35', decimals: 18 },
  { ticker: 'AMD',   issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'AMD',   contractAddress: '0x86923f96303D656E4aa86D9d42D1e57ad2023fdC', decimals: 18 },
  { ticker: 'SPY',   issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'SPY',   contractAddress: '0x117cc2133c37B721F49dE2A7a74833232B3B4C0C', decimals: 18 },
  { ticker: 'QQQ',   issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'QQQ',   contractAddress: '0xD5f3879160bc7c32ebb4dC785F8a4F505888de68', decimals: 18 },
  { ticker: 'COIN',  issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'COIN',  contractAddress: '0x6330D8C3178a418788dF01a47479c0ce7CCF450b', decimals: 18 },
  // Robinhood 独家代币（其他 issuer 没有）
  { ticker: 'SPCX',  issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'SPCX',  contractAddress: '0x4a0E65A3EcceC6dBe60AE065F2e7bb85Fae35eEa', decimals: 18 },
  { ticker: 'MSTR',  issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'MSTR',  contractAddress: '0xec262a75e413fAfD0dF80480274532C79D42da09', decimals: 18 },
  { ticker: 'PLTR',  issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'PLTR',  contractAddress: '0x894E1EC2D74FFE5AEF8Dc8A9e84686acCB964F2A', decimals: 18 },
  { ticker: 'NFLX',  issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'NFLX',  contractAddress: '0xE0444EF8BF4eD74f74FD73686e2ddF4C1c5591E8', decimals: 18 },
  { ticker: 'CRWV',  issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'CRWV',  contractAddress: '0x5f10A1C971B69e47e059e1dC91901B59b3fB49C3', decimals: 18 },
  { ticker: 'CRCL',  issuer: 'robinhood', chain: 'robinhood-chain', chainId: 4663, tokenSymbol: 'CRCL',  contractAddress: '0xdF0992E440dD0be65BD8439b609d6D4366bf1CB5', decimals: 18 },
]
