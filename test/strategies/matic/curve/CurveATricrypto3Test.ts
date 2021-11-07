import chai from "chai";
import chaiAsPromised from "chai-as-promised";
import {MaticAddresses} from "../../../MaticAddresses";
import {UniswapUtils} from "../../../UniswapUtils";
import {utils} from "ethers";
import {ethers} from "hardhat";
import {TokenUtils} from "../../../TokenUtils";
import {StrategyInfo} from "../../StrategyInfo";
import {TimeUtils} from "../../../TimeUtils";
import {DeployerUtils} from "../../../../scripts/deploy/DeployerUtils";
import {StrategyTestUtils} from "../../StrategyTestUtils";
import {DoHardWorkLoop} from "../../DoHardWorkLoop";
import {CurveDoHardWorkLoop} from "./utils/CurveDoHardWorkLoop";
import {CurveUtils} from "./utils/CurveUtils";
import {config as dotEnvConfig} from "dotenv";

dotEnvConfig();
// tslint:disable-next-line:no-var-requires
const argv = require('yargs/yargs')()
.env('TETU')
.options({
  disableStrategyTests: {
    type: "boolean",
    default: false,
  },
}).argv;

chai.use(chaiAsPromised);

describe.skip('Curve aTricrypto3 tests', async () => {
  if (argv.disableStrategyTests) {
    return;
  }
  let snapshotBefore: string;
  let snapshot: string;
  let strategyInfo: StrategyInfo;

  before(async function () {
    snapshotBefore = await TimeUtils.snapshot();
    const [signer, investor, trader] = (await ethers.getSigners());
    const coreContracts = await DeployerUtils.deployAllCoreContracts(
        signer, 60 * 60 * 24 * 28, 1);
    const calculator = (await DeployerUtils.deployPriceCalculatorMatic(
        signer, coreContracts.controller.address))[0];

    const underlying = MaticAddresses.BTCCRV_TOKEN;

    const underlyingName = await TokenUtils.tokenSymbol(underlying);

    const strategyName = 'CurveATriCrypto3Strategy';

    await CurveUtils.configureFeeRewardForwarder(coreContracts.feeRewardForwarder, coreContracts.rewardToken);

    const [vault, strategy, lpForTargetToken] = await StrategyTestUtils.deployStrategy(
        strategyName, signer, coreContracts, underlying, underlyingName);

    strategyInfo = new StrategyInfo(
        underlying,
        signer,
        investor,
        coreContracts,
        vault,
        strategy,
        lpForTargetToken,
        calculator
    );

    // swap tokens to invest
    await UniswapUtils.getTokenFromHolder(
        trader, MaticAddresses.SUSHI_ROUTER, MaticAddresses.WMATIC_TOKEN, utils.parseUnits('1000000'));
    await UniswapUtils.getTokenFromHolder(
        trader, MaticAddresses.SUSHI_ROUTER, MaticAddresses.USDC_TOKEN, utils.parseUnits('1000000'));

    await CurveUtils.addLiquidityTrirypto(investor);

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

  it("doHardWork loop with liq path", async () => {
    await CurveDoHardWorkLoop.doHardWorkWithLiqPath(strategyInfo);
  });

  it("doHardWork loop", async function () {
    await DoHardWorkLoop.doHardWorkLoop(
        strategyInfo,
        (await TokenUtils.balanceOf(strategyInfo.underlying, strategyInfo.user.address)).toString(),
        3,
        27000
    );
  });

  it("emergency exit", async () => {
    await StrategyTestUtils.checkEmergencyExit(strategyInfo);
  });

  it("common test should be ok", async () => {
    await StrategyTestUtils.commonTests(strategyInfo);
  });


});