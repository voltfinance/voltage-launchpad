// SPDX-License-Identifier: MIT

pragma solidity 0.8.6;

import "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/IERC20MetadataUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "./interfaces/ILaunchEventFactory.sol";
import "./interfaces/IVoltageFactory.sol";
import "./interfaces/IVoltagePair.sol";
import "./interfaces/IVoltageRouter.sol";
import "./interfaces/IVeVolt.sol";

interface Ownable {
    function owner() external view returns (address);
}

/// @title Launch Event
/// @author Voltage
/// @notice A liquidity launch contract enabling price discovery and token distribution at secondary market listing price
contract LaunchEvent {
    using SafeERC20Upgradeable for IERC20MetadataUpgradeable;
    using SafeERC20 for IERC20;

    /// @notice The phases the launch event can be in
    /// @dev Should these have more semantic names: Bid, Cancel, Withdraw
    enum Phase {
        NotStarted,
        PhaseOne,
        PhaseTwo,
        PhaseThree
    }

    struct UserInfo {
        /// @notice How much Volt user can deposit for this launch event
        /// @dev Can be increased by locking more veVolt, but will always be
        /// smaller than or equal to `maxAllocation`
        uint256 allocation;
        /// @notice How much Volt user has deposited for this launch event
        uint256 balance;
        /// @notice Whether user has withdrawn the LP
        bool hasWithdrawnPair;
        /// @notice Whether user has withdrawn the issuing token incentives
        bool hasWithdrawnIncentives;
    }

    /// @notice Issuer of sale tokens
    address public issuer;

    /// @notice The start time of phase 1
    uint256 public auctionStart;

    uint256 public phaseOneDuration;
    uint256 public phaseOneNoFeeDuration;
    uint256 public phaseTwoDuration;

    /// @dev Amount of tokens used as incentives for locking up LPs during phase 3,
    /// in parts per 1e18 and expressed as an additional percentage to the tokens for auction.
    /// E.g. if tokenIncentivesPercent = 5e16 (5%), and issuer sends 105 000 tokens,
    /// then 105 000 * 5e16 / (1e18 + 5e16) = 5 000 tokens are used for incentives
    uint256 public tokenIncentivesPercent;

    /// @notice Floor price in Volt per token (can be 0)
    /// @dev floorPrice is scaled to 1e18
    uint256 public floorPrice;

    /// @notice Timelock duration post phase 3 when can user withdraw their LP tokens
    uint256 public userTimelock;

    /// @notice Timelock duration post phase 3 When can issuer withdraw their LP tokens
    uint256 public issuerTimelock;

    /// @notice The max withdraw penalty during phase 1, in parts per 1e18
    /// e.g. max penalty of 50% `maxWithdrawPenalty`= 5e17
    uint256 public maxWithdrawPenalty;

    /// @notice The fixed withdraw penalty during phase 2, in parts per 1e18
    /// e.g. fixed penalty of 20% `fixedWithdrawPenalty = 2e17`
    uint256 public fixedWithdrawPenalty;

    IERC20 public volt;
    IVeVolt public veVolt;
    uint256 public veVoltPerVolt;
    IERC20MetadataUpgradeable public token;

    ILaunchEventFactory private launchEventFactory;
    IVoltageRouter private router;
    IVoltageFactory private factory;

    bool public stopped;

    uint256 public maxUnstakedUserAllocation;
    
    uint256 public maxStakedUserAllocation;

    mapping(address => UserInfo) public getUserInfo;

    /// @dev The address of the VoltagePair, set after createLiquidityPool is called
    IVoltagePair public pair;

    /// @dev The total amount of volt that was sent to the router to create the initial liquidity pair.
    /// Used to calculate the amount of LP to send based on the user's participation in the launch event
    uint256 public voltAllocated;

    /// @dev The total amount of tokens that was sent to the router to create the initial liquidity pair.
    uint256 public tokenAllocated;

    /// @dev The exact supply of LP minted when creating the initial liquidity pair.
    uint256 private lpSupply;

    /// @dev Used to know how many issuing tokens will be sent to JoeRouter to create the initial
    /// liquidity pair. If floor price is not met, we will send fewer issuing tokens and `tokenReserve`
    /// will keep track of the leftover amount. It's then used to calculate the number of tokens needed
    /// to be sent to both issuer and users (if there are leftovers and every token is sent to the pair,
    /// tokenReserve will be equal to 0)
    uint256 private tokenReserve;

    /// @dev Keeps track of amount of token incentives that needs to be kept by contract in order to send the right
    /// amounts to issuer and users
    uint256 private tokenIncentivesBalance;
    /// @dev Total incentives for users for locking their LPs for an additional period of time after the pair is created
    uint256 private tokenIncentivesForUsers;
    /// @dev The share refunded to the issuer. Users receive 5% of the token that were sent to the Router.
    /// If the floor price is not met, the incentives still needs to be 5% of the value sent to the Router, so there
    /// will be an excess of tokens returned to the issuer if he calls `withdrawIncentives()`
    uint256 private tokenIncentiveIssuerRefund;

    /// @dev avaxReserve is the exact amount of AVAX that needs to be kept inside the contract in order to send everyone's
    /// AVAX. If there is some excess (because someone sent token directly to the contract), the
    /// penaltyCollector can collect the excess using `skim()`
    uint256 private voltReserve;

    event LaunchEventInitialized(
        uint256 tokenIncentivesPercent,
        uint256 floorPrice,
        uint256 maxWithdrawPenalty,
        uint256 fixedWithdrawPenalty,
        uint256 maxUnstakedUserAllocation,
        uint256 maxStakedUserAllocation,
        uint256 userTimelock,
        uint256 issuerTimelock,
        uint256 tokenReserve,
        uint256 tokenIncentives
    );

    event UserParticipated(
        address indexed user,
        uint256 voltAmount
    );

    event UserWithdrawn(
        address indexed user,
        uint256 avaxAmount,
        uint256 penaltyAmount
    );

    event IncentiveTokenWithdraw(
        address indexed user,
        address indexed token,
        uint256 amount
    );

    event LiquidityPoolCreated(
        address indexed pair,
        address indexed token0,
        address indexed token1,
        uint256 amount0,
        uint256 amount1
    );

    event UserLiquidityWithdrawn(
        address indexed user,
        address indexed pair,
        uint256 amount
    );

    event IssuerLiquidityWithdrawn(
        address indexed issuer,
        address indexed pair,
        uint256 amount
    );

    event Stopped();

    event VoltEmergencyWithdraw(address indexed user, uint256 amount);

    event TokenEmergencyWithdraw(address indexed user, uint256 amount);

    /// @notice Modifier which ensures contract is in a defined phase
    modifier atPhase(Phase _phase) {
        _atPhase(_phase);
        _;
    }

    /// @notice Modifier which ensures the caller's timelock to withdraw has elapsed
    modifier timelockElapsed() {
        _timelockElapsed();
        _;
    }

    /// @notice Ensures launch event is stopped/running
    modifier isStopped(bool _stopped) {
        _isStopped(_stopped);
        _;
    }

    /// @notice Initialize the launch event with needed parameters
    /// @param _issuer Address of the token issuer
    /// @param _auctionStart The start time of the auction
    /// @param _token The contract address of auctioned token
    /// @param _tokenIncentivesPercent The token incentives percent, in part per 1e18, e.g 5e16 is 5% of incentives
    /// @param _floorPrice The minimum price the token is sold at
    /// @param _maxWithdrawPenalty The max withdraw penalty during phase 1, in parts per 1e18
    /// @param _fixedWithdrawPenalty The fixed withdraw penalty during phase 2, in parts per 1e18
    /// @param _maxUnstakedUserAllocation The maximum amount of VOLT depositable per unstaked user
    /// @param _maxStakedUserAllocation The maximum amount of VOLT depositable per staked user
    /// @param _userTimelock The time a user must wait after auction ends to withdraw liquidity
    /// @param _issuerTimelock The time the issuer must wait after auction ends to withdraw liquidity
    /// @dev This function is called by the factory immediately after it creates the contract instance
    function initialize(
        address _issuer,
        uint256 _auctionStart,
        address _token,
        uint256 _tokenIncentivesPercent,
        uint256 _floorPrice,
        uint256 _maxWithdrawPenalty,
        uint256 _fixedWithdrawPenalty,
        uint256 _maxUnstakedUserAllocation,
        uint256 _maxStakedUserAllocation,
        uint256 _userTimelock,
        uint256 _issuerTimelock
    ) external atPhase(Phase.NotStarted) {
        require(auctionStart == 0, "LaunchEvent: already initialized");
        launchEventFactory = ILaunchEventFactory(msg.sender);
        require(
            _token != launchEventFactory.volt(),
            "LaunchEvent: token is volt"
        );

        router = IVoltageRouter(launchEventFactory.router());
        factory = IVoltageFactory(launchEventFactory.factory());
        volt = IERC20(launchEventFactory.volt());
        veVolt = IVeVolt(launchEventFactory.veVolt());
        veVoltPerVolt = launchEventFactory.veVoltPerVolt();

        require(
            _maxWithdrawPenalty <= 5e17,
            "LaunchEvent: maxWithdrawPenalty too big"
        ); // 50%
        require(
            _fixedWithdrawPenalty <= 5e17,
            "LaunchEvent: fixedWithdrawPenalty too big"
        ); // 50%
        require(
            _userTimelock <= 7 days,
            "LaunchEvent: can't lock user LP for more than 7 days"
        );
        require(
            _issuerTimelock > _userTimelock,
            "LaunchEvent: issuer can't withdraw before users"
        );
        require(
            _auctionStart > block.timestamp,
            "LaunchEvent: start of phase 1 cannot be in the past"
        );
        require(
            _issuer != address(0),
            "LaunchEvent: issuer must be address zero"
        );
        require(
            _maxStakedUserAllocation > 0,
            "LaunchEvent: max staked user allocation must not be zero"
        );
        require(
            _maxUnstakedUserAllocation > 0,
            "LaunchEvent: max unstaked user allocation must not be zero"
        );
        require(
            _tokenIncentivesPercent < 1 ether,
            "LaunchEvent: token incentives too high"
        );

        issuer = _issuer;

        auctionStart = _auctionStart;
        phaseOneDuration = launchEventFactory.phaseOneDuration();
        phaseOneNoFeeDuration = launchEventFactory.phaseOneNoFeeDuration();
        phaseTwoDuration = launchEventFactory.phaseTwoDuration();

        token = IERC20MetadataUpgradeable(_token);
        uint256 balance = token.balanceOf(address(this));

        tokenIncentivesPercent = _tokenIncentivesPercent;

        /// We do this math because `tokenIncentivesForUsers + tokenReserve = tokenSent`
        /// and `tokenIncentivesForUsers = tokenReserve * 0.05` (i.e. incentives are 5% of reserves for issuing).
        /// E.g. if issuer sends 105e18 tokens, `tokenReserve = 100e18` and `tokenIncentives = 5e18`
        tokenReserve = (balance * 1e18) / (1e18 + _tokenIncentivesPercent);
        require(tokenReserve > 0, "LaunchEvent: no token balance");
        tokenIncentivesForUsers = balance - tokenReserve;
        tokenIncentivesBalance = tokenIncentivesForUsers;

        floorPrice = _floorPrice;

        maxWithdrawPenalty = _maxWithdrawPenalty;
        fixedWithdrawPenalty = _fixedWithdrawPenalty;

        maxStakedUserAllocation = _maxStakedUserAllocation;
        maxUnstakedUserAllocation = _maxUnstakedUserAllocation;

        userTimelock = _userTimelock;
        issuerTimelock = _issuerTimelock;

        emit LaunchEventInitialized(
            tokenIncentivesPercent,
            floorPrice,
            maxWithdrawPenalty,
            fixedWithdrawPenalty,
            maxUnstakedUserAllocation,
            maxStakedUserAllocation,
            userTimelock,
            issuerTimelock,
            tokenReserve,
            tokenIncentivesBalance
        );
    }

    /// @notice The current phase the auction is in
    function currentPhase() public view returns (Phase) {
        if (auctionStart == 0 || block.timestamp < auctionStart) {
            return Phase.NotStarted;
        } else if (block.timestamp < auctionStart + phaseOneDuration) {
            return Phase.PhaseOne;
        } else if (
            block.timestamp < auctionStart + phaseOneDuration + phaseTwoDuration
        ) {
            return Phase.PhaseTwo;
        }
        return Phase.PhaseThree;
    }

    /// @notice Deposits Volt
    function deposit(
        uint256 _amount
    )
        external
        isStopped(false)
        atPhase(Phase.PhaseOne)
    {
        require(msg.sender != issuer, "LaunchEvent: issuer cannot participate");
        require(
            _amount > 0,
            "LaunchEvent: expected non-zero Volt to deposit"
        );

        UserInfo storage user = getUserInfo[msg.sender];
        uint256 newAllocation = user.balance + _amount;

        uint256 userAllocation = getAllocation(msg.sender);
        require(
            newAllocation <= userAllocation,
            "LaunchEvent: amount exceeds user allocation"
        );

        uint256 maxAllocation = getMaxAllocation(msg.sender);
        require(
            newAllocation <= maxAllocation,
            "LaunchEvent: amount exceeds max allocation"
        );

        volt.safeTransferFrom(msg.sender, address(this), _amount);

        user.balance = newAllocation;
        voltReserve += _amount;

        emit UserParticipated(msg.sender, _amount);
    }

    /// @notice Withdraw Volt, only permitted during phase 1 and 2
    /// @param _amount The amount of Volt to withdraw
    function withdraw(uint256 _amount) external isStopped(false) {
        Phase _currentPhase = currentPhase();
        require(
            _currentPhase == Phase.PhaseOne || _currentPhase == Phase.PhaseTwo,
            "LaunchEvent: unable to withdraw"
        );
        require(_amount > 0, "LaunchEvent: invalid withdraw amount");
        UserInfo storage user = getUserInfo[msg.sender];
        require(
            user.balance >= _amount,
            "LaunchEvent: withdrawn amount exceeds balance"
        );
        user.balance -= _amount;

        uint256 feeAmount = (_amount * getPenalty()) / 1e18;
        uint256 amountMinusFee = _amount - feeAmount;

        voltReserve -= _amount;

        if (feeAmount > 0) {
            volt.safeTransfer(launchEventFactory.penaltyCollector(), feeAmount);
        }
        volt.safeTransfer(msg.sender, amountMinusFee);
        emit UserWithdrawn(msg.sender, _amount, feeAmount);
    }

    /// @notice Create the VoltPair
    /// @dev Can only be called once after phase 3 has started
    function createPair() external isStopped(false) atPhase(Phase.PhaseThree) {
        (address voltAddress, address tokenAddress) = (
            address(volt),
            address(token)
        );
        address _pair = factory.getPair(voltAddress, tokenAddress);
        require(
            _pair == address(0) || IVoltagePair(_pair).totalSupply() == 0,
            "LaunchEvent: liquid pair already exists"
        );
        require(voltReserve > 0, "LaunchEvent: no volt balance");

        uint256 tokenDecimals = token.decimals();
        tokenAllocated = tokenReserve;

        // Adjust the amount of tokens sent to the pool if floor price not met
        if (floorPrice > (voltReserve * 10**tokenDecimals) / tokenAllocated) {
            tokenAllocated = (voltReserve * 10**tokenDecimals) / floorPrice;
            tokenIncentivesForUsers =
                (tokenIncentivesForUsers * tokenAllocated) /
                tokenReserve;
            tokenIncentiveIssuerRefund =
                tokenIncentivesBalance -
                tokenIncentivesForUsers;
        }

        voltAllocated = voltReserve;
        voltReserve = 0;

        tokenReserve -= tokenAllocated;

        if (_pair == address(0)) {
            pair = IVoltagePair(factory.createPair(voltAddress, tokenAddress));
        } else {
            pair = IVoltagePair(_pair);
        }
        volt.safeTransfer(address(pair), voltAllocated);
        token.safeTransfer(address(pair), tokenAllocated);
        lpSupply = pair.mint(address(this));

        emit LiquidityPoolCreated(
            address(pair),
            tokenAddress,
            voltAddress,
            tokenAllocated,
            voltAllocated
        );
    }

    /// @notice Withdraw liquidity pool tokens
    function withdrawLiquidity() external isStopped(false) timelockElapsed {
        require(address(pair) != address(0), "LaunchEvent: pair not created");

        UserInfo storage user = getUserInfo[msg.sender];

        uint256 balance = pairBalance(msg.sender);
        require(balance > 0, "LaunchEvent: caller has no liquidity to claim");

        user.hasWithdrawnPair = true;

        if (msg.sender == issuer) {
            emit IssuerLiquidityWithdrawn(msg.sender, address(pair), balance);
        } else {
            emit UserLiquidityWithdrawn(msg.sender, address(pair), balance);
        }

        pair.transfer(msg.sender, balance);
    }

    /// @notice Withdraw incentives tokens
    function withdrawIncentives() external {
        require(address(pair) != address(0), "LaunchEvent: pair not created");

        uint256 amount = getIncentives(msg.sender);
        require(amount > 0, "LaunchEvent: caller has no incentive to claim");

        UserInfo storage user = getUserInfo[msg.sender];
        user.hasWithdrawnIncentives = true;

        if (msg.sender == issuer) {
            tokenIncentivesBalance -= tokenIncentiveIssuerRefund;
            tokenReserve = 0;
        } else {
            tokenIncentivesBalance -= amount;
        }

        token.safeTransfer(msg.sender, amount);
        emit IncentiveTokenWithdraw(msg.sender, address(token), amount);
    }

    /// @notice Withdraw VOLT if launch has been cancelled
    function emergencyWithdraw() external isStopped(true) {
        if (address(pair) == address(0)) {
            if (msg.sender != issuer) {
                UserInfo storage user = getUserInfo[msg.sender];
                require(
                    user.balance > 0,
                    "LaunchEvent: expected user to have non-zero balance to perform emergency withdraw"
                );

                uint256 balance = user.balance;
                user.balance = 0;
                voltReserve -= balance;

                volt.safeTransfer(msg.sender, balance);

                emit VoltEmergencyWithdraw(msg.sender, balance);
            } else {
                uint256 balance = tokenReserve + tokenIncentivesBalance;
                tokenReserve = 0;
                tokenIncentivesBalance = 0;
                token.safeTransfer(issuer, balance);
                emit TokenEmergencyWithdraw(msg.sender, balance);
            }
        } else {
            UserInfo storage user = getUserInfo[msg.sender];

            uint256 balance = pairBalance(msg.sender);
            require(
                balance > 0,
                "LaunchEvent: caller has no liquidity to claim"
            );

            user.hasWithdrawnPair = true;

            if (msg.sender == issuer) {
                emit IssuerLiquidityWithdrawn(
                    msg.sender,
                    address(pair),
                    balance
                );
            } else {
                emit UserLiquidityWithdrawn(msg.sender, address(pair), balance);
            }

            pair.transfer(msg.sender, balance);
        }
    }

    /// @notice Stops the launch event and allows participants to withdraw deposits
    function allowEmergencyWithdraw() external {
        require(
            msg.sender == Ownable(address(launchEventFactory)).owner(),
            "LaunchEvent: caller is not LaunchEventFactory owner"
        );
        stopped = true;
        emit Stopped();
    }

    /// @notice Force balances to match tokens that were deposited, but not sent directly to the contract.
    /// Any excess tokens are sent to the penaltyCollector
    function skim() external {
        require(msg.sender == tx.origin, "LaunchEvent: EOA only");
        address penaltyCollector = launchEventFactory.penaltyCollector();

        uint256 excessToken = token.balanceOf(address(this)) -
            tokenReserve -
            tokenIncentivesBalance;
        if (excessToken > 0) {
            token.safeTransfer(penaltyCollector, excessToken);
        }

        uint256 excessVolt = address(this).balance - voltReserve;
        if (excessVolt > 0) {
            volt.safeTransfer(penaltyCollector, excessVolt);
        }
    }

    /// @notice Returns the current penalty for early withdrawal
    /// @return The penalty to apply to a withdrawal amount
    function getPenalty() public view returns (uint256) {
        if (block.timestamp < auctionStart) {
            return 0;
        }
        uint256 timeElapsed = block.timestamp - auctionStart;
        if (timeElapsed < phaseOneNoFeeDuration) {
            return 0;
        } else if (timeElapsed < phaseOneDuration) {
            return
                ((timeElapsed - phaseOneNoFeeDuration) * maxWithdrawPenalty) /
                (phaseOneDuration - phaseOneNoFeeDuration);
        }
        return fixedWithdrawPenalty;
    }

    /// @notice Returns the incentives for a given user
    /// @param _user The user to look up
    /// @return The amount of incentives `_user` can withdraw
    function getIncentives(address _user) public view returns (uint256) {
        UserInfo memory user = getUserInfo[_user];

        if (user.hasWithdrawnIncentives) {
            return 0;
        }

        if (_user == issuer) {
            if (address(pair) == address(0)) return 0;
            return tokenIncentiveIssuerRefund + tokenReserve;
        } else {
            if (voltAllocated == 0) return 0;
            return (user.balance * tokenIncentivesForUsers) / voltAllocated;
        }
    }

    /// @notice Returns the outstanding balance of the launch event contract
    /// @return The balances of VOLT and issued token held by the launch contract
    function getReserves() external view returns (uint256, uint256) {
        return (voltReserve, tokenReserve + tokenIncentivesBalance);
    }

    function isUserStaked(address user) public view returns (bool) {
        uint256 veVoltBalance = IVeVolt(veVolt).balanceOf(user, auctionStart);
        return veVoltBalance > 0;
    }

    function getAllocation(address user) public view returns (uint256) {
        uint256 veVoltBalance = IVeVolt(veVolt).balanceOf(user, auctionStart);
        uint256 stakedUserAllocation = Math.min(veVoltBalance * veVoltPerVolt, maxStakedUserAllocation);
        return isUserStaked(user) ? stakedUserAllocation : maxUnstakedUserAllocation;
    }

    function getMaxAllocation(address user) public view returns (uint256) {
        return isUserStaked(user) ? maxStakedUserAllocation : maxUnstakedUserAllocation;
    }

    /// @notice The total amount of liquidity pool tokens the user can withdraw
    /// @param _user The address of the user to check
    /// @return The user's balance of liquidity pool token
    function pairBalance(address _user) public view returns (uint256) {
        UserInfo memory user = getUserInfo[_user];
        if (voltAllocated == 0 || user.hasWithdrawnPair) {
            return 0;
        }
        if (msg.sender == issuer) {
            return lpSupply / 2;
        }
        return (user.balance * lpSupply) / voltAllocated / 2;
    }

    /// @dev Bytecode size optimization for the `atPhase` modifier
    /// This works becuase internal functions are not in-lined in modifiers
    function _atPhase(Phase _phase) internal view {
        require(currentPhase() == _phase, "LaunchEvent: wrong phase");
    }

    /// @dev Bytecode size optimization for the `timelockElapsed` modifier
    /// This works becuase internal functions are not in-lined in modifiers
    function _timelockElapsed() internal view {
        uint256 phase3Start = auctionStart +
            phaseOneDuration +
            phaseTwoDuration;
        if (msg.sender == issuer) {
            require(
                block.timestamp > phase3Start + issuerTimelock,
                "LaunchEvent: can't withdraw before issuer's timelock"
            );
        } else {
            require(
                block.timestamp > phase3Start + userTimelock,
                "LaunchEvent: can't withdraw before user's timelock"
            );
        }
    }

    /// @dev Bytecode size optimization for the `isStopped` modifier
    /// This works becuase internal functions are not in-lined in modifiers
    function _isStopped(bool _stopped) internal view {
        if (_stopped) {
            require(stopped, "LaunchEvent: is still running");
        } else {
            require(!stopped, "LaunchEvent: stopped");
        }
    }
}
