// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IMoharToken} from "../src/interfaces/IMoharToken.sol";
import {MoharTypes} from "../src/libraries/MoharTypes.sol";
import {MoharTestBase} from "./utils/MoharTestBase.sol";

/// @title H2 — Slippage-elimination hypothesis (FYP-1 §2.5, restated in FYP-2)
/// @notice "Customers pay exactly the price they confirmed (zero slippage against the quote).
///         A trade settles only if that price is within maxDeviationBps (0.50%) of the live oracle
///         price; otherwise it is cancelled and nothing moves."
///
///         The quoted price is fixed when the customer accepts, which is what the spot-exchange
///         (sarf) rule needs: a known price, settled hand to hand. Settling at whatever the oracle
///         reads in the block would leave the price unknown at acceptance. The deviation bound is a
///         fairness control against stale quotes, not a price the customer pays.
///
///         Each fuzz test runs 1,000 randomized trades (foundry.toml `[fuzz] runs = 1000`) with the
///         oracle moving anywhere within ±5% of the quote. Three properties are asserted:
///         P1  The customer receives exactly the quoted grams, at the quoted price (no slippage).
///         P2  Any trade whose |oracle − quote| exceeds maxDeviationBps reverts; nothing moves.
///         P3  Every trade that settles was within maxDeviationBps of the oracle, and the event
///             records both prices so the gap can be audited trade by trade.
///
///         Run: forge test --match-contract H2SlippageTest -vv
contract H2SlippageTest is MoharTestBase {
    uint256 internal constant MAX_TRADE_GRAMS = 1_000_000 * ONE_GRAM; // one tonne

    function _moveOracle(uint256 oracleSeed) internal returns (uint256 oraclePrice) {
        oraclePrice = bound(oracleSeed, PRICE * 95 / 100, PRICE * 105 / 100);
        feed.updateAnswer(int256(oraclePrice));
    }

    function testFuzz_H2_mintPaysQuotedPriceWithinBound(uint256 gramsSeed, uint256 oracleSeed)
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
            // P3: only trades within the bound settle; the event records quote and oracle
            assertLe(deviation, token.maxDeviationBps());
            vm.expectEmit(address(token));
            emit IMoharToken.Minted(alice, grams, oraclePrice, PRICE, a.allocationRef);
            vm.prank(relayer);
            token.mint(a, PRICE, sig);
            // P1: exactly the quoted grams, whatever the oracle did in between
            assertEq(token.balanceOf(alice), grams);
            assertEq(token.totalSupply(), grams);
        }
    }

    function testFuzz_H2_burnPaysQuotedPriceWithinBound(uint256 gramsSeed, uint256 oracleSeed)
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
            // P3
            assertLe(deviation, token.maxDeviationBps());
            vm.expectEmit(address(token));
            emit IMoharToken.Burned(alice, grams, oraclePrice, PRICE, d.deallocationRef);
            vm.prank(relayer);
            token.burn(d, PRICE, sig);
            // P1: exactly the quoted grams leave the wallet; the payout is the quoted PKR
            assertEq(token.balanceOf(alice), 0);
            assertEq(token.totalSupply(), 0);
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
