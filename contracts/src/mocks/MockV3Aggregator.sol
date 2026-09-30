// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AggregatorV3Interface} from "../interfaces/AggregatorV3Interface.sol";

/// @notice Stand-in for a Chainlink feed on Anvil, or on Amoy if XAU/USD is not deployed there.
///         A script updates it with the real gold price so demos use realistic numbers.
/// @dev For local development and testnet only. Anyone can update the answer.
contract MockV3Aggregator is AggregatorV3Interface {
    // Names are fixed by AggregatorV3Interface.
    // forge-lint: disable-next-line(screaming-snake-case-immutable)
    uint8 public immutable override decimals;
    string public override description;
    // forge-lint: disable-next-line(screaming-snake-case-const)
    uint256 public constant override version = 4;

    uint80 public latestRound;
    mapping(uint80 => int256) public getAnswer;
    mapping(uint80 => uint256) public getTimestamp;
    mapping(uint80 => uint256) private getStartedAt;

    event AnswerUpdated(int256 indexed current, uint256 indexed roundId, uint256 updatedAt);

    constructor(uint8 decimals_, string memory description_, int256 initialAnswer) {
        decimals = decimals_;
        description = description_;
        updateAnswer(initialAnswer);
    }

    function updateAnswer(int256 answer) public {
        latestRound++;
        getAnswer[latestRound] = answer;
        getTimestamp[latestRound] = block.timestamp;
        getStartedAt[latestRound] = block.timestamp;
        emit AnswerUpdated(answer, latestRound, block.timestamp);
    }

    /// @notice Test helper to simulate a stale or back-dated answer.
    function updateRoundData(uint80 roundId, int256 answer, uint256 timestamp, uint256 startedAt)
        external
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
