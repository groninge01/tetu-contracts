import {DeployerUtils} from "./deploy/DeployerUtils";
import {SmartVault__factory, StrategyAaveMaiBal__factory} from "../typechain";
import {ethers} from "hardhat";
import {utils} from "ethers";

async function main() {
  // const signer = await DeployerUtils.impersonate();
  const signer = (await ethers.getSigners())[0];
  const user = await DeployerUtils.impersonate('0x8f3a89a0b67478b8c78c0b79a50f0454d05c1f1e');
  const core = await DeployerUtils.getCoreAddressesWrapper(signer);
  const tools = await DeployerUtils.getToolsAddressesWrapper(signer);

  // TETU_MATIC_FORK_BLOCK=23116847
  const vault = await SmartVault__factory.connect('0xf203b855b4303985b3dd3f35a9227828cc8cb009', user);
  const strategyAddress = await vault.strategy();
  const strategy = await StrategyAaveMaiBal__factory.connect(strategyAddress, user);
  const ppfs = await vault.getPricePerFullShare();
  console.log('ppfs', ppfs.toString());
  const cp = await strategy.collateralPercentage();
  console.log('collateralPercentage', cp.toString());

  await vault.depositAndInvest(utils.parseUnits('1'));

  const ppfsAfter = await vault.getPricePerFullShare();
  console.log('ppfsAfter', ppfsAfter.toString());
  const cpAfter = await strategy.collateralPercentage();
  console.log('collateralPercentageAfter', cpAfter.toString());

  const ppfsRatio = ppfsAfter.mul(10000).div(ppfs)
  console.log('ppfsRatio%', ppfsRatio.toNumber()/100);
  const cpRatio = cpAfter.mul(10000).div(cp)
  console.log('cpRatio  %', cpRatio.toNumber()/100)

  const one = cpRatio.mul(ppfsRatio)
  console.log('one      %', one.toNumber()/1000000);
}


main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
