// SPDX-License-Identifier: ISC
/**
* By using this software, you understand, acknowledge and accept that Tetu
* and/or the underlying software are provided “as is” and “as available”
* basis and without warranties or representations of any kind either expressed
* or implied. Any use of this open source software released under the ISC
* Internet Systems Consortium license is done at your own risk to the fullest
* extent permissible pursuant to applicable law any and all liability as well
* as all warranties, including any fitness for a particular purpose with respect
* to Tetu and/or the underlying software and the use thereof are disclaimed.
*/
pragma solidity 0.8.4;

import "@openzeppelin/contracts/utils/math/Math.sol";
import "../../base/governance/Controllable.sol";
import "../../base/interface/ISmartVault.sol";
import "../../base/interface/IStrategy.sol";
import "../../base/interface/IBookkeeper.sol";
import "../../base/interface/IControllableExtended.sol";
import "../../third_party/wault/IWexPolyMaster.sol";
import "../../third_party/sushi/IMiniChefV2.sol";
import "../../third_party/iron/IIronChef.sol";
import "../../third_party/hermes/IIrisMasterChef.sol";
import "../../third_party/synthetix/SNXRewardInterface.sol";
import "../../base/interface/IMasterChefStrategyCafe.sol";
import "../../base/interface/IMasterChefStrategyV1.sol";
import "../../base/interface/IMasterChefStrategyV2.sol";
import "../../base/interface/IMasterChefStrategyV3.sol";
import "../../base/interface/IIronFoldStrategy.sol";
import "../../base/interface/ISNXStrategy.sol";
import "../../base/interface/IStrategyWithPool.sol";
import "../../third_party/cosmic/ICosmicMasterChef.sol";
import "../../third_party/dino/IFossilFarms.sol";
import "../price/IPriceCalculator.sol";
import "./IRewardCalculator.sol";
import "../../third_party/quick/IDragonLair.sol";
import "../../third_party/quick/IStakingDualRewards.sol";
import "../../third_party/iron/IronControllerInterface.sol";
import "../../third_party/iron/CompleteRToken.sol";

/// @title Calculate estimated strategy rewards
/// @author belbix
contract RewardCalculator is Controllable, IRewardCalculator {

  // ************** CONSTANTS *****************************
  /// @notice Version of the contract
  /// @dev Should be incremented when contract changed
  string public constant VERSION = "1.4.1";
  uint256 public constant PRECISION = 1e18;
  uint256 public constant MULTIPLIER_DENOMINATOR = 100;
  uint256 public constant BLOCKS_PER_MINUTE = 2727; // 27.27
  string private constant _CALCULATOR = "calculator";
  address public constant D_QUICK = address(0xf28164A485B0B2C90639E47b0f377b4a438a16B1);
  uint256 private constant _BUY_BACK_DENOMINATOR = 10000;
  uint256 public constant AVG_REWARDS = 7;
  uint256 public constant LAST_EARNED = 3;

  // ************** VARIABLES *****************************
  // !!!!!!!!! DO NOT CHANGE NAMES OR ORDERING!!!!!!!!!!!!!
  mapping(bytes32 => address) internal tools;
  mapping(IStrategy.Platform => uint256) internal platformMultiplier;
  mapping(uint256 => uint256) internal platformMultiplierV2;

  function initialize(address _controller, address _calculator) external initializer {
    Controllable.initializeControllable(_controller);
    tools[keccak256(abi.encodePacked(_CALCULATOR))] = _calculator;
  }

  // ************* MAIN ***********************************

  function priceCalculator() public view returns (IPriceCalculator) {
    return IPriceCalculator(tools[keccak256(abi.encodePacked(_CALCULATOR))]);
  }

  function getPrice(address _token) public view override returns (uint256) {
    return priceCalculator().getPriceWithDefaultOutput(_token);
  }

  function strategyRewardsUsd(address _strategy, uint256 _period) public view override returns (uint256) {
    return rewardBasedOnBuybacks(_strategy) * _period;
  }

  function adjustRewardPerSecond(uint rewardsPerSecond, IStrategy strategy) public view returns (uint) {
    if (strategy.buyBackRatio() < _BUY_BACK_DENOMINATOR) {
      rewardsPerSecond = rewardsPerSecond * strategy.buyBackRatio() / _BUY_BACK_DENOMINATOR;
    }

    uint256 _kpi = kpi(strategy.vault());
    uint256 multiplier = platformMultiplierV2[uint256(strategy.platform())];

    if (_kpi != 0) {
      rewardsPerSecond = rewardsPerSecond * _kpi / PRECISION;
    } else {
      // no rewards for strategies without profit
      return 0;
    }

    if (multiplier != 0) {
      rewardsPerSecond = rewardsPerSecond * multiplier / MULTIPLIER_DENOMINATOR;
    }
    return rewardsPerSecond;
  }

  /// @dev Return recommended USD amount of rewards for this vault based on TVL ratio
  function rewardsPerTvl(address _vault, uint256 _period) public view override returns (uint256) {
    ISmartVault vault = ISmartVault(_vault);
    uint256 rewardAmount = strategyRewardsUsd(vault.strategy(), _period);
    uint256 ratio = vaultTVLRatio(_vault);
    return rewardAmount * ratio / PRECISION;
  }

  function vaultTVLRatio(address _vault) public view override returns (uint256) {
    ISmartVault vault = ISmartVault(_vault);
    uint256 poolTvl = IStrategy(vault.strategy()).poolTotalAmount();
    if (poolTvl == 0) {
      return 0;
    }
    return vault.underlyingBalanceWithInvestment() * PRECISION / poolTvl;
  }

  function rewardPerBlockToPerSecond(uint256 amount) public pure returns (uint256) {
    return amount * BLOCKS_PER_MINUTE / 6000;
  }

  function mcRewardPerSecond(
    uint256 allocPoint,
    uint256 rewardPerSecond,
    uint256 totalAllocPoint
  ) public pure returns (uint256) {
    return rewardPerSecond * allocPoint / totalAllocPoint;
  }

  function kpi(address _vault) public view override returns (uint256) {
    ISmartVault vault = ISmartVault(_vault);
    if (vault.duration() == 0) {
      return 0;
    }

    uint256 lastRewards = vaultLastTetuReward(_vault);
    if (lastRewards == 0) {
      return 0;
    }

    (uint256 earned,) = strategyEarnedSinceLastDistribution(vault.strategy());

    return PRECISION * earned / lastRewards;
  }

  function vaultLastTetuReward(address _vault) public view override returns (uint256) {
    IBookkeeper bookkeeper = IBookkeeper(IController(controller()).bookkeeper());
    ISmartVault ps = ISmartVault(IController(controller()).psVault());
    uint256 rewardsSize = bookkeeper.vaultRewardsLength(_vault, address(ps));
    uint rewardSum = 0;
    if (rewardsSize > 0) {
      uint count = 0;
      for (uint i = 1; i <= Math.min(AVG_REWARDS, rewardsSize); i++) {
        rewardSum += vaultTetuReward(_vault, rewardsSize - i);
        count++;
      }
      return rewardSum / count;
    }
    return 0;
  }

  function vaultTetuReward(address _vault, uint i) public view returns (uint256) {
    IBookkeeper bookkeeper = IBookkeeper(IController(controller()).bookkeeper());
    ISmartVault ps = ISmartVault(IController(controller()).psVault());
    uint amount = bookkeeper.vaultRewards(_vault, address(ps), i);
    // we distributed xTETU, need to calculate approx TETU amount
    // assume that xTETU ppfs didn't change dramatically
    return amount * ps.getPricePerFullShare() / ps.underlyingUnit();
  }

  function strategyEarnedSinceLastDistribution(address strategy)
  public view override returns (uint256 earned, uint256 lastEarnedTs){
    IBookkeeper bookkeeper = IBookkeeper(IController(controller()).bookkeeper());
    uint256 lastEarned = 0;
    lastEarnedTs = 0;
    earned = 0;

    uint256 earnedSize = bookkeeper.strategyEarnedSnapshotsLength(strategy);
    if (earnedSize > 0) {
      lastEarned = bookkeeper.strategyEarnedSnapshots(strategy, earnedSize - 1);
      lastEarnedTs = bookkeeper.strategyEarnedSnapshotsTime(strategy, earnedSize - 1);
    }
    lastEarnedTs = Math.max(lastEarnedTs, IControllableExtended(strategy).created());
    uint256 currentEarned = bookkeeper.targetTokenEarned(strategy);
    if (currentEarned >= lastEarned) {
      earned = currentEarned - lastEarned;
    }
  }

  function strategyEarnedAvg(address strategy)
  public view returns (uint256 earned, uint256 lastEarnedTs){
    IBookkeeper bookkeeper = IBookkeeper(IController(controller()).bookkeeper());
    uint256 lastEarned = 0;
    lastEarnedTs = 0;
    earned = 0;

    uint256 earnedSize = bookkeeper.strategyEarnedSnapshotsLength(strategy);
    uint i = Math.min(earnedSize, LAST_EARNED);
    if (earnedSize > 0) {
      lastEarned = bookkeeper.strategyEarnedSnapshots(strategy, earnedSize - i);
      lastEarnedTs = bookkeeper.strategyEarnedSnapshotsTime(strategy, earnedSize - i);
    }
    lastEarnedTs = Math.max(lastEarnedTs, IControllableExtended(strategy).created());
    uint256 currentEarned = bookkeeper.targetTokenEarned(strategy);
    if (currentEarned >= lastEarned) {
      earned = currentEarned - lastEarned;
    }
  }

  function rewardBasedOnBuybacks(address strategy) public view returns (uint256){
    uint lastHw = IBookkeeper(IController(controller()).bookkeeper()).lastHardWork(strategy).time;
    (uint256 earned, uint256 lastEarnedTs) = strategyEarnedAvg(strategy);
    uint timeDiff = block.timestamp - lastEarnedTs;
    if (lastEarnedTs == 0 || timeDiff == 0 || lastHw == 0 || (block.timestamp - lastHw) > 3 days) {
      return 0;
    }
    uint256 tetuPrice = getPrice(IController(controller()).rewardToken());
    uint earnedUsd = earned * tetuPrice / PRECISION;
    uint rewardsPerSecond = earnedUsd / timeDiff;

    uint256 multiplier = platformMultiplierV2[uint256(IStrategy(strategy).platform())];
    if (multiplier != 0) {
      rewardsPerSecond = rewardsPerSecond * multiplier / MULTIPLIER_DENOMINATOR;
    }
    return rewardsPerSecond;
  }

  // ************* SPECIFIC TO STRATEGY FUNCTIONS *************

  /// @notice Calculate approximately rewards amounts for Wault Swap
  function wault(address _pool, uint256 _poolID) public view returns (uint256) {
    IWexPolyMaster pool = IWexPolyMaster(_pool);
    (, uint256 allocPoint,,) = pool.poolInfo(_poolID);
    return mcRewardPerSecond(
      allocPoint,
      rewardPerBlockToPerSecond(pool.wexPerBlock()),
      pool.totalAllocPoint()
    );
  }

  /// @notice Calculate approximately rewards amounts for Cosmic Swap
  function cosmic(address _pool, uint256 _poolID) public view returns (uint256) {
    ICosmicMasterChef pool = ICosmicMasterChef(_pool);
    ICosmicMasterChef.PoolInfo memory info = pool.poolInfo(_poolID);
    return mcRewardPerSecond(
      info.allocPoint,
      rewardPerBlockToPerSecond(pool.cosmicPerBlock()),
      pool.totalAllocPoint()
    );
  }

  /// @notice Calculate approximately rewards amounts for Dino Swap
  function dino(address _pool, uint256 _poolID) public view returns (uint256) {
    IFossilFarms pool = IFossilFarms(_pool);
    (, uint256 allocPoint,,) = pool.poolInfo(_poolID);
    return mcRewardPerSecond(
      allocPoint,
      rewardPerBlockToPerSecond(pool.dinoPerBlock()),
      pool.totalAllocPoint()
    );
  }

  /// @notice Calculate approximately rewards amounts for SushiSwap
  function miniChefSushi(address _pool, uint256 _poolID) public view returns (uint256) {
    IMiniChefV2 pool = IMiniChefV2(_pool);
    (,, uint256 allocPoint) = pool.poolInfo(_poolID);
    return mcRewardPerSecond(
      allocPoint,
      pool.sushiPerSecond(),
      pool.totalAllocPoint()
    );
  }

  /// @notice Calculate approximately rewards amounts for Sushi rewarder
  function mcRewarder(address _pool, uint256 _poolID) public view returns (uint256) {
    IMiniChefV2 pool = IMiniChefV2(_pool);
    IRewarder rewarder = pool.rewarder(_poolID);
    (,, uint256 allocPoint) = rewarder.poolInfo(_poolID);
    return mcRewardPerSecond(
      allocPoint,
      rewarder.rewardPerSecond(), // totalAllocPoint is not public so assume that it is the same as MC
      pool.totalAllocPoint()
    );
  }

  /// @notice Calculate approximately reward amounts for Iron MC
  function ironMc(address _pool, uint256 _poolID) public view returns (uint256) {
    IIronChef.PoolInfo memory poolInfo = IIronChef(_pool).poolInfo(_poolID);
    return mcRewardPerSecond(
      poolInfo.allocPoint,
      IIronChef(_pool).rewardPerSecond(),
      IIronChef(_pool).totalAllocPoint()
    );
  }

  /// @notice Calculate approximately reward amounts for HERMES
  function hermes(address _pool, uint256 _poolID) public view returns (uint256) {
    IIrisMasterChef pool = IIrisMasterChef(_pool);
    (, uint256 allocPoint,,,,) = pool.poolInfo(_poolID);
    return mcRewardPerSecond(
      allocPoint,
      rewardPerBlockToPerSecond(pool.irisPerBlock()),
      pool.totalAllocPoint()
    );
  }

  /// @notice Calculate approximately reward amounts for Cafe swap
  function cafe(address _pool, uint256 _poolID) public view returns (uint256) {
    ICafeMasterChef pool = ICafeMasterChef(_pool);
    ICafeMasterChef.PoolInfo memory info = pool.poolInfo(_poolID);
    return mcRewardPerSecond(
      info.allocPoint,
      rewardPerBlockToPerSecond(pool.brewPerBlock()),
      pool.totalAllocPoint()
    );
  }

  /// @notice Calculate approximately reward amounts for Quick swap
  function quick(address _pool) public view returns (uint256) {
    if (SNXRewardInterface(_pool).periodFinish() < block.timestamp) {
      return 0;
    }
    uint256 dQuickRatio = IDragonLair(D_QUICK).QUICKForDQUICK(PRECISION);
    return SNXRewardInterface(_pool).rewardRate() * dQuickRatio / PRECISION;
  }

  /// @notice Calculate approximately reward amounts for Quick swap
  function quickDualFarm(address _pool) public view returns (uint256) {
    if (IStakingDualRewards(_pool).periodFinish() < block.timestamp) {
      return 0;
    }
    uint256 dQuickRatio = IDragonLair(D_QUICK).QUICKForDQUICK(PRECISION);
    return IStakingDualRewards(_pool).rewardRateA() * dQuickRatio / PRECISION;
  }

  function ironLending(IStrategy strategy) public view returns (uint256) {
    address iceToken = strategy.rewardTokens()[0];
    address rToken = IIronFoldStrategy(address(strategy)).rToken();
    address controller = IIronFoldStrategy(address(strategy)).ironController();

    uint icePrice = getPrice(iceToken);
    uint undPrice = getPrice(strategy.underlying());

    uint8 undDecimals = CompleteRToken(strategy.underlying()).decimals();

    uint256 rTokenExchangeRate = CompleteRToken(rToken).exchangeRateStored();

    uint256 totalSupply = CompleteRToken(rToken).totalSupply() * rTokenExchangeRate
    / (10 ** undDecimals);

    uint suppliedRate = CompleteRToken(rToken).supplyRatePerBlock() * undPrice * totalSupply / (PRECISION ** 2);
    // ICE rewards
    uint rewardSpeed = IronControllerInterface(controller).rewardSpeeds(rToken) * icePrice / PRECISION;
    // regarding folding we will earn x2.45
    rewardSpeed = rewardSpeed * 245 / 100;
    return rewardPerBlockToPerSecond(rewardSpeed + suppliedRate);
  }

  // *********** GOVERNANCE ACTIONS *****************

  function setPriceCalculator(address newValue) external onlyControllerOrGovernance {
    tools[keccak256(abi.encodePacked(_CALCULATOR))] = newValue;
    emit ToolAddressUpdated(_CALCULATOR, newValue);
  }

  function setPlatformMultiplier(uint256 _platform, uint256 _value) external onlyControllerOrGovernance {
    require(_value < MULTIPLIER_DENOMINATOR * 10, "RC: Too high value");
    platformMultiplierV2[_platform] = _value;
  }
}
