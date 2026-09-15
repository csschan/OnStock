-- OnStock 数据库建表脚本
-- PostgreSQL 16+

-- =============================================
-- 核心表
-- =============================================

-- 股票基本信息
CREATE TABLE stocks (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10) NOT NULL UNIQUE,
  company_name VARCHAR(255) NOT NULL,
  sector VARCHAR(100),
  market_cap DECIMAL,
  logo_url VARCHAR(500),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 发行商/渠道信息
CREATE TABLE providers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,   -- Ondo, Backed, Dinari, Kraken, Binance, Uniswap, Raydium...
  type VARCHAR(20) NOT NULL,           -- issuer, dex, cex
  display_name VARCHAR(100),
  website VARCHAR(500),
  api_base_url VARCHAR(500),
  fee_percent DECIMAL,
  requires_kyc BOOLEAN DEFAULT FALSE,
  kyc_regions TEXT,                    -- "US", "US,EU" etc.
  has_dividends BOOLEAN DEFAULT TRUE,
  has_voting_rights BOOLEAN DEFAULT FALSE,
  supported_chains TEXT[],             -- {"ethereum","solana","base"}
  mint_available BOOLEAN DEFAULT FALSE,  -- 是否支持铸造
  redeem_available BOOLEAN DEFAULT FALSE, -- 是否支持赎回
  redeem_hours VARCHAR(20),            -- "24/7", "business_hours"
  min_amount DECIMAL DEFAULT 1,
  compliance_jurisdiction VARCHAR(50), -- "BVI", "Liechtenstein", "US"
  logo_url VARCHAR(500),
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- 代币信息（同一只股票在不同发行商/链上的不同版本）
CREATE TABLE tokens (
  id SERIAL PRIMARY KEY,
  stock_id INTEGER REFERENCES stocks(id) ON DELETE CASCADE,
  provider_id INTEGER REFERENCES providers(id) ON DELETE CASCADE,
  token_name VARCHAR(50) NOT NULL,      -- NVDAon, NVDAx, dNVDA, xNVDA
  chain VARCHAR(50) NOT NULL,           -- ethereum, solana, base, bnb, arbitrum
  contract_address VARCHAR(255),
  decimals INTEGER DEFAULT 18,
  token_standard VARCHAR(20),           -- ERC-20, SPL, Jetton
  dex_pool_address VARCHAR(255),        -- 主要DEX交易对地址
  dex_name VARCHAR(50),                 -- uniswap_v3, raydium, pancakeswap
  chainlink_feed_address VARCHAR(255),  -- Chainlink价格Feed地址
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(stock_id, provider_id, chain)
);

-- =============================================
-- 价格数据
-- =============================================

-- 实时价格快照（每分钟写入，用于历史图表和分析）
CREATE TABLE price_snapshots (
  id BIGSERIAL PRIMARY KEY,
  token_id INTEGER REFERENCES tokens(id) ON DELETE CASCADE,
  price DECIMAL NOT NULL,
  base_price DECIMAL NOT NULL,          -- Chainlink基准价
  premium_percent DECIMAL,              -- 溢价/折价百分比
  volume_24h DECIMAL,
  liquidity DECIMAL,
  source VARCHAR(50),                   -- api, dex, cex, chainlink
  recorded_at TIMESTAMP DEFAULT NOW()
);

-- 为查询性能创建索引
CREATE INDEX idx_price_snapshots_token_time ON price_snapshots(token_id, recorded_at DESC);
CREATE INDEX idx_price_snapshots_time ON price_snapshots(recorded_at DESC);

-- =============================================
-- 用户功能
-- =============================================

-- 交易记录
CREATE TABLE trades (
  id BIGSERIAL PRIMARY KEY,
  wallet_address VARCHAR(255) NOT NULL,
  stock_ticker VARCHAR(10) NOT NULL,
  action VARCHAR(10) NOT NULL,          -- buy, sell
  trade_method VARCHAR(20) NOT NULL,    -- swap, mint, redeem, cex_redirect
  provider VARCHAR(100) NOT NULL,       -- Ondo, Uniswap, Raydium, Kraken...
  chain VARCHAR(50) NOT NULL,
  token_name VARCHAR(50) NOT NULL,      -- NVDAon, NVDAx, dNVDA
  input_amount DECIMAL NOT NULL,        -- 买入:USDC金额 / 卖出:代币数量
  input_currency VARCHAR(20) NOT NULL,  -- USDC, NVDAon, NVDAx...
  output_amount DECIMAL NOT NULL,       -- 买入:代币数量 / 卖出:USDC到手
  output_currency VARCHAR(20) NOT NULL, -- NVDAon, USDC...
  price DECIMAL NOT NULL,               -- 成交价
  base_price DECIMAL,                   -- Chainlink基准价
  premium_percent DECIMAL,              -- 溢价/折价百分比
  protocol_fee DECIMAL,
  gas_fee DECIMAL,
  slippage DECIMAL,
  platform_fee DECIMAL,                 -- 平台收取的手续费
  tx_hash VARCHAR(255),
  status VARCHAR(20) DEFAULT 'pending', -- pending, confirmed, failed
  created_at TIMESTAMP DEFAULT NOW(),
  confirmed_at TIMESTAMP
);

