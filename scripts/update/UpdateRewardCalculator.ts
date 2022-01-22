import { ethers } from 'hardhat';
import { DeployerUtils } from '../deploy/DeployerUtils';
import { Bookkeeper, RewardCalculator } from '../../typechain';

async function main() {
  const signer = (await ethers.getSigners())[0];

  const logic = (await DeployerUtils.deployContract(
    signer,
    'RewardCalculator',
  )) as RewardCalculator;

  await DeployerUtils.wait(5);
  await DeployerUtils.verify(logic.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
