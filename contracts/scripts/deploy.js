const fs = require("fs");
const path = require("path");
const hre = require("hardhat");

async function main() {
  const F = await hre.ethers.getContractFactory("ModelRegistry");
  const c = await F.deploy();
  await c.waitForDeployment();
  const address = await c.getAddress();
  const { chainId } = await hre.ethers.provider.getNetwork();
  const artifact = await hre.artifacts.readArtifact("ModelRegistry");
  const out = { address, chainId: Number(chainId), abi: artifact.abi };
  const dir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "localhost.json"), JSON.stringify(out, null, 2));
  console.log("ModelRegistry deployed:", address, "chainId", out.chainId);
}
main().catch((e) => { console.error(e); process.exit(1); });
