import {DeployerUtils} from "./deploy/DeployerUtils";
import {SmartVault__factory, StrategyAaveMaiBal__factory} from "../typechain";
import {ethers} from "hardhat";
import {utils} from "ethers";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";

async function main() {
  // const signer = await DeployerUtils.impersonate();
  const signer = (await ethers.getSigners())[0];
  // const controller = await DeployerUtils.impersonate('0x6678814c273d5088114B6E40cC49C8DB04F9bC29');
  // const core = await DeployerUtils.getCoreAddressesWrapper(signer);
  // const tools = await DeployerUtils.getToolsAddressesWrapper(signer);

  // TETU_MATIC_FORK_BLOCK=23116847
  const user = await DeployerUtils.impersonate('0x0ffeb87106910eefc69c1902f411b431ffc424ff');
  const vault = await SmartVault__factory.connect('0x9C233cA476184e9aa4f2ff07E081D55f179964Fd', user);
  const strategyAddress = await vault.strategy();

  const amount = ethers.utils.parseUnits('1', 18)
  console.log('amount', amount.toString());
  // await vault.withdraw(amount);
  const ppfs = await vault.getPricePerFullShare();
  console.log('ppfs', ppfs.toString());

  const controller = await DeployerUtils.impersonate('0x6678814c273d5088114B6E40cC49C8DB04F9bC29');
  const strategy = await StrategyAaveMaiBal__factory.connect(strategyAddress, controller);
  await strategy.setTargetPercentage(300);

  const ppfsAfter = await vault.getPricePerFullShare();
  console.log('ppfsAfter', ppfsAfter.toString());

  await vault.withdraw(amount);

  const ppfsAfter2 = await vault.getPricePerFullShare();
  console.log('ppfsAfter2', ppfsAfter2.toString());
}


main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });
