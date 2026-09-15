# 数据源接入手册

## 一、发行商API

### 1. Ondo Finance
- **文档**: https://docs.ondo.finance/api-reference/overview
- **OpenAPI规范**: https://docs.ondo.finance/openapi.json
- **接入方式**:
  - REST API: 价格查询、铸造/赎回报价、代币元数据
  - gRPC: 实时价格推送(低延迟)
- **SDK**: Python / JavaScript / Rust
- **认证**: 需要联系 onboarding@ondo.finance 获取API访问
- **代币命名规则**: {TICKER}on (NVDAon, TSLAon, SPYon, QQQon, GOOGLon, HOODon)
- **支持链**: Ethereum, BNB Chain, Solana
- **铸造/赎回**:
  - 24/7即时铸造赎回(SPYon, QQQon, NVDAon, TSLAon, GOOGLon, CRCLon)
  - 结算资产: USDC
  - 流程: 请求attestation → 广播交易 → 原子化铸造/赎回

```javascript
// Ondo SDK 示例
import { OndoClient } from "@ondo/sdk";

const client = new OndoClient({ apiKey: "..." });

// 获取铸造报价
const mintQuote = await client.getMintQuote({
  token: "NVDAon",
  amount: "100",      // USDC
  chain: "ethereum"
});

// 获取赎回报价
const redeemQuote = await client.getRedeemQuote({
  token: "NVDAon",
  amount: "0.74",     // NVDAon数量
  chain: "ethereum"
});

// gRPC实时价格流
const stream = client.streamPrices(["NVDAon", "TSLAon", "SPYon"]);
stream.on("data", (price) => {
  console.log(price.token, price.price, price.timestamp);
});
```

---

### 2. Backed Finance (xStocks)
- **文档**: https://docs.xstocks.fi/apis/openapi
- **快速入门**: https://docs.xstocks.fi/developers/quickstart
- **接入方式**: REST API (公开免费, **无需认证**)
- **公开端点**:

```bash
# 获取所有资产列表(含价格、合约地址、支持链)
curl -X GET https://api.xstocks.fi/api/v2/public/assets

# 响应包含:
# - 168个产品
# - 每个产品的ISIN编号
# - 各链合约地址
# - 当前价格
# - rebasing倍数历史
```

- **代币命名规则**: {TICKER}x (NVDAx, TSLAx, SPYx)
- **支持链**: Ethereum, Solana, Arbitrum, Mantle, TON, Ink 等11条链
- **代币标准**:
  - EVM链: ERC-20 + rebasing逻辑
  - Solana: SPL Token-2022 + Scaled UI扩展
  - TON: Jetton + multiplier元数据
- **额外数据**: Chainlink Proof of Reserve (1:1储备证明)
- **GitHub**: https://github.com/backed-fi

```javascript
// Backed API 示例 (无需认证)
const response = await fetch("https://api.xstocks.fi/api/v2/public/assets");
const assets = await response.json();

// 查找NVDA
const nvda = assets.find(a => a.underlying === "NVDA");
console.log(nvda.price);           // 当前价格
console.log(nvda.contracts);       // 各链合约地址
console.log(nvda.multiplier);      // rebasing倍数
```

---

### 3. Dinari
- **官网**: https://dinari.com
- **接入方式**: REST API
- **产品**: 724只代币化美股 (含完整S&P 500)
- **代币命名规则**: d{TICKER} (dNVDA, dTSLA)
- **代币标准**: ERC-20, 每个代币1:1对应一股
- **支持链**: Ethereum, Avalanche, Arbitrum, Base, Sei, Solana (即将)
- **结算资产**: USDC (Circle合作)
- **KYC**: 美国用户需要 (Reg D 506(c))
- **B2B API**: 券商可授权使用Dinari API为自己的客户提供代币化股票

```javascript
// Dinari API 示例 (具体端点待确认)
const response = await fetch("https://api.dinari.com/v1/assets/NVDA");
const nvdaData = await response.json();
```

---

## 二、链上数据 (Chainlink Oracle)

