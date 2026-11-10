const { ethers } = require("hardhat");
async function main() {
  const [f] = await ethers.getSigners();
  const to = "0xB2E15E94817aE53f4aF855402B65D41F5DDD23F3";
  await (await f.sendTransaction({ to, value: ethers.parseEther("100") })).wait();
  console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(to)), "ETH");
}
main();
