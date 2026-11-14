// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

/// @notice Stand-in for a Chainlink feed on Anvil, or on Amoy if XAU/USD is not deployed there.
///         A script updates it with the real gold price so demos use realistic numbers.
/// @dev For local development and testnet only. Only the deployer and one appointed updater (the
///      API's relayer) can move the price, so on a public testnet nobody else can.
contract MockV3Aggregator is AggregatorV3Interface {
    // Names are fixed by AggregatorV3Interface.
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    uint8 public immutable override decimals;
    string public override description;
    // forge-lint: disable-next-line(screaming-snake-case-const)
    uint256 public constant override version = 4;
    /// @notice The deployer. Can move the price and appoint the updater.
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    address public immutable owner;
    /// @notice The one other account allowed to move the price (the API's relayer).
    address public updater;

    uint80 public latestRound;
    mapping(uint80 => int256) public getAnswer;
    mapping(uint80 => uint256) public getTimestamp;
    mapping(uint80 => uint256) private getStartedAt;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);
    event UpdaterSet(address indexed updater);

    error NotPriceUpdater(address caller);

    modifier onlyUpdater() {
        if (msg.sender != owner && msg.sender != updater) revert NotPriceUpdater(msg.sender);
        _;
    }

    constructor(uint8 decimals_, string memory description_, int256 initialAnswer) {
        decimals = decimals_;
        description = description_;
        owner = msg.sender;
        _setAnswer(initialAnswer);
    }

    /// @notice Appoints the account (besides the owner) that may move the price.
    ///         Pass address(0) to remove it.
    // forge-lint: disable-next-line(missing-zero-check)
    function setUpdater(address newUpdater) external {
        if (msg.sender != owner) revert NotPriceUpdater(msg.sender);
        updater = newUpdater;
        emit UpdaterSet(newUpdater);
    }

    function updateAnswer(int256 answer) external onlyUpdater {
        _setAnswer(answer);
    }

    function _setAnswer(int256 answer) private {
        latestRound++;
        getAnswer[latestRound] = answer;
        getTimestamp[latestRound] = block.timestamp;
        getStartedAt[latestRound] = block.timestamp;
        emit AnswerUpdated(answer, latestRound, block.timestamp);
    }

    /// @notice Test helper to simulate a stale or back-dated answer.
    function updateRoundData(uint80 roundId, int256 answer, uint256 timestamp, uint256 startedAt)
        external
        onlyUpdater
    {
        latestRound = roundId;
        getAnswer[roundId] = answer;
        getTimestamp[roundId] = timestamp;
        getStartedAt[roundId] = startedAt;
        emit AnswerUpdated(answer, roundId, timestamp);
    }

    function getRoundData(uint80 roundId)
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (roundId, getAnswer[roundId], getStartedAt[roundId], getTimestamp[roundId], roundId);
    }

    function latestRoundData()
        external
        view
        override
        returns (uint80, int256, uint256, uint256, uint80)
    {
        return (
            latestRound,
            getAnswer[latestRound],
            getStartedAt[latestRound],
            getTimestamp[latestRound],
            latestRound
        );
    }
}