### Chainlink Price Feeds - 代币化股票专属
- **文档**: https://docs.chain.link/data-feeds/tokenized-equity-feeds
- **Ondo专属Feed**: https://docs.chain.link/data-feeds/tokenized-equity-feeds/ondo
- **Robinhood专属Feed**: https://docs.chain.link/data-feeds/tokenized-equity-feeds/robinhood

**支持资产**: SPYon, QQQon, TSLAon, NVDAon, HOODon, GOOGLon

**更新频率**:
- Data Streams: 亚秒级 (sub-second), 接近实时
- Price Feeds: 心跳机制 + 价格偏差触发更新
- 覆盖时段: 24/5 (常规+盘前+盘后+隔夜), 休市时保持最后价格

```javascript
// 读取Chainlink价格
import { Contract } from "ethers";

const NVDA_FEED = "0x..."; // Chainlink NVDAon/USD Feed地址
const ABI = [
  "function latestRoundData() view returns (uint80, int256, uint256, uint256, uint80)",
  "function decimals() view returns (uint8)"
];

const priceFeed = new Contract(NVDA_FEED, ABI, provider);
const [roundId, price, startedAt, updatedAt, answeredInRound] = 
  await priceFeed.latestRoundData();
const decimals = await priceFeed.decimals();

const priceUSD = Number(price) / 10 ** decimals;
console.log(`NVDA: $${priceUSD}`);
console.log(`Last updated: ${new Date(Number(updatedAt) * 1000)}`);
```

**注意事项**:
- 美股休市期间(周末/假日), Feed保持最后价格不更新
- 需要检查 `updatedAt` 判断价格是否过期
- Feed地址需要从Chainlink文档获取最新的

---

## 三、DEX链上价格

### Uniswap V3 (Ethereum / Base)

```javascript
import { Contract, parseUnits } from "ethers";

// Uniswap V3 Quoter合约
const QUOTER_ADDRESS = "0xb27308f9F90D607463bb33eA1BeBb41C27CE5AB6";
const QUOTER_ABI = [
  "function quoteExactInputSingle(address tokenIn, address tokenOut, uint24 fee, uint256 amountIn, uint160 sqrtPriceLimitX96) view returns (uint256 amountOut)"
];

const quoter = new Contract(QUOTER_ADDRESS, QUOTER_ABI, provider);

// 买入: 100 USDC → NVDAon
const buyQuote = await quoter.quoteExactInputSingle(
  USDC_ADDRESS,
  NVDAon_ADDRESS,
  3000,                          // 0.3% fee tier
  parseUnits("100", 6),          // 100 USDC
  0
);

// 卖出: 1 NVDAon → USDC
const sellQuote = await quoter.quoteExactInputSingle(
  NVDAon_ADDRESS,
  USDC_ADDRESS,
  3000,
  parseUnits("1", 18),           // 1 NVDAon
  0
);
```

### Uniswap V3 SwapRouter (执行交易)

```javascript
const ROUTER_ADDRESS = "0xE592427A0AEce92De3Edee1F18E0157C05861564";
const ROUTER_ABI = [
  "function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) payable returns (uint256 amountOut)"
];

const router = new Contract(ROUTER_ADDRESS, ROUTER_ABI, signer);

// 买入交易
const buyTx = await router.exactInputSingle({
  tokenIn: USDC_ADDRESS,
  tokenOut: NVDAon_ADDRESS,
  fee: 3000,
  recipient: walletAddress,
  deadline: Math.floor(Date.now() / 1000) + 600,  // 10分钟
  amountIn: parseUnits("100", 6),
  amountOutMinimum: minAmountOut,  // 滑点保护
  sqrtPriceLimitX96: 0
});

// 卖出交易
const sellTx = await router.exactInputSingle({
  tokenIn: NVDAon_ADDRESS,
  tokenOut: USDC_ADDRESS,
  fee: 3000,
  recipient: walletAddress,
  deadline: Math.floor(Date.now() / 1000) + 600,
  amountIn: parseUnits("1", 18),
  amountOutMinimum: minUSDCOut,    // 滑点保护
  sqrtPriceLimitX96: 0
});
```

### Jupiter (Solana)

```javascript
// Jupiter API - 获取报价
async function getJupiterQuote(inputMint, outputMint, amount) {
  const response = await fetch(
    `https://quote-api.jup.ag/v6/quote?` +
    `inputMint=${inputMint}` +
    `&outputMint=${outputMint}` +
    `&amount=${amount}` +
    `&slippageBps=50`
  );
  return response.json();
}

