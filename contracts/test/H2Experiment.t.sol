// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {IMoharToken} from "../src/interfaces/IMoharToken.sol";
import {MoharTypes} from "../src/libraries/MoharTypes.sol";
import {MoharTestBase} from "./utils/MoharTestBase.sol";

/// @title H2 experiment — every generated trial executed against the real contracts
/// @notice Reads experiments/h2/input-<scenario>.csv (written by generate.py), settles each trial
///         through MoharToken exactly as the API relayer would, and writes the outcome to
///         experiments/h2/results-<scenario>.csv for analyze.py.
///
///         Off by default so normal test runs stay fast and write nothing. Run:
///           RUN_H2_EXPERIMENT=true forge test --match-contract H2ExperimentTest -vv
contract H2ExperimentTest is MoharTestBase {
    bytes32 internal constant MINTED_SIG =
        keccak256("Minted(address,uint256,uint256,uint256,bytes32)");
    bytes32 internal constant BURNED_SIG =
        keccak256("Burned(address,uint256,uint256,uint256,bytes32)");

    function test_H2_realistic() public {
        _run("realistic");
    }

    function test_H2_conservative() public {
        _run("conservative");
    }

    function test_H2_stress() public {
        _run("stress");
    }

    struct Row {
        string trial;
        string side;
        uint256 grams;
        uint256 quoted;
        uint256 oracle;
        uint256 dev;
        bool ok;
        uint256 executedPrice;
        int256 change;
    }

    function _run(string memory scenario) internal {
        if (!vm.envOr("RUN_H2_EXPERIMENT", false)) return;

        string memory dir = string.concat(vm.projectRoot(), "/experiments/h2/");
        string memory input = string.concat(dir, "input-", scenario, ".csv");
        string memory output = string.concat(dir, "results-", scenario, ".csv");
        if (vm.exists(output)) vm.removeFile(output);
        vm.writeLine(
            output,
            "trial,side,grams,quoted_price,oracle_price,deviation_bps_floor,outcome,executed_oracle_price,balance_change"
        );

        uint256 executed;
        uint256 rejected;
        string memory line = vm.readLine(input);
        while (bytes(line).length > 0) {
            Row memory r = _settle(vm.split(line, ","));
            if (r.ok) executed++;
            else rejected++;
            vm.writeLine(output, _format(r));
            line = vm.readLine(input);
        }
        vm.closeFile(input);
        emit log_named_string("scenario", scenario);
        emit log_named_uint("executed", executed);
        emit log_named_uint("rejected", rejected);
    }

    /// @dev Settles one CSV row and checks the outcome against the contract's 50 bps rule.
    function _settle(string[] memory f) internal returns (Row memory r) {
        r.trial = f[0];
        r.side = f[1];
        r.grams = vm.parseUint(f[2]);
        r.quoted = vm.parseUint(f[3]);
        r.oracle = vm.parseUint(f[4]);
        (r.ok, r.executedPrice, r.change) = keccak256(bytes(r.side)) == keccak256("mint")
            ? _mintTrial(r.grams, r.quoted, r.oracle)
            : _burnTrial(r.grams, r.quoted, r.oracle);

        // The contract's own rule, recomputed here, must agree with what happened on-chain.
        r.dev = MoharTypes.deviationBps(r.quoted, r.oracle);
        assertEq(r.ok, r.dev <= token.maxDeviationBps(), "decision disagrees with the 50 bps rule");
        if (r.ok) {
            assertEq(r.executedPrice, r.oracle, "executed at a price other than the oracle's");
        } else {
            assertEq(r.change, 0, "a rejected trade moved gold");
        }
    }

    function _format(Row memory r) internal pure returns (string memory) {
        string memory head = string.concat(
            r.trial, ",", r.side, ",", vm.toString(r.grams), ",", vm.toString(r.quoted), ","
        );
        return string.concat(
            head,
            vm.toString(r.oracle),
            ",",
            vm.toString(r.dev),
            ",",
            r.ok ? "executed" : "rejected",
            ",",
            vm.toString(r.executedPrice),
            ",",
            vm.toString(r.change)
        );
    }

    /// @dev Quote at `quoted`, market moves to `oracle`, relayer settles. Returns the oracle price
    ///      recorded in the Minted event and the change in the customer's balance.
    function _mintTrial(uint256 grams, uint256 quoted, uint256 oracle)
        internal
        returns (bool ok, uint256 executedPrice, int256 change)
    {
        IMoharToken.Allocation memory a = _allocation(alice, grams);
        bytes memory sig = _signAllocation(a, vaultKey);
        feed.updateAnswer(int256(oracle));
        uint256 before = token.balanceOf(alice);

        vm.recordLogs();
        vm.prank(relayer);
        try token.mint(a, quoted, sig) {
            ok = true;
            executedPrice = _eventPrice(MINTED_SIG);
        } catch {}
        change = int256(token.balanceOf(alice)) - int256(before);
    }

    /// @dev The customer first buys `grams` at the quoted price, then sells them after the move.
    function _burnTrial(uint256 grams, uint256 quoted, uint256 oracle)
        internal
        returns (bool ok, uint256 executedPrice, int256 change)
    {
        feed.updateAnswer(int256(quoted));
        _mint(bob, grams);

        IMoharToken.Deallocation memory d = _deallocation(bob, grams);
        bytes memory sig = _signDeallocation(d, vaultKey);
        feed.updateAnswer(int256(oracle));
        uint256 before = token.balanceOf(bob);

        vm.recordLogs();
        vm.prank(relayer);
        try token.burn(d, quoted, sig) {
            ok = true;
            executedPrice = _eventPrice(BURNED_SIG);
        } catch {}
        change = int256(token.balanceOf(bob)) - int256(before);

        // Clean up so every burn trial starts from an empty wallet.
        if (!ok) {
            feed.updateAnswer(int256(quoted));
            IMoharToken.Deallocation memory undo = _deallocation(bob, grams);
            bytes memory undoSig = _signDeallocation(undo, vaultKey);
            vm.prank(relayer);
            token.burn(undo, quoted, undoSig);
        }
    }

    /// @dev Oracle price field (3rd word of data) of the first matching event in the last call.
    function _eventPrice(bytes32 sig) internal returns (uint256) {
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] == sig) {
                (, uint256 oraclePrice,) = abi.decode(logs[i].data, (uint256, uint256, uint256));
                return oraclePrice;
            }
        }
        revert("event not found");
    }
}
