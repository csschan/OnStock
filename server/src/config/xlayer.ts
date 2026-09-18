// X Layer Testnet deployment config
// Deployed contracts from xlayer-contracts/deployment-xlayerTestnet.json

export const XLAYER_CONFIG = {
  chainId: 195,
  rpc: 'https://testrpc.xlayer.tech',
  explorer: 'https://www.okx.com/explorer/xlayer-test',
  gasToken: 'OKB',

  contracts: {
    usdc: '0xD4c8B27fF7Aa359fB08eF87224ad1f4c20e80c82',
    factory: '0xDD2Ce835da7E7df4067FD2223bAA501aFCA89dC4',
  },

  tokens: {
    TSLAx:  '0x6C1224ef5D09e4Abbe0fbD8430D633980E4953cf',
    NVDAx:  '0x750d8B482e2E5E60204520cE266C692d52cEE624',
    SPYx:   '0xa35bEc733819e2d3Bc79d3E46b6281eb3F80B5D3',
    AAPLx:  '0xc6fAB27302A44Bf0Ab0e945344A64d69c8B1900D',
    GOOGLx: '0x7Ace8001A1fFbA17692A68234ABEB9293bB821b5',
    METAx:  '0x9F4666ed2eA3DD644D3ED0db0c8740192Bc28006',
    COINx:  '0x6ade7bc80966ed040D1a7A8dFBCF1177649bB871',
    MSTRx:  '0x5B4D33f9981D652D07391e4c828a09d6e2a09a25',
  } as Record<string, string>,

  vaults: {
    TSLAx:  '0x5903bfd01B729d37CaA742709Ec1BA036d483931',
    NVDAx:  '0x244ECAc0d3458866d07B1E9e842F2b7dF00520AA',
    SPYx:   '0x339B7dC6A641A1F8393724528B56ea50E1d149e4',
    AAPLx:  '0xF2dB6823ae8cc56fa9eDf5D306960147CeB3e1ac',
    GOOGLx: '0x5C1e6aC2cB991d2292d9ee01C0D3076aC99267cD',
    METAx:  '0xc0d75D94173bbfD8fe57eBF90011547bE815923D',
    COINx:  '0x1CF4212B49E4C966df7A0215d9d5c95086191BEF',
    MSTRx:  '0x8841c470dD56d63D8e37868536fF42ACb4663584',
  } as Record<string, string>,

  // Target APY per asset (basis points)
  apyBps: {
    TSLAx: 420, NVDAx: 420, SPYx: 380, AAPLx: 420,
    GOOGLx: 420, METAx: 420, COINx: 550, MSTRx: 550,
  } as Record<string, number>,
}

// ─── Mock Aave on X Layer Testnet ────────────────────────────────────────────

export const XLAYER_AAVE = {
  pool: '0x753CD589Bf89B1F0086A026261241e51F6202355',

  aTokens: {
    TSLAx:  '0xd26EDB8c686708C903D5448b4e9Bd9Dd72b24344',
    NVDAx:  '0xf2845F9a9f379c81A639e81166a6b5d22e8e2cd1',
    SPYx:   '0x8dD2a3FE0Bef660F55c737d909175C1b4a667DC1',
    AAPLx:  '0x8E7687e9cF58f191866653fe05004FE6eFdB7a1f',
    GOOGLx: '0xBb6266feFCfb0829b72d72D9F3fB7C370284Bc99',
    METAx:  '0xF6d4a3EBC8887Dc5a02f6c97CdB6393D17856d05',
    COINx:  '0x85De614784D63577E2845714ED5f2dcf5f3225A3',
    MSTRx:  '0x85A8e1Df477A9826113D6Ed6E65164E49eC65bBF',
  } as Record<string, string>,

  // Supply APY per asset (percentage)
  supplyApy: {
    TSLAx: 3.50, NVDAx: 3.20, SPYx: 2.80, AAPLx: 3.50,
    GOOGLx: 3.20, METAx: 3.50, COINx: 4.80, MSTRx: 4.50,
  } as Record<string, number>,
}

// Minimal ABI for interacting with deployed contracts
export const VAULT_ABI = [
  'function deposit(uint256 assets, address receiver) returns (uint256)',
  'function withdraw(uint256 assets, address receiver, address owner) returns (uint256)',
  'function redeem(uint256 shares, address receiver, address owner) returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function convertToShares(uint256 assets) view returns (uint256)',
  'function convertToAssets(uint256 shares) view returns (uint256)',
  'function getVaultInfo() view returns (uint256, uint256, uint256, uint256, uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function asset() view returns (address)',
]

export const AAVE_POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function withdraw(address asset, uint256 amount, address to) returns (uint256)',
  'function getReserveData(address asset) view returns (address, uint128, uint128, uint256, uint256)',
]

export const ERC20_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
  'function mint(address to, uint256 amount)',
  'function faucet()',
]