// 买入: USDC → NVDAx
const buyQuote = await getJupiterQuote(
  USDC_MINT,      // USDC Solana地址
  NVDAx_MINT,     // NVDAx Solana地址
  100_000_000     // 100 USDC (6 decimals)
);

// 卖出: NVDAx → USDC
const sellQuote = await getJupiterQuote(
  NVDAx_MINT,
  USDC_MINT,
  1_000_000_000   // 1 NVDAx (具体decimals需确认)
);

// 构建交易
async function buildJupiterSwap(quoteResponse, userPublicKey) {
  const response = await fetch('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: userPublicKey.toString(),
      wrapAndUnwrapSol: true
    })
  });
  const { swapTransaction } = await response.json();
  return swapTransaction; // base64编码的交易, 前端签名发送
}
```

### Raydium (Solana)

```javascript
// Raydium可以通过Jupiter聚合访问, 也可以直接调用
// 推荐通过Jupiter, 它会自动路由到Raydium的最优池子
```

### PancakeSwap (BNB Chain)

```javascript
// PancakeSwap V3 Quoter
const PANCAKE_QUOTER = "0xB048Bbc1Ee6b733FFfCFb9e9CeF7375518e25997";
// 接口与Uniswap V3兼容, 用法相同
```

---

## 四、CEX API

### Kraken

```javascript
// Kraken公开API - 获取美股代币价格
const response = await fetch(
  "https://api.kraken.com/0/public/Ticker?pair=NVDAUSD"
);
const data = await response.json();
const price = data.result.NVDAUSD.c[0]; // 最新成交价

// 获取订单簿
const orderbook = await fetch(
  "https://api.kraken.com/0/public/Depth?pair=NVDAUSD&count=10"
);
```

### Binance

```javascript
// Binance公开API - bStocks价格
const response = await fetch(
  "https://api.binance.com/api/v3/ticker/price?symbol=NVDAUSDT"
);
const data = await response.json();
const price = data.price;

// 获取订单簿深度
const depth = await fetch(
  "https://api.binance.com/api/v3/depth?symbol=NVDAUSDT&limit=10"
);
```

---

## 五、Gas费获取

```javascript
// Ethereum
const ethGasPrice = await ethProvider.getFeeData();
const ethGasCost = ethGasPrice.gasPrice * 180000n; // swap约180k gas

// Base
const baseGasPrice = await baseProvider.getFeeData();
const baseGasCost = baseGasPrice.gasPrice * 180000n; // 通常很低

// BNB Chain
const bnbGasPrice = await bnbProvider.getFeeData();
const bnbGasCost = bnbGasPrice.gasPrice * 180000n;

// Solana
const { value: priorityFee } = await connection.getRecentPrioritizationFees();
const solGasCost = 5000 + (priorityFee[0]?.prioritizationFee || 0); // lamports
```

---

## 六、合约地址收集

### 需要收集的信息 (每个代币)
- 代币合约地址 (每条链)
- DEX交易对地址 / Pool地址
- Chainlink Price Feed地址
- DEX Router/Quoter地址 (每条链)

### 获取方式
1. **Ondo**: 通过API获取, 或查看docs.ondo.finance
2. **Backed**: `GET https://api.xstocks.fi/api/v2/public/assets` 直接返回各链地址
3. **Dinari**: 通过API或官方文档获取
4. **Chainlink**: https://docs.chain.link/data-feeds/price-feeds/addresses
5. **DEX Pool**: 通过DexScreener或链上factory合约查询

---

## 七、数据源优先级和降级策略

```
价格获取优先级:
1. DEX实时报价 (最准确, 反映真实买入/卖出价)
2. 发行商API报价 (铸造/赎回价格)
3. CEX API报价 (参考价)
4. Chainlink Oracle (基准价, 用于计算溢价/折价)

降级策略:
- 如果DEX报价失败 → 使用发行商API价格
- 如果发行商API不可用 → 使用Chainlink基准价 + 标记"参考价"
- 如果Chainlink休市未更新 → 标记"美股休市, 价格可能不准确"
```
