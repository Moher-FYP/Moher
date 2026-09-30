// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMoharToken} from "../src/interfaces/IMoharToken.sol";
import {MoharTypes} from "../src/libraries/MoharTypes.sol";
import {MoharTestBase} from "./utils/MoharTestBase.sol";

/// @title H2 — Slippage-elimination hypothesis (FYP-1 §2.5)
/// @notice "Mint and burn execute at the oracle price read in the same block, and never more than
///         0.50% away from the price quoted to the customer."
///
///         Each fuzz test runs 1,000 randomized trades (foundry.toml `[fuzz] runs = 1000`) with the
///         oracle moving anywhere within ±5% of the quote. Two properties are asserted:
///         P1  Executed price == oracle price at execution (zero deviation, recorded in the event).
///         P2  Any trade whose |oracle − quote| exceeds maxDeviationBps reverts; nothing moves.
///
///         Run: forge test --match-contract H2SlippageTest -vv
contract H2SlippageTest is MoharTestBase {
    uint256 internal constant MAX_TRADE_GRAMS = 1_000_000 * ONE_GRAM; // one tonne

    function _moveOracle(uint256 oracleSeed) internal returns (uint256 oraclePrice) {
        oraclePrice = bound(oracleSeed, PRICE * 95 / 100, PRICE * 105 / 100);
        feed.updateAnswer(int256(oraclePrice));
    }

    function testFuzz_H2_mintExecutesAtOraclePriceWithinBound(uint256 gramsSeed, uint256 oracleSeed)
        public
    {
        uint256 grams = bound(gramsSeed, 1, MAX_TRADE_GRAMS);
        uint256 oraclePrice = _moveOracle(oracleSeed);
        uint256 deviation = MoharTypes.deviationBps(PRICE, oraclePrice);

        IMoharToken.Allocation memory a = _allocation(alice, grams);
        bytes memory sig = _signAllocation(a, vaultKey);

        if (deviation > token.maxDeviationBps()) {
            // P2: outside the bound the trade is rejected and nothing is minted
            vm.expectRevert(
                abi.encodeWithSelector(
                    IMoharToken.PriceDeviationTooHigh.selector, oraclePrice, PRICE, deviation
                )
            );
            vm.prank(relayer);
            token.mint(a, PRICE, sig);
            assertEq(token.totalSupply(), 0);
        } else {
            // P1: executes, and the recorded execution price is exactly the oracle price
            vm.expectEmit(address(token));
            emit IMoharToken.Minted(alice, grams, oraclePrice, PRICE, a.allocationRef);
            vm.prank(relayer);
            token.mint(a, PRICE, sig);
            assertEq(token.balanceOf(alice), grams);
        }
    }

    function testFuzz_H2_burnExecutesAtOraclePriceWithinBound(uint256 gramsSeed, uint256 oracleSeed)
        public
    {
        uint256 grams = bound(gramsSeed, 1, MAX_TRADE_GRAMS);
        _mint(alice, grams); // at the quoted price, before the market moves
        uint256 oraclePrice = _moveOracle(oracleSeed);
        uint256 deviation = MoharTypes.deviationBps(PRICE, oraclePrice);

        IMoharToken.Deallocation memory d = _deallocation(alice, grams);
        bytes memory sig = _signDeallocation(d, vaultKey);

        if (deviation > token.maxDeviationBps()) {
            vm.expectRevert(
                abi.encodeWithSelector(
                    IMoharToken.PriceDeviationTooHigh.selector, oraclePrice, PRICE, deviation
                )
            );
            vm.prank(relayer);
            token.burn(d, PRICE, sig);
            assertEq(token.balanceOf(alice), grams);
        } else {
            vm.expectEmit(address(token));
            emit IMoharToken.Burned(alice, grams, oraclePrice, PRICE, d.deallocationRef);
            vm.prank(relayer);
            token.burn(d, PRICE, sig);
            assertEq(token.balanceOf(alice), 0);
        }
    }

    /// @notice Supply always equals the sum of vault-signed allocations minus de-allocations:
    ///         no path mints gold the vault did not sign for.
    function testFuzz_supplyMatchesVaultReceipts(uint256[8] memory seeds) public {
        uint256 allocated;
        uint256 deallocated;
        for (uint256 i = 0; i < seeds.length; i++) {
            uint256 grams = bound(seeds[i], 1, 1_000 * ONE_GRAM);
            _mint(alice, grams);
            allocated += grams;

            if (seeds[i] % 2 == 0) {
                uint256 sell = grams / 2;
                if (sell == 0) continue;
                IMoharToken.Deallocation memory d = _deallocation(alice, sell);
                bytes memory sig = _signDeallocation(d, vaultKey);
                vm.prank(relayer);
                token.burn(d, PRICE, sig);
                deallocated += sell;
            }
        }
        assertEq(token.totalSupply(), allocated - deallocated);
        assertEq(token.balanceOf(alice), allocated - deallocated);
    }
}
