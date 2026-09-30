// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {MoharToken} from "../../src/MoharToken.sol";
import {ReserveRegistry} from "../../src/ReserveRegistry.sol";
import {WalletRegistry} from "../../src/WalletRegistry.sol";
import {IMoharToken} from "../../src/interfaces/IMoharToken.sol";
import {IReserveRegistry} from "../../src/interfaces/IReserveRegistry.sol";
import {MoharTypes} from "../../src/libraries/MoharTypes.sol";
import {MockV3Aggregator} from "../../src/mocks/MockV3Aggregator.sol";

/// @notice Deploys and wires the full system the same way script/Deploy.s.sol does, plus
///         helpers that play the mock vault (EIP-712 signing) and the API relayer.
abstract contract MoharTestBase is Test {
    WalletRegistry internal registry;
    MoharToken internal token;
    ReserveRegistry internal reserve;
    MockV3Aggregator internal feed;

    address internal admin = makeAddr("admin");
    address internal relayer = makeAddr("relayer");
    address internal compliance = makeAddr("compliance");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal outsider = makeAddr("outsider");

    address internal vaultSigner;
    uint256 internal vaultKey;
    uint256 internal attackerKey;

    bytes32 internal constant PARTNER = keccak256("demo-bank");
    /// @dev USD 4,616 per troy ounce — the May 2026 spot used in the FYP-1 report.
    uint256 internal constant PRICE = 4_616e8;
    uint256 internal constant MAX_STALENESS = 1 hours;
    uint256 internal constant ONE_GRAM = MoharTypes.ONE_GRAM;

    uint256 private _refCounter;

    function setUp() public virtual {
        vm.warp(1_760_000_000); // a realistic timestamp, so "now - 1 hour" never underflows
        (vaultSigner, vaultKey) = makeAddrAndKey("vault");
        (, attackerKey) = makeAddrAndKey("attacker");

        feed = new MockV3Aggregator(8, "XAU / USD (mock)", int256(PRICE));

        vm.startPrank(admin);
        registry = new WalletRegistry(admin);
        token = new MoharToken(admin, address(registry), vaultSigner, address(feed), MAX_STALENESS);
        reserve = new ReserveRegistry(admin, address(token), vaultSigner);

        registry.grantRole(registry.PARTNER_ADMIN_ROLE(), admin);
        registry.grantRole(registry.REGISTRAR_ROLE(), relayer);
        registry.grantRole(registry.COMPLIANCE_ROLE(), compliance);
        token.grantRole(token.SETTLEMENT_ROLE(), relayer);
        token.grantRole(token.OPERATOR_ROLE(), relayer);
        token.grantRole(token.PAUSER_ROLE(), admin);
        token.grantRole(token.RESERVE_GUARDIAN_ROLE(), address(reserve));
        reserve.grantRole(reserve.PUBLISHER_ROLE(), relayer);

        registry.registerPartner(PARTNER);
        vm.stopPrank();

        _registerWallet(alice);
        _registerWallet(bob);
    }

    // ---------------------------------------------------------------- relayer helpers

    function _registerWallet(address wallet) internal {
        vm.prank(relayer);
        registry.registerWallet(wallet, PARTNER, keccak256(abi.encode("partner-kyc-ref", wallet)));
    }

    function _nextRef() internal returns (bytes32) {
        return keccak256(abi.encode("vault-ref", ++_refCounter));
    }

    function _allocation(address wallet, uint256 grams)
        internal
        returns (IMoharToken.Allocation memory)
    {
        return IMoharToken.Allocation({
            wallet: wallet, grams: grams, allocationRef: _nextRef(), deadline: block.timestamp + 60
        });
    }

    function _deallocation(address wallet, uint256 grams)
        internal
        returns (IMoharToken.Deallocation memory)
    {
        return IMoharToken.Deallocation({
            wallet: wallet,
            grams: grams,
            deallocationRef: _nextRef(),
            deadline: block.timestamp + 60
        });
    }

    /// @dev Full happy-path mint at the current oracle price.
    function _mint(address wallet, uint256 grams) internal returns (bytes32 ref) {
        IMoharToken.Allocation memory a = _allocation(wallet, grams);
        bytes memory sig = _signAllocation(a, vaultKey);
        vm.prank(relayer);
        token.mint(a, PRICE, sig);
        return a.allocationRef;
    }

    // ---------------------------------------------------------------- vault (EIP-712) helpers

    function _signAllocation(IMoharToken.Allocation memory a, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                MoharTypes.ALLOCATION_TYPEHASH, a.wallet, a.grams, a.allocationRef, a.deadline
            )
        );
        return _sign(key, token.domainSeparator(), structHash);
    }

    function _signDeallocation(IMoharToken.Deallocation memory d, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                MoharTypes.DEALLOCATION_TYPEHASH, d.wallet, d.grams, d.deallocationRef, d.deadline
            )
        );
        return _sign(key, token.domainSeparator(), structHash);
    }

    function _signReserve(IReserveRegistry.ReserveAttestation memory att, uint256 key)
        internal
        view
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                MoharTypes.RESERVE_ATTESTATION_TYPEHASH,
                att.totalGrams,
                att.allocationsRoot,
                att.asOf,
                att.nonce
            )
        );
        return _sign(key, reserve.domainSeparator(), structHash);
    }

    function _sign(uint256 key, bytes32 domainSeparator, bytes32 structHash)
        internal
        pure
        returns (bytes memory)
    {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, v);
    }
}
