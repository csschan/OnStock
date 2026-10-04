/**
 * Deploy THORChain-style pool architecture:
 *   1. OSPool (liquidity pool, holds USDC reserves)
 *   2. OSGateway v3 (connected to pool)
 *   3. OSTokens (8 stocks)
 *   4. Seed pool with initial USDC liquidity
 *
 * Usage:
 *   npx hardhat run scripts/deploy-pool-gateway.js --network arbitrumSepolia
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
  const network = hre.network.name;
  console.log(`\nDeploying THORChain-style architecture on ${network}`);
  console.log(`Deployer: ${deployer.address}\n`);

  const deployFile = network === "arbitrumSepolia"
    ? path.resolve(__dirname, "../deployment-arbitrumSepolia.json")
    : path.resolve(__dirname, "../deployment-xlayerTestnet.json");

  let deployment = {};
  if (fs.existsSync(deployFile)) {
    deployment = JSON.parse(fs.readFileSync(deployFile, "utf8"));
  }

  const usdcAddr = deployment.usdc;
  if (!usdcAddr) {
    console.error("No USDC. Run deploy.js first.");
    process.exit(1);
  }

  // 1. Deploy OSPool
  console.log("── Step 1: Deploy OSPool ──");
  const OSPool = await hre.ethers.getContractFactory("OSPool");
  // Gateway address not known yet, use deployer temporarily
  const pool = await OSPool.deploy(usdcAddr, deployer.address, deployer.address);
  await pool.waitForDeployment();
  const poolAddr = await pool.getAddress();
  console.log(`OSPool: ${poolAddr}`);

  // 2. Deploy OSGateway v3 (connected to pool)
  console.log("\n── Step 2: Deploy OSGateway v3 ──");
  const OSGateway = await hre.ethers.getContractFactory("OSGateway");
  const gateway = await OSGateway.deploy(usdcAddr, poolAddr, deployer.address);
  await gateway.waitForDeployment();
  const gatewayAddr = await gateway.getAddress();
  console.log(`OSGateway: ${gatewayAddr}`);

  // Update pool's gateway reference
  await (await pool.setGateway(gatewayAddr)).wait();
  console.log("Pool → Gateway linked");

  // 3. Deploy OSTokens + register
  console.log("\n── Step 3: Deploy OSTokens ──");
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

  // 4. Seed pool with initial USDC liquidity (LP deposit)
  console.log("\n── Step 4: Seed pool with liquidity ──");
  const seedAmount = hre.ethers.parseUnits("100000", 6); // $100k
  const usdcContract = new hre.ethers.Contract(usdcAddr, [
    "function mint(address,uint256)",
    "function approve(address,uint256) returns(bool)",
    "function balanceOf(address) view returns(uint256)",
  ], deployer);

  // Mint USDC for LP
  await (await usdcContract.mint(deployer.address, seedAmount)).wait();
  // Approve pool
  await (await usdcContract.approve(poolAddr, seedAmount)).wait();
  // LP deposit
  await (await pool.lpDeposit(seedAmount)).wait();

  const poolInfo = await pool.poolInfo();
  console.log(`Pool reserve: $${hre.ethers.formatUnits(poolInfo[0], 6)}`);
  console.log(`LP shares: ${hre.ethers.formatUnits(poolInfo[1], 6)}`);

  // Save deployment
  deployment.pool = poolAddr;
  deployment.gateway = gatewayAddr;
  deployment.osTokens = osTokens;
  deployment.architecture = "thorchain-pool";
  fs.writeFileSync(deployFile, JSON.stringify(deployment, null, 2));
  console.log(`\nSaved to ${deployFile}`);

  console.log(`\n════════════════════════════════════════`);
  console.log(`  THORChain-style architecture deployed`);
  console.log(`  Pool:    ${poolAddr} ($100k liquidity)`);
  console.log(`  Gateway: ${gatewayAddr}`);
  console.log(`  Tokens:  ${Object.keys(osTokens).length}`);
  console.log(`════════════════════════════════════════\n`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
