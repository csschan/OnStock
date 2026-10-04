/**
 * Deploy PortfolioVault to X Layer Testnet (or Arbitrum Sepolia)
 *
 * Uses existing deployment addresses from deployment-xlayerTestnet.json
 * Creates a diversified portfolio vault with initial equal weights.
 *
 * Usage:
 *   npx hardhat run scripts/deploy-portfolio.js --network xlayerTestnet
 *   npx hardhat run scripts/deploy-portfolio.js --network arbitrumSepolia
 */

const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  const network = hre.network.name;
  console.log(`Deploying PortfolioVault on ${network} with:`, deployer.address);

  // Load existing deployment
  const deployFile = network === "arbitrumSepolia"
    ? path.resolve(__dirname, "../deployment-arbitrumSepolia.json")
    : path.resolve(__dirname, "../deployment-xlayerTestnet.json");

  if (!fs.existsSync(deployFile)) {
    console.error(`Deployment file not found: ${deployFile}`);
    console.error("Run deploy.js first to deploy base contracts.");
    process.exit(1);
  }

  const deployment = JSON.parse(fs.readFileSync(deployFile, "utf8"));
  const usdcAddr = deployment.usdc;
  const tokens = deployment.tokens; // { TSLAx: "0x...", NVDAx: "0x...", ... }

  console.log("USDC:", usdcAddr);
  console.log("Assets:", Object.keys(tokens).join(", "));

  // Portfolio assets: top 5 stocks for diversification
  const portfolioAssets = ["TSLAx", "NVDAx", "AAPLx", "SPYx", "GOOGLx"];
  const assetAddresses = portfolioAssets.map(s => tokens[s]);

  // Verify all exist
  for (let i = 0; i < portfolioAssets.length; i++) {
    if (!assetAddresses[i]) {
      console.error(`Token ${portfolioAssets[i]} not found in deployment`);
      process.exit(1);
    }
  }

  // Initial weights (basis points, sum = 10000)
  // Equal weight to start — keeper will rebalance based on RWA scoring
  const initialWeights = [2500, 2500, 2000, 1500, 1500]; // TSLA 25%, NVDA 25%, AAPL 20%, SPY 15%, GOOGL 15%

  const weightSum = initialWeights.reduce((a, b) => a + b, 0);
  if (weightSum !== 10000) {
    console.error(`Weights sum to ${weightSum}, must be 10000`);
    process.exit(1);
  }

  console.log("\nPortfolio composition:");
  for (let i = 0; i < portfolioAssets.length; i++) {
    console.log(`  ${portfolioAssets[i]}: ${(initialWeights[i] / 100).toFixed(1)}% — ${assetAddresses[i]}`);
  }

  // Deploy PortfolioVault
  const PortfolioVault = await hre.ethers.getContractFactory("PortfolioVault");
  const vault = await PortfolioVault.deploy(
    usdcAddr,
    deployer.address,  // keeper = deployer for now
    assetAddresses,
    initialWeights
  );
  await vault.waitForDeployment();
  const vaultAddr = await vault.getAddress();

  console.log(`\nPortfolioVault deployed: ${vaultAddr}`);
  console.log(`  Keeper: ${deployer.address}`);
  console.log(`  Share token: osPFO`);

  // Save to deployment file
  deployment.portfolioVault = vaultAddr;
  deployment.portfolioAssets = portfolioAssets;
  deployment.portfolioWeights = initialWeights;
  fs.writeFileSync(deployFile, JSON.stringify(deployment, null, 2));
  console.log(`\nSaved to ${deployFile}`);

  // Verify contract info
  const info = await vault.getPortfolio();
  console.log(`\nOn-chain portfolio info:`);
  console.log(`  Assets: ${info.tokens.length}`);
  console.log(`  NAV: ${hre.ethers.formatUnits(info.totalNav, 6)} USDC`);
  console.log(`  Rebalance count: ${info._rebalanceCount}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
