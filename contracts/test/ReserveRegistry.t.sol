// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {Hashes} from "@openzeppelin/contracts/utils/cryptography/Hashes.sol";
import {IMoharToken} from "../src/interfaces/IMoharToken.sol";
import {IReserveRegistry} from "../src/interfaces/IReserveRegistry.sol";
import {MoharTestBase} from "./utils/MoharTestBase.sol";

contract ReserveRegistryTest is MoharTestBase {
    function _attestation(uint256 totalGrams, bytes32 root, uint256 nonce)
        internal
        view
        returns (IReserveRegistry.ReserveAttestation memory)
    {
        return IReserveRegistry.ReserveAttestation({
            totalGrams: totalGrams,
            allocationsRoot: root,
            asOf: uint64(block.timestamp),
            nonce: nonce
        });
    }

    function _publish(IReserveRegistry.ReserveAttestation memory att) internal {
        bytes memory sig = _signReserve(att, vaultKey);
        vm.prank(relayer);
        reserve.publish(att, sig);
    }

    /// @dev OpenZeppelin merkle-tree "standard" leaf: double-hashed abi.encode.
    function _leaf(bytes32 ref, address wallet, uint256 grams) internal pure returns (bytes32) {
        return keccak256(bytes.concat(keccak256(abi.encode(ref, wallet, grams))));
    }

    // ---------------------------------------------------------------- publishing

    function test_publish_recordsAttestation() public {
        _mint(alice, 3 * ONE_GRAM);
        IReserveRegistry.ReserveAttestation memory att = _attestation(3 * ONE_GRAM, "root", 1);

        vm.expectEmit(address(reserve));
        emit IReserveRegistry.AttestationPublished(
            1, 3 * ONE_GRAM, "root", uint64(block.timestamp), 3 * ONE_GRAM
        );
        _publish(att);

        IReserveRegistry.PublishedAttestation memory p = reserve.latest();
        assertEq(p.attestation.totalGrams, 3 * ONE_GRAM);
        assertEq(p.attestation.allocationsRoot, bytes32("root"));
        assertEq(p.tokenSupplyAtPublish, 3 * ONE_GRAM);
        assertEq(p.publishedAt, block.timestamp);
        assertEq(reserve.attestationCount(), 1);
        assertTrue(reserve.isFullyBacked());
        assertFalse(token.mintingPaused());
    }

    function test_publish_keepsHistory() public {
        _publish(_attestation(0, "day-1", 1));
        vm.warp(block.timestamp + 1 days);
        _publish(_attestation(0, "day-2", 2));

        assertEq(reserve.attestationCount(), 2);
        assertEq(reserve.attestationAt(0).attestation.allocationsRoot, bytes32("day-1"));
        assertEq(reserve.latest().attestation.allocationsRoot, bytes32("day-2"));
    }

    function test_publish_onlyPublisher() public {
        IReserveRegistry.ReserveAttestation memory att = _attestation(0, "root", 1);
        bytes memory sig = _signReserve(att, vaultKey);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                outsider,
                reserve.PUBLISHER_ROLE()
            )
        );
        vm.prank(outsider);
        reserve.publish(att, sig);
    }

    function test_publish_rejectsNonVaultSignature() public {
        IReserveRegistry.ReserveAttestation memory att = _attestation(0, "root", 1);
        bytes memory sig = _signReserve(att, attackerKey);

        vm.expectRevert(IReserveRegistry.InvalidVaultSignature.selector);
        vm.prank(relayer);
        reserve.publish(att, sig);
    }

    function test_publish_rejectsInflatedTotal() public {
        IReserveRegistry.ReserveAttestation memory att = _attestation(ONE_GRAM, "root", 1);
        bytes memory sig = _signReserve(att, vaultKey);
        att.totalGrams = 1_000 * ONE_GRAM; // relayer tries to overstate reserves

        vm.expectRevert(IReserveRegistry.InvalidVaultSignature.selector);
        vm.prank(relayer);
        reserve.publish(att, sig);
    }

    function test_publish_rejectsNonIncreasingNonce() public {
        _publish(_attestation(0, "root", 5));
        IReserveRegistry.ReserveAttestation memory att = _attestation(0, "root", 5);
        bytes memory sig = _signReserve(att, vaultKey);

        vm.expectRevert(abi.encodeWithSelector(IReserveRegistry.NonceNotIncreasing.selector, 5, 5));
        vm.prank(relayer);
        reserve.publish(att, sig);
    }

    function test_publish_rejectsOlderSnapshot() public {
        _publish(_attestation(0, "root", 1));
        IReserveRegistry.ReserveAttestation memory att = _attestation(0, "root", 2);
        att.asOf = uint64(block.timestamp - 1);
        bytes memory sig = _signReserve(att, vaultKey);

        vm.expectRevert(
            abi.encodeWithSelector(
                IReserveRegistry.SnapshotOutOfOrder.selector, uint64(block.timestamp), att.asOf
            )
        );
        vm.prank(relayer);
        reserve.publish(att, sig);
    }

    function test_tokenSignatureCannotBeUsedForReserve() public {
        // Same vault key, different EIP-712 domain ("MOHAR" vs "MOHAR Reserve").
        IReserveRegistry.ReserveAttestation memory att = _attestation(0, "root", 1);
        bytes32 structHash = keccak256(abi.encode(bytes32("anything")));
        bytes memory tokenDomainSig = _sign(vaultKey, token.domainSeparator(), structHash);

        vm.expectRevert(IReserveRegistry.InvalidVaultSignature.selector);
        vm.prank(relayer);
        reserve.publish(att, tokenDomainSig);
    }

    // ---------------------------------------------------------------- shortfall

    function test_shortfall_pausesMintingButNotBurns() public {
        _mint(alice, 10 * ONE_GRAM);
        IReserveRegistry.ReserveAttestation memory att = _attestation(9 * ONE_GRAM, "root", 1);

        vm.expectEmit(address(reserve));
        emit IReserveRegistry.ReserveShortfall(1, 9 * ONE_GRAM, 10 * ONE_GRAM);
        _publish(att);

        assertTrue(token.mintingPaused());
        assertFalse(reserve.isFullyBacked());

        // Minting is blocked...
        IMoharToken.Allocation memory a = _allocation(bob, ONE_GRAM);
        bytes memory mintSig = _signAllocation(a, vaultKey);
        vm.expectRevert(IMoharToken.MintingIsPaused.selector);
        vm.prank(relayer);
        token.mint(a, PRICE, mintSig);

        // ...but holders can always exit.
        IMoharToken.Deallocation memory d = _deallocation(alice, 10 * ONE_GRAM);
        bytes memory burnSig = _signDeallocation(d, vaultKey);
        vm.prank(relayer);
        token.burn(d, PRICE, burnSig);
        assertEq(token.totalSupply(), 0);

        // A later healthy attestation does not auto-unpause; that is a manual admin decision.
        vm.warp(block.timestamp + 1 hours);
        _publish(_attestation(0, "root", 2));
        assertTrue(reserve.isFullyBacked());
        assertTrue(token.mintingPaused());
    }

    // ---------------------------------------------------------------- Merkle verification

    function test_verifyAllocation_againstLatestRoot() public {
        bytes32[4] memory leaves = [
            _leaf("ref-0", alice, 60_410_000),
            _leaf("ref-1", bob, 123_470_000),
            _leaf("ref-2", alice, 50_000_000),
            _leaf("ref-3", bob, 2 * ONE_GRAM)
        ];
        bytes32 n01 = Hashes.commutativeKeccak256(leaves[0], leaves[1]);
        bytes32 n23 = Hashes.commutativeKeccak256(leaves[2], leaves[3]);
        bytes32 root = Hashes.commutativeKeccak256(n01, n23);
        _publish(_attestation(0, root, 1));

        bytes32[] memory proof = new bytes32[](2);
        proof[0] = leaves[3];
        proof[1] = n01;

        assertTrue(reserve.verifyAllocation("ref-2", alice, 50_000_000, proof));
        assertFalse(reserve.verifyAllocation("ref-2", alice, 50_000_001, proof), "wrong grams");
        assertFalse(reserve.verifyAllocation("ref-2", bob, 50_000_000, proof), "wrong wallet");
    }

    function test_views_beforeFirstAttestation() public {
        assertEq(reserve.attestationCount(), 0);
        assertFalse(reserve.isFullyBacked());
        assertFalse(reserve.verifyAllocation("ref", alice, 1, new bytes32[](0)));
        vm.expectRevert(IReserveRegistry.NoAttestation.selector);
        reserve.latest();
    }

    function test_setVaultSigner_onlyAdmin() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                relayer,
                reserve.DEFAULT_ADMIN_ROLE()
            )
        );
        vm.prank(relayer);
        reserve.setVaultSigner(relayer);

        vm.expectRevert(IReserveRegistry.ZeroAddress.selector);
        vm.prank(admin);
        reserve.setVaultSigner(address(0));
    }
}
