require("@nomicfoundation/hardhat-toolbox");
const { subtask } = require("hardhat/config");
const { TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD } = require("hardhat/builtin-tasks/task-names");

// Use the bundled solc-js (npm) so compilation works offline / without downloading solc binaries.
subtask(TASK_COMPILE_SOLIDITY_GET_SOLC_BUILD, async (args, hre, runSuper) => {
  const solc = require("solc");
  if (args.solcVersion === require("solc/package.json").version) {
    return {
      compilerPath: require.resolve("solc/soljson.js"),
      isSolcJs: true,
      version: args.solcVersion,
      longVersion: solc.version(),
    };
  }
  return runSuper();
});

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } },
  networks: { localhost: { url: "http://127.0.0.1:8545", chainId: 31337 } },
};
