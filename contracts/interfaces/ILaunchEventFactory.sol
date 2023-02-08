// SPDX-License-Identifier: MIT

pragma solidity 0.8.6;

struct LaunchParams {
    address issuer;
    uint256 phaseOneStartTime;
    address token;
    uint256 tokenAmountIncludingIncentives;
    uint256 tokenIncentivesPercent;
    uint256 floorPrice;
    uint256 maxWithdrawPenalty;
    uint256 fixedWithdrawPenalty;
    uint256 maxUnstakedUserAllocation;
    uint256 maxStakedUserAllocation;
    uint256 userTimelock;
    uint256 issuerTimelock;
}

interface ILaunchEventFactory {
    event LaunchEventCreated(
        address indexed launchEvent,
        address indexed issuer,
        address indexed token,
        uint256 phaseOneStartTime,
        uint256 phaseTwoStartTime,
        uint256 phaseThreeStartTime,
        address veVolt,
        uint256 veVoltPerVolt
    );
    event SetVeVolt(address indexed token);
    event SetPenaltyCollector(address indexed collector);
    event SetRouter(address indexed router);
    event SetFactory(address indexed factory);
    event SetVeVoltPerVolt(uint256 veVoltPerVolt);
    event SetEventImplementation(address indexed implementation);
    event IssuingTokenDeposited(address indexed token, uint256 amount);
    event PhaseDurationChanged(uint256 phase, uint256 duration);
    event NoFeeDurationChanged(uint256 duration);

    function eventImplementation() external view returns (address);

    function penaltyCollector() external view returns (address);

    function volt() external view returns (address);

    function veVoltPerVolt() external view returns (uint256);

    function router() external view returns (address);

    function factory() external view returns (address);

    function veVolt() external view returns (address);

    function phaseOneDuration() external view returns (uint256);

    function phaseOneNoFeeDuration() external view returns (uint256);

    function phaseTwoDuration() external view returns (uint256);

    function getLaunchEvent(address token)
        external
        view
        returns (address launchEvent);

    function isLaunchEvent(address token) external view returns (bool);

    function allLaunchEvents(uint256) external view returns (address pair);

    function numLaunchEvents() external view returns (uint256);

    function createLaunchEvent(LaunchParams memory params) external returns (address pair);

    function setPenaltyCollector(address) external;

    function setRouter(address) external;

    function setFactory(address) external;

    function setVeVoltPerVolt(uint256) external;

    function setPhaseDuration(uint256, uint256) external;

    function setPhaseOneNoFeeDuration(uint256) external;

    function setEventImplementation(address) external;
}
