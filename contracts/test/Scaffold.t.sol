// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MoharTypes} from "../src/libraries/MoharTypes.sol";
import {MockV3Aggregator} from "../src/mocks/MockV3Aggregator.sol";

/// @notice Scaffold-level tests. Real contract tests (mint/burn, fuzzing for H2) come with the
///         implementation PRs.
contract ScaffoldTest is Test {
    MockV3Aggregator internal feed;

    // ~USD 4,616 / oz, the May 2026 spot used in the FYP-1 report
    int256 internal constant INITIAL_XAU_USD = 4_616e8;

    function setUp() public {
        feed = new MockV3Aggregator(8, "XAU / USD (mock)", INITIAL_XAU_USD);
    }

    function test_mockFeedReturnsInitialAnswer() public view {
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        assertEq(answer, INITIAL_XAU_USD);
        assertEq(updatedAt, block.timestamp);
        assertEq(feed.decimals(), MoharTypes.PRICE_DECIMALS);
    }

    function test_mockFeedUpdates() public {
        vm.warp(block.timestamp + 60);
        feed.updateAnswer(4_700e8);
        (uint80 roundId, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        assertEq(roundId, 2);
        assertEq(answer, 4_700e8);
        assertEq(updatedAt, block.timestamp);
    }

    function test_deviationBps() public pure {
        assertEq(MoharTypes.deviationBps(4_616e8, 4_616e8), 0);
        // 0.5% move = 50 bps
        assertEq(MoharTypes.deviationBps(4_000e8, 4_020e8), 50);
        assertEq(MoharTypes.deviationBps(4_000e8, 3_980e8), 50);
        // rounds up: any move past 0.50% counts as at least 51 bps
        assertEq(MoharTypes.deviationBps(4_000e8, 4_020e8 + 1), 51);
        assertEq(MoharTypes.deviationBps(4_000e8, 4_000e8 + 1), 1);
    }

    function testFuzz_deviationIsSymmetricInDirection(uint256 ref, uint256 delta) public pure {
        ref = bound(ref, 1e8, 100_000e8);
        delta = bound(delta, 0, ref - 1);
        assertEq(
            MoharTypes.deviationBps(ref, ref + delta), MoharTypes.deviationBps(ref, ref - delta)
        );
    }

    function test_typehashesMatchDocumentedStrings() public pure {
        assertEq(
            MoharTypes.ALLOCATION_TYPEHASH,
            keccak256(
                "Allocation(address wallet,uint256 grams,bytes32 allocationRef,uint256 deadline)"
            )
        );
        assertEq(
            MoharTypes.DEALLOCATION_TYPEHASH,
            keccak256(
                "Deallocation(address wallet,uint256 grams,bytes32 deallocationRef,uint256 deadline)"
            )
        );
        assertEq(
            MoharTypes.RESERVE_ATTESTATION_TYPEHASH,
            keccak256(
                "ReserveAttestation(uint256 totalGrams,bytes32 allocationsRoot,uint64 asOf,uint256 nonce)"
            )
        );
    }
}
