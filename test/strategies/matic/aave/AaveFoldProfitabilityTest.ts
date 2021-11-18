import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {MaticAddresses} from "../../../MaticAddresses";
import {readFileSync} from "fs";
import {config as dotEnvConfig} from "dotenv";
import {DeployerUtils} from "../../../../scripts/deploy/DeployerUtils";
import {PriceCalculator, SmartVault, StrategyAaveFold} from "../../../../typechain";
import {ethers} from "hardhat";
import {StrategyTestUtils} from "../../StrategyTestUtils";
import {VaultUtils} from "../../../VaultUtils";
import {utils} from "ethers";
import {TokenUtils} from "../../../TokenUtils";
import {TimeUtils} from "../../../TimeUtils";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {CoreContractsWrapper} from "../../../CoreContractsWrapper";

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
  .env('TETU')
  .options({
    disableStrategyTests: {
      type: "boolean",
      default: false,
    },
    onlyOneAaveFoldStrategyTest: {
      type: "number",
      default: 0,
    }
  }).argv;

const {expect} = chai;
chai.use(chaiAsPromised);

// skipped as it relaying on the internal strategy checks
//   function claimRewardPublic() public {
//     claimReward();
//   }
// need to be updated to use bookkeper or similar.
describe.skip('Universal Aave Fold profitability tests', async () => {

  if (argv.disableStrategyTests) {
    return;
  }
  const infos = readFileSync('scripts/utils/download/data/aave_markets.csv', 'utf8').split(/\r?\n/);

  infos.forEach(info => {
    const strat = info.split(',');

    const idx = strat[0];
    const tokenName = strat[1];
    const token = strat[2];
    const aTokenName = strat[3];
    const aTokenAddress = strat[4];
    const dTokenAddress = strat[6];


    let vault: SmartVault;
    let strategy: StrategyAaveFold;
    let lpForTargetToken;

    if (!idx || idx === 'idx') {
      console.log('skip', idx);
      return;
    }

    console.log('strat', idx, aTokenName);

    describe(tokenName + " Test", async function () {
      let snapshotBefore: string;
      let snapshot: string;
      const underlying = token;

      const aToken = aTokenAddress;
      const debtToken = dTokenAddress;
      let deposit = "1000"
      if (tokenName === "WBTC") {
        deposit = "1";
      }
      const investingPeriod = 60 * 60 * 24 * 30;

      let user: SignerWithAddress;
      let core: CoreContractsWrapper;
      let calculator: PriceCalculator;

      before(async function () {
        snapshotBefore = await TimeUtils.snapshot();
        const signer = await DeployerUtils.impersonate();
        user = (await ethers.getSigners())[1];
        const undDec = await TokenUtils.decimals(underlying);

        core = await DeployerUtils.getCoreAddressesWrapper(signer);
        calculator = (await DeployerUtils.deployPriceCalculatorMatic(signer, core.controller.address))[0];

        const data = await StrategyTestUtils.deploy(
          signer,
          core,
          tokenName,
          async vaultAddress => DeployerUtils.deployContract(
            signer,
            'StrategyAaveFold',
            core.controller.address,
            vaultAddress,
            underlying,
            "5000",
            "6000"
          ) as Promise<StrategyAaveFold>,
          underlying
        );

        vault = data[0];
        strategy = data[1] as StrategyAaveFold;
        lpForTargetToken = data[2];

        await VaultUtils.addRewardsXTetu(signer, vault, core, 1);

        await core.vaultController.changePpfsDecreasePermissions([vault.address], true);
        // ************** add funds for investing ************
        await TokenUtils.getToken(underlying, user.address, utils.parseUnits(deposit, undDec))
        console.log('############## Preparations completed ##################');
      });

      beforeEach(async function () {
        snapshot = await TimeUtils.snapshot();
      });

      afterEach(async function () {
        await TimeUtils.rollback(snapshot);
      });

      after(async function () {
        await TimeUtils.rollback(snapshotBefore);
      });

      it("Folding profitability calculations", async () => {

        const vaultForUser = vault.connect(user);
        const rt0 = (await vaultForUser.rewardTokens())[0];
        const userUnderlyingBalance = await TokenUtils.balanceOf(underlying, user.address);
        const undDec = await TokenUtils.decimals(underlying);

        await strategy.setFold(false);


        console.log("deposit", deposit);
        await VaultUtils.deposit(user, vault, utils.parseUnits(deposit, undDec));

        const atDecimals = await TokenUtils.decimals(aToken);
        const dtDecimals = await TokenUtils.decimals(debtToken);
        const rtDecimals = await TokenUtils.decimals(MaticAddresses.WMATIC_TOKEN);

        const rewardBalanceBefore = await TokenUtils.balanceOf(core.psVault.address, user.address);
        console.log("rewardBalanceBefore: ", rewardBalanceBefore.toString());

        const vaultBalanceBefore = await TokenUtils.balanceOf(core.psVault.address, vault.address);
        console.log("vaultBalanceBefore: ", vaultBalanceBefore.toString());

        const underlyingBalanceBefore = +utils.formatUnits(await TokenUtils.balanceOf(aToken, strategy.address), atDecimals);
        console.log("underlyingBalanceBefore: ", underlyingBalanceBefore.toString());

        const debtBalanceBefore = +utils.formatUnits(await TokenUtils.balanceOf(debtToken, strategy.address), dtDecimals);
        console.log("debtBalanceBefore: ", debtBalanceBefore.toString());

        const maticBefore = +utils.formatUnits(await TokenUtils.balanceOf(MaticAddresses.WMATIC_TOKEN, strategy.address), rtDecimals);

        console.log("MATIC before: ", maticBefore.toString());
        const data = await strategy.totalRewardPrediction(investingPeriod);

        const supplyRewards = +utils.formatUnits(data[0], rtDecimals);
        const borrowRewards = +utils.formatUnits(data[1], rtDecimals);
        let supplyUnderlyingProfit = +utils.formatUnits(data[2], atDecimals);
        const debtUnderlyingCost = +utils.formatUnits(data[3], dtDecimals);

        console.log("supplyRewards:", supplyRewards);
        console.log("borrowRewards:", borrowRewards);
        console.log("supplyUnderlyingProfit:", supplyUnderlyingProfit);
        console.log("debtUnderlyingCost:", debtUnderlyingCost);
        console.log("======================================");


        const dataWeth = await strategy.totalRewardPredictionInWeth(investingPeriod);

        const supplyRewardsWeth = +utils.formatUnits(dataWeth[0], rtDecimals);
        const borrowRewardsWeth = +utils.formatUnits(dataWeth[1], rtDecimals);
        const supplyUnderlyingProfitWeth = +utils.formatUnits(dataWeth[2], atDecimals);
        const debtUnderlyingCostWeth = +utils.formatUnits(dataWeth[3], dtDecimals);
        const totalWethEarned = supplyRewardsWeth + borrowRewardsWeth + supplyUnderlyingProfitWeth - debtUnderlyingCostWeth;

        console.log("supplyRewardsWeth:", supplyRewardsWeth, "borrowRewardsWeth:", borrowRewardsWeth);
        console.log("supplyUnderlyingProfitWeth:", supplyUnderlyingProfitWeth, "debtUnderlyingCostWeth:", debtUnderlyingCostWeth);
        console.log("======================================");
        console.log("Total earned WETH:", totalWethEarned);
        expect(totalWethEarned).is.greaterThan(0);

        const dataWethNorm = await strategy.normTotalRewardPredictionInWeth(investingPeriod);
        const supplyRewardsWethN = +utils.formatUnits(dataWethNorm[0], rtDecimals);
        const borrowRewardsWethN = +utils.formatUnits(dataWethNorm[1], rtDecimals);
        const supplyUnderlyingProfitWethN = +utils.formatUnits(dataWethNorm[2], rtDecimals);
        const debtUnderlyingCostWethN = +utils.formatUnits(dataWethNorm[3], rtDecimals);
        const foldingProfPerToken = supplyRewardsWeth + borrowRewardsWeth + supplyUnderlyingProfitWeth - debtUnderlyingCostWeth;

        console.log("supplyRewardsWethN:", supplyRewardsWethN, "borrowRewardsWethN:", borrowRewardsWethN);
        console.log("supplyUnderlyingProfitWethN:", supplyUnderlyingProfitWethN, "debtUnderlyingCostWethN:", debtUnderlyingCostWethN);
        console.log("======================================");
        console.log("Total foldingProfPerToken WETH:", foldingProfPerToken);
        expect(foldingProfPerToken).is.greaterThan(0);

        await TimeUtils.advanceBlocksOnTs(investingPeriod);
        // await strategy.claimRewardPublic();

        const underlyingBalanceAfter = +utils.formatUnits(await TokenUtils.balanceOf(aToken, strategy.address), atDecimals);

        console.log("underlyingBalanceAfter: ", underlyingBalanceAfter.toString());

        const debtBalanceAfter = +utils.formatUnits(await TokenUtils.balanceOf(debtToken, strategy.address), dtDecimals);
        console.log("debtBalanceAfter: ", debtBalanceAfter.toString());

        const debtCost = debtBalanceAfter - debtBalanceBefore;
        console.log("debtCost: ", debtCost.toString());
        const rewardsEarned = +utils.formatUnits(await TokenUtils.balanceOf(MaticAddresses.WMATIC_TOKEN, strategy.address), rtDecimals);

        console.log("MATIC earned: ", rewardsEarned.toString());
        const underlyingEarned = underlyingBalanceAfter - underlyingBalanceBefore - debtCost;
        console.log("DAI earned: ", underlyingEarned.toString());

        const rewardProfitPrediction = supplyRewards + borrowRewards;

        console.log("rewardProfitPrediction (MATIC): ", rewardProfitPrediction.toString());

        expect(rewardsEarned).is.approximately(rewardProfitPrediction, rewardProfitPrediction * 0.001, "Prediction of rewards profit is inaccurate")

        console.log("underlyingEarnedPredicted: ", supplyUnderlyingProfit.toString());

        console.log("debtUnderlyingCostPredicted: ", debtUnderlyingCost.toString());

        if (debtCost > 0) {
          supplyUnderlyingProfit = supplyUnderlyingProfit - debtUnderlyingCost;
        }
        expect(supplyUnderlyingProfit).is.approximately(underlyingEarned, underlyingEarned * 0.01, "Prediction of underlying profit is inaccurate");

      });

    });


  });
});