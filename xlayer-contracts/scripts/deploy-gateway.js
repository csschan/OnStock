/**
 * Deploy OSGateway + OSTokens to Arbitrum Sepolia (or X Layer)
 *
 * Creates:
 *   1. OSGateway contract
 *   2. OSToken for each stock (osTSLA, osNVDA, osAAPL, osSPY, osGOOGL)
 *   3. Registers each token in the gateway
 *
 * Usage:
 *   npx hardhat run scripts/deploy-gateway.js --network arbitrumSepolia
 *   npx hardhat run scripts/deploy-gateway.js --network xlayerTestnet
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

const STOCKS = [
  { ticker: "TSLA",  name: "OnStock TSLA", symbol: "osTSLA" },
  { ticker: "NVDA",  name: "OnStock NVDA", symbol: "osNVDA" },
  { ticker: "AAPL",  name: "OnStock AAPL", symbol: "osAAPL" },
  { ticker: "SPY",   name: "OnStock SPY",  symbol: "osSPY"  },
  { ticker: "GOOGL", name: "OnStock GOOGL",symbol: "osGOOGL"},
  { ticker: "META",  name: "OnStock META", symbol: "osMETA" },
  { ticker: "COIN",  name: "OnStock COIN", symbol: "osCOIN" },
  { ticker: "MSTR",  name: "OnStock MSTR", symbol: "osMSTR" },
];

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;
  console.log(`\nDeploying OSGateway on ${network}`);
  console.log(`Deployer: ${deployer.address}`);

  // Load existing deployment for USDC address
  const deployFile = network === "arbitrumSepolia"
    ? path.resolve(__dirname, "../deployment-arbitrumSepolia.json")
    : path.resolve(__dirname, "../deployment-xlayerTestnet.json");

  let deployment = {};
  if (fs.existsSync(deployFile)) {
    deployment = JSON.parse(fs.readFileSync(deployFile, "utf8"));
  }

  const usdcAddr = deployment.usdc;
  if (!usdcAddr) {
    console.error("No USDC address found. Run deploy.js first.");
    process.exit(1);
  }
  console.log(`USDC: ${usdcAddr}`);

  // 1. Deploy OSGateway
  const OSGateway = await hre.ethers.getContractFactory("OSGateway");
  const gateway = await OSGateway.deploy(usdcAddr, deployer.address);
  await gateway.waitForDeployment();
  const gatewayAddr = await gateway.getAddress();
  console.log(`\nOSGateway: ${gatewayAddr}`);

  // 2. Deploy OSTokens + register in gateway
  const osTokens = {};
  const OSToken = await hre.ethers.getContractFactory("OSToken");

  for (const stock of STOCKS) {
    const token = await OSToken.deploy(stock.name, stock.symbol, gatewayAddr);
    await token.waitForDeployment();
    const addr = await token.getAddress();
    osTokens[stock.ticker] = addr;
    console.log(`  ${stock.symbol}: ${addr}`);

    // Register in gateway
    const tx = await gateway.registerAsset(stock.ticker, addr);
    await tx.wait();
    console.log(`    → registered in gateway`);
  }

  // 3. Save deployment
  deployment.gateway = gatewayAddr;
  deployment.osTokens = osTokens;
  fs.writeFileSync(deployFile, JSON.stringify(deployment, null, 2));
  console.log(`\nSaved to ${deployFile}`);

  // 4. Summary
  console.log(`\n════════════════════════════════════════`);
  console.log(`  OSGateway deployed on ${network}`);
  console.log(`  Gateway: ${gatewayAddr}`);
  console.log(`  Tokens:  ${Object.keys(osTokens).length}`);
  console.log(`  Keeper:  ${deployer.address}`);
  console.log(`════════════════════════════════════════\n`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
