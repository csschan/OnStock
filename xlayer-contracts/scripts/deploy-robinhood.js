/**
 * Full deploy to Robinhood Testnet:
 *   1. MockUSDC
 *   2. OSPool
 *   3. OSGateway
 *   4. 8 OSTokens
 *   5. Seed pool with $100k
 */
const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const STOCKS = [
  { ticker: "TSLA", name: "OnStock TSLA", symbol: "osTSLA" },
  { ticker: "NVDA", name: "OnStock NVDA", symbol: "osNVDA" },
  { ticker: "AAPL", name: "OnStock AAPL", symbol: "osAAPL" },
  { ticker: "SPY",  name: "OnStock SPY",  symbol: "osSPY"  },
  { ticker: "GOOGL",name: "OnStock GOOGL",symbol: "osGOOGL"},
  { ticker: "META", name: "OnStock META", symbol: "osMETA" },
  { ticker: "COIN", name: "OnStock COIN", symbol: "osCOIN" },
  { ticker: "MSTR", name: "OnStock MSTR", symbol: "osMSTR" },
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log(`\nDeploying to Robinhood Testnet`);
  console.log(`Deployer: ${deployer.address}`);
  console.log(`Balance: ${hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address))} ETH\n`);

  // 1. MockUSDC
  console.log("── Step 1: Deploy MockUSDC ──");
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddr = await usdc.getAddress();
  console.log(`MockUSDC: ${usdcAddr}`);

  // 2. OSPool
  console.log("\n── Step 2: Deploy OSPool ──");
  const OSPool = await hre.ethers.getContractFactory("OSPool");
  const pool = await OSPool.deploy(usdcAddr, deployer.address, deployer.address);
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`OSPool: ${poolAddr}`);

  // 3. OSGateway
  console.log("\n── Step 3: Deploy OSGateway ──");
  const OSGateway = await hre.ethers.getContractFactory("OSGateway");
  const gateway = await OSGateway.deploy(usdcAddr, poolAddr, deployer.address);
  await gateway.waitForDeployment();
  const gatewayAddr = await gateway.getAddress();
  console.log(`OSGateway: ${gatewayAddr}`);

  // Link pool → gateway
  await (await pool.setGateway(gatewayAddr)).wait();
  console.log("Pool → Gateway linked");

  // 4. OSTokens
  console.log("\n── Step 4: Deploy OSTokens ──");
  const osTokens = {};
  const OSToken = await hre.ethers.getContractFactory("OSToken");
  for (const stock of STOCKS) {
    const token = await OSToken.deploy(stock.name, stock.symbol, gatewayAddr);
    await token.waitForDeployment();
    const addr = await token.getAddress();
    osTokens[stock.ticker] = addr;
    await (await gateway.registerAsset(stock.ticker, addr)).wait();
    console.log(`  ${stock.symbol}: ${addr} → registered`);
  }

  // 5. Seed pool
  console.log("\n── Step 5: Seed pool ──");
  const seedAmount = hre.ethers.parseUnits("100000", 6);
  await (await usdc.mint(deployer.address, seedAmount)).wait();
  await (await usdc.approve(poolAddr, seedAmount)).wait();
  await (await pool.lpDeposit(seedAmount)).wait();
  const info = await pool.poolInfo();
  console.log(`Pool reserve: $${hre.ethers.formatUnits(info[0], 6)}`);

  // Save
  const data = {
    network: "robinhoodTestnet",
    chainId: "46630",
    deployer: deployer.address,
    usdc: usdcAddr,
    gateway: gatewayAddr,
    pool: poolAddr,
    osTokens,
    architecture: "thorchain-pool",
  };
  const deployFile = path.resolve(__dirname, "../deployment-robinhoodTestnet.json");
  fs.writeFileSync(deployFile, JSON.stringify(data, null, 2));
  console.log(`\nSaved to ${deployFile}`);

  console.log(`\n════════════════════════════════════════`);
  console.log(`  Robinhood Testnet deployed`);
  console.log(`  USDC:    ${usdcAddr}`);
  console.log(`  Pool:    ${poolAddr} ($100k)`);
  console.log(`  Gateway: ${gatewayAddr}`);
  console.log(`  Tokens:  ${Object.keys(osTokens).length}`);
  console.log(`════════════════════════════════════════\n`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
