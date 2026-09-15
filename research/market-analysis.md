# 链上美股代币市场分析

## 市场概况 (截至2026年8月)

### 整体数据
- 链上RWA总市值: $33.5B (2026年7月)
- 链上美股代币市值: $1.6B
- 活跃钱包数: ~185,000+
- 增长速度: 2025年6月 $2.09M → 2026年3月 $486.69M (RWA中增长最快的子品类)

### 主要发行商

| 发行商 | 市场份额 | TVL | 股票数量 | 支持链 | KYC | 费率 |
|--------|---------|-----|---------|--------|-----|------|
| **Ondo Finance** | ~70% | $3.78B | 200+ | ETH, BNB, SOL | 不需要 | ~0.1% |
| **Backed (xStocks)** | ~15% | - | 168 | 11条链 | 不需要 | ~0.2% |
| **Dinari** | ~10% | - | 724 | ETH, AVA, ARB, Base, Sei, SOL | 需要(美国) | ~0.05% |
| **Kraken xStocks** | ~5% | - | 60+ | SOL, ETH | 需要 | ~0.1% |

### 主要交易场所

**DEX:**
| DEX | 链 | 代币类型 |
|-----|-----|---------|
| Uniswap V3 | Ethereum, Base | Ondo (NVDAon, TSLAon等) |
| PancakeSwap | BNB Chain | Ondo |
| Raydium | Solana | Backed (NVDAx, TSLAx, SPYx等) |
| Jupiter | Solana | 聚合多个DEX |

**CEX:**
| CEX | 特点 |
|-----|------|
| Kraken | 60+只, 可提币到链上 |
| Binance | 通过Ondo合作, bStocks |
| Coinbase | 8000+只(计划中), 非美用户 |

### 基础设施

**Oracle:**
- Chainlink: 亚秒级价格喂送, 支持SPYon/QQQon/TSLAon/NVDAon等
- 24/5更新(跟随美股交易时间), 含盘前盘后

**跨链:**
- Ondo Bridge (LayerZero): ETH ↔ BNB
- 各链标准桥

### 热门代币
1. TSLA (TSLAx) - 最大, $86M市值, 20K持有者
2. NVDA (NVDAx/NVDAon) - 第二大
3. SPY (SPYx) - $33.6M市值
4. AAPL, MSFT, GOOG 等

---

## 竞争分析

### 现有聚合/交易工具

| 工具 | 做了什么 | 没做什么 |
|------|---------|---------|
| **1inch** | 接入Ondo做swap路由, 累计$25亿交易量 | 只接了Ondo一家, 没有跨发行商比价 |
| **Bitget Wallet** | DEX聚合器支持RWA市价单 | 只是交易执行, 无比价UI |
| **Jupiter** | Solana上的聚合器, 可swap美股代币 | 仅限Solana, 无跨链比价 |

### 市场空白
✅ **没有专门的跨发行商美股代币比价聚合器**
✅ 没有统一的买入+卖出比价工具
✅ 没有跨链美股持仓管理工具
✅ 没有美股代币套利监控工具

---

## 关键趋势

1. **SEC放开监管** - 2026年SEC对DeFi平台的代币化股票持开放态度
2. **传统券商入场** - Coinbase、Schwab等开始支持碎片化股票
3. **24/7交易需求** - Ondo已实现24/7铸造赎回
4. **DeFi整合加深** - 美股代币作为抵押品借贷(Euler已支持)
5. **多链部署加速** - Ondo扩展到Hyperliquid, Backed扩展到TON

---

## 数据来源
- [CoinGecko RWA Report 2026](https://www.coingecko.com/research/publications/rwa-report-2026)
- [Ondo Finance Docs](https://docs.ondo.finance)
- [xStocks Docs](https://docs.xstocks.fi)
- [Chainlink Tokenized Equity Feeds](https://docs.chain.link/data-feeds/tokenized-equity-feeds)
- [RWA.xyz Tokenized Stocks](https://app.rwa.xyz/stocks)
- [DefiLlama](https://defillama.com)