CREATE INDEX idx_trades_wallet ON trades(wallet_address, created_at DESC);
CREATE INDEX idx_trades_ticker ON trades(stock_ticker, created_at DESC);
CREATE INDEX idx_trades_status ON trades(status);

-- 限价单
CREATE TABLE limit_orders (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(255) NOT NULL,
  stock_ticker VARCHAR(10) NOT NULL,
  action VARCHAR(10) NOT NULL,          -- buy, sell
  token_name VARCHAR(50),               -- 卖出时指定持有的代币
  amount DECIMAL NOT NULL,              -- 买入:USDC金额 / 卖出:代币数量
  order_type VARCHAR(20) NOT NULL,      -- limit_price, premium_trigger, stop_loss, take_profit
  target_price DECIMAL,                 -- 目标价格
  target_premium DECIMAL,               -- 或目标溢价/折价百分比
  preferred_chain VARCHAR(50),
  preferred_provider VARCHAR(100),
  slippage_bps INTEGER DEFAULT 50,
  status VARCHAR(20) DEFAULT 'active',  -- active, triggered, cancelled, expired
  expires_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  triggered_at TIMESTAMP,
  trade_id BIGINT REFERENCES trades(id)
);

CREATE INDEX idx_limit_orders_wallet ON limit_orders(wallet_address, status);
CREATE INDEX idx_limit_orders_active ON limit_orders(status, stock_ticker) WHERE status = 'active';

-- 价格提醒
CREATE TABLE alerts (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(255),
  stock_ticker VARCHAR(10) NOT NULL,
  alert_type VARCHAR(20) NOT NULL,      -- price_below, price_above, discount_above, premium_above
  target_value DECIMAL NOT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  notification_channel VARCHAR(20),     -- telegram, email, browser
  notification_target VARCHAR(255),     -- telegram chat id, email地址等
  last_triggered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_alerts_active ON alerts(is_active, stock_ticker) WHERE is_active = TRUE;

-- 定投计划
CREATE TABLE dca_plans (
  id SERIAL PRIMARY KEY,
  wallet_address VARCHAR(255) NOT NULL,
  stock_ticker VARCHAR(10) NOT NULL,
  amount_usdc DECIMAL NOT NULL,
  frequency VARCHAR(20) NOT NULL,       -- daily, weekly, biweekly, monthly
  preferred_chain VARCHAR(50),
  preferred_provider VARCHAR(100),
  auto_best_price BOOLEAN DEFAULT TRUE, -- 自动选最优价格
  slippage_bps INTEGER DEFAULT 50,
  is_active BOOLEAN DEFAULT TRUE,
  next_execution TIMESTAMP,
  last_execution TIMESTAMP,
  total_invested DECIMAL DEFAULT 0,
  total_tokens DECIMAL DEFAULT 0,
  execution_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_dca_plans_active ON dca_plans(is_active, next_execution) WHERE is_active = TRUE;

-- =============================================
-- 平台数据
-- =============================================

-- 套利机会记录
CREATE TABLE arbitrage_opportunities (
  id BIGSERIAL PRIMARY KEY,
  stock_ticker VARCHAR(10) NOT NULL,
  buy_provider VARCHAR(100) NOT NULL,
  buy_chain VARCHAR(50) NOT NULL,
  buy_price DECIMAL NOT NULL,
  sell_provider VARCHAR(100) NOT NULL,
  sell_chain VARCHAR(50) NOT NULL,
  sell_price DECIMAL NOT NULL,
  spread_percent DECIMAL NOT NULL,      -- 价差百分比
  net_profit_percent DECIMAL,           -- 扣除费用后的净利润
  detected_at TIMESTAMP DEFAULT NOW(),
  expired_at TIMESTAMP                  -- 套利窗口关闭时间
);

CREATE INDEX idx_arbitrage_active ON arbitrage_opportunities(detected_at DESC)
  WHERE expired_at IS NULL;

-- 平台统计
CREATE TABLE platform_stats (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL UNIQUE,
  total_queries INTEGER DEFAULT 0,      -- 查询次数
  total_trades INTEGER DEFAULT 0,       -- 交易笔数
  total_volume DECIMAL DEFAULT 0,       -- 交易量(USDC)
  total_fees DECIMAL DEFAULT 0,         -- 平台手续费收入
  unique_wallets INTEGER DEFAULT 0,     -- 独立钱包数
  created_at TIMESTAMP DEFAULT NOW()
);
