// SPDX-License-Identifier: MIT

pragma solidity 0.8.6;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

import "./interfaces/ILaunchEventFactory.sol";
import "./interfaces/IVoltageFactory.sol";
import "./interfaces/IVoltagePair.sol";
import "./interfaces/ILaunchEvent.sol";

/// @title LaunchEvent Factory
/// @author Voltage
/// @notice Factory that creates launchpad events
contract LaunchEventFactory is
    ILaunchEventFactory,
    Initializable,
    OwnableUpgradeable
{
    using SafeERC20 for IERC20;

    address public override penaltyCollector;
    address public override eventImplementation;

    address public override veVolt;
    uint256 public override veVoltPerVolt;
    address public override volt;
    address public override router;
    address public override factory;

    uint256 public override phaseOneDuration;
    uint256 public override phaseOneNoFeeDuration;
    uint256 public override phaseTwoDuration;

    mapping(address => address) public override getLaunchEvent;
    mapping(address => bool) public override isLaunchEvent;
    address[] public override allLaunchEvents;

    /// @notice initializes the launch event factory
    /// @dev Uses clone factory pattern to save space
    /// @param _eventImplementation Implementation of launch event contract
    /// @param _veVolt veVolt token address
    /// @param _volt volt token address
    /// @param _penaltyCollector Address that collects all withdrawal penalties
    /// @param _router Router used to create LP on Voltage AMM
    /// @param _factory Factory used to get info of Voltage Pairs
    function initialize(
        address _eventImplementation,
        address _veVolt,
        address _volt,
        address _penaltyCollector,
        address _router,
        address _factory
    ) public initializer {
        __Ownable_init();
        require(
            _eventImplementation != address(0),
            "LaunchEventFactory: event implentation can't be zero address"
        );
        require(_veVolt != address(0), "LaunchEventFactory: veVolt can't be zero address");
        require(_volt != address(0), "LaunchEventFactory: volt can't be zero address");
        require(
            _penaltyCollector != address(0),
            "LaunchEventFactory: penalty collector can't be zero address"
        );
        require(
            _router != address(0),
            "LaunchEventFactory: router can't be zero address"
        );
        require(
            _factory != address(0),
            "LaunchEventFactory: factory can't be zero address"
        );

        eventImplementation = _eventImplementation;
        veVolt = _veVolt;

        volt = _volt;
        penaltyCollector = _penaltyCollector;
        router = _router;
        factory = _factory;
        veVoltPerVolt = 1e18;

        phaseOneDuration = 2 days;
        phaseOneNoFeeDuration = 1 days;
        phaseTwoDuration = 1 days;
    }

    /// @notice Returns the number of launch events
    /// @return The number of launch events ever created
    function numLaunchEvents() external view override returns (uint256) {
        return allLaunchEvents.length;
    }

    // / @notice Creates a launch event contract
    // / @param _issuer Address of the project issuing tokens for auction
    // / @param _phaseOneStartTime Timestamp of when launch event will start
    // / @param _token Token that will be issued through this launch event
    // / @param _tokenAmountIncludingIncentives Amount of tokens that will be issued
    // / @param _tokenIncentivesPercent Additional tokens that will be given as
    // / incentive for locking up LPs during phase 3 expressed as a percentage
    // / of the issuing tokens for sale, scaled to 1e18
    // / @param _tokenIncentivesPercent is the percentage of the issued tokens for sale that will be used as incentives for locking the LP during phase 3.
    // / These incentives are on top of the tokens for sale.
    // / For example, if we issue 100 tokens for sale and 5% of incentives, then 5 tokens will be given as incentives and in total the contract should have 105 tokens
    // / @param _floorPrice Price of each token in AVAX, scaled to 1e18
    // / @param _maxWithdrawPenalty Maximum withdrawal penalty that can be met
    // / during phase 1
    // / @param _fixedWithdrawPenalty Withdrawal penalty during phase 2
    // / @param _maxUnstakedUserAllocation Maximum number of VOLT each unstaked participant can commit
    // / @param _maxStakedUserAllocation Maximum number of VOLT each staked participant can commit
    // / @param _userTimelock Amount of time users' LPs will be locked for
    // / during phase 3
    // / @param _issuerTimelock Amount of time issuer's LP will be locked for
    // / during phase 3
    // / @return Address of launch event contract
    function createLaunchEvent(LaunchParams memory params) external override onlyOwner returns (address) {
        require(
            getLaunchEvent[params.token] == address(0),
            "LaunchEventFactory: token has already been issued"
        );
        require(params.issuer != address(0), "LaunchEventFactory: issuer can't be 0 address");
        require(params.token != address(0), "LaunchEventFactory: token can't be 0 address");
        require(params.token != volt, "LaunchEventFactory: token can't be volt");
        require(
            params.tokenAmountIncludingIncentives > 0,
            "LaunchEventFactory: token amount including incentives needs to be greater than 0"
        );

        // avoids stack too deep error
        {
            address pair = IVoltageFactory(factory).getPair(params.token, volt);
            require(
                pair == address(0) || IVoltagePair(pair).totalSupply() == 0,
                "LaunchEventFactory: liquid pair already exists"
            );
        }

        address launchEvent = Clones.clone(eventImplementation);

        getLaunchEvent[params.token] = launchEvent;
        isLaunchEvent[launchEvent] = true;
        allLaunchEvents.push(launchEvent);

        // msg.sender needs to approve LaunchpadFactory
        IERC20(params.token).safeTransferFrom(
            msg.sender,
            launchEvent,
            params.tokenAmountIncludingIncentives
        );

        emit IssuingTokenDeposited(params.token, params.tokenAmountIncludingIncentives);

        ILaunchEvent(launchEvent).initialize(
            params.issuer,
            params.phaseOneStartTime,
            params.token,
            params.tokenIncentivesPercent,
            params.floorPrice,
            params.maxWithdrawPenalty,
            params.fixedWithdrawPenalty,
            params.maxUnstakedUserAllocation,
            params.maxStakedUserAllocation,
            params.userTimelock,
            params.issuerTimelock
        );

        _emitLaunchedEvent(launchEvent, params.issuer, params.token, params.phaseOneStartTime);

        return launchEvent;
    }

    /// @notice Set address to collect withdrawal penalties
    /// @param _penaltyCollector New penalty collector address
    function setPenaltyCollector(address _penaltyCollector)
        external
        override
        onlyOwner
    {
        require(
            _penaltyCollector != address(0),
            "LaunchEventFactory: penalty collector can't be address zero"
        );
        penaltyCollector = _penaltyCollector;
        emit SetPenaltyCollector(_penaltyCollector);
    }

    /// @notice Set VoltageRouter address
    /// @param _router New router address
    function setRouter(address _router) external override onlyOwner {
        require(
            _router != address(0),
            "LaunchEventFactory: router can't be address zero"
        );
        router = _router;
        emit SetRouter(_router);
    }

    /// @notice Set VoltageFactory address
    /// @param _factory New factory address
    function setFactory(address _factory) external override onlyOwner {
        require(
            _factory != address(0),
            "LaunchEventFactory: factory can't be address zero"
        );
        factory = _factory;
        emit SetFactory(_factory);
    }

    /// @notice Set amount of veVolt required to deposit 1 Volt into launch event
    /// @dev Configured by team between launch events to control inflation
    function setVeVoltPerVolt(uint256 _veVoltPerVolt) external override onlyOwner {
        veVoltPerVolt = _veVoltPerVolt;
        emit SetVeVoltPerVolt(_veVoltPerVolt);
    }

    //

    /// @notice Set duration of each of the three phases
    /// @param _phaseNumber Can be only 1 or 2
    /// @param _duration Duration of phase in seconds
    function setPhaseDuration(uint256 _phaseNumber, uint256 _duration)
        external
        override
        onlyOwner
    {
        if (_phaseNumber == 1) {
            require(
                _duration > phaseOneNoFeeDuration,
                "LaunchEventFactory: phase one duration less than or equal to no fee duration"
            );
            phaseOneDuration = _duration;
        } else if (_phaseNumber == 2) {
            phaseTwoDuration = _duration;
        }
        emit PhaseDurationChanged(_phaseNumber, _duration);
    }

    /// @notice Set the no fee duration of phase 1
    /// @param _noFeeDuration Duration of no fee phase
    function setPhaseOneNoFeeDuration(uint256 _noFeeDuration)
        external
        override
        onlyOwner
    {
        require(
            _noFeeDuration < phaseOneDuration,
            "LaunchEventFactory: no fee duration greater than or equal to phase one duration"
        );
        phaseOneNoFeeDuration = _noFeeDuration;
        emit NoFeeDurationChanged(_noFeeDuration);
    }

    /// @notice Set the proxy implementation address
    /// @param _eventImplementation The address of the implementation contract
    function setEventImplementation(address _eventImplementation)
        external
        override
        onlyOwner
    {
        require(_eventImplementation != address(0), "LaunchEventFactory: can't be null");
        eventImplementation = _eventImplementation;
        emit SetEventImplementation(_eventImplementation);
    }

    /// @dev This function emits an event after a new launch event has been created
    /// It is only seperated out due to `createRJLaunchEvent` having too many local variables
    function _emitLaunchedEvent(
        address _launchEventAddress,
        address _issuer,
        address _token,
        uint256 _phaseOneStartTime
    ) internal {
        uint256 _phaseTwoStartTime = _phaseOneStartTime + phaseOneDuration;
        uint256 _phaseThreeStartTime = _phaseTwoStartTime + phaseTwoDuration;

        emit LaunchEventCreated(
            _launchEventAddress,
            _issuer,
            _token,
            _phaseOneStartTime,
            _phaseTwoStartTime,
            _phaseThreeStartTime,
            veVolt,
            veVoltPerVolt
        );
    }
}
