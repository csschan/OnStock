const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deploying with:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "OKB");

  // 1. Deploy MockUSDC
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  console.log("MockUSDC:", await usdc.getAddress());

  // 2. Deploy mock xStock tokens
  const stocks = [
    { name: "Backed Tesla",       symbol: "TSLAx",  apyBps: 420 },
    { name: "Backed NVIDIA",      symbol: "NVDAx",  apyBps: 420 },
    { name: "Backed S&P 500 ETF", symbol: "SPYx",   apyBps: 380 },
    { name: "Backed Apple",       symbol: "AAPLx",  apyBps: 420 },
    { name: "Backed Google",      symbol: "GOOGLx", apyBps: 420 },
    { name: "Backed Meta",        symbol: "METAx",  apyBps: 420 },
    { name: "Backed Coinbase",    symbol: "COINx",  apyBps: 550 },
    { name: "Backed MicroStrategy",symbol: "MSTRx", apyBps: 550 },
  ];

  const MockXStock = await hre.ethers.getContractFactory("MockXStock");
  const deployed = {};

  for (const s of stocks) {
    const token = await MockXStock.deploy(s.name, s.symbol);
    await token.waitForDeployment();
    const addr = await token.getAddress();
    deployed[s.symbol] = { address: addr, apyBps: s.apyBps };
    console.log(`${s.symbol}: ${addr}`);
  }

  // 3. Deploy VaultFactory
  const VaultFactory = await hre.ethers.getContractFactory("VaultFactory");
  const factory = await VaultFactory.deploy();
  await factory.waitForDeployment();
  console.log("VaultFactory:", await factory.getAddress());

  // 4. Create vaults for each xStock
  for (const s of stocks) {
    const { address, apyBps } = deployed[s.symbol];
    const tx = await factory.createVault(
      address,
      `OnStock ${s.symbol.replace('x','')} Vault`,
      `os${s.symbol.replace('x','')}`,
      apyBps
    );
    await tx.wait();
    const vaultAddr = await factory.vaults(address);
    console.log(`Vault ${s.symbol}: ${vaultAddr}`);
  }

  // 5. Output JSON for backend integration
  const result = {
    network: hre.network.name,
    chainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    usdc: await usdc.getAddress(),
    factory: await factory.getAddress(),
    tokens: {},
    vaults: {},
  };

  for (const s of stocks) {
    result.tokens[s.symbol] = deployed[s.symbol].address;
    result.vaults[s.symbol] = await factory.vaults(deployed[s.symbol].address);
  }

  console.log("\n=== DEPLOYMENT RESULT ===");
  console.log(JSON.stringify(result, null, 2));

  // Write to file
  const fs = require("fs");
  fs.writeFileSync(
    `deployment-${hre.network.name}.json`,
    JSON.stringify(result, null, 2)
  );
  console.log(`\nSaved to deployment-${hre.network.name}.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
