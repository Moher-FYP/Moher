// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {WalletRegistry} from "../src/WalletRegistry.sol";
import {IWalletRegistry} from "../src/interfaces/IWalletRegistry.sol";
import {MoharTestBase} from "./utils/MoharTestBase.sol";

contract WalletRegistryTest is MoharTestBase {
    bytes32 internal constant OTHER_PARTNER = keccak256("other-bank");

    function test_registerWallet_storesPartnerAndKycHash() public view {
        IWalletRegistry.Wallet memory w = registry.getWallet(alice);
        assertEq(w.partnerId, PARTNER);
        assertEq(w.kycAttestationHash, keccak256(abi.encode("partner-kyc-ref", alice)));
        assertEq(w.registeredAt, block.timestamp);
        assertEq(uint8(w.status), uint8(IWalletRegistry.WalletStatus.Active));
        assertTrue(registry.isActive(alice));
    }

    function test_registerWallet_emits() public {
        vm.expectEmit(address(registry));
        emit IWalletRegistry.WalletRegistered(outsider, PARTNER, bytes32(uint256(1)));
        vm.prank(relayer);
        registry.registerWallet(outsider, PARTNER, bytes32(uint256(1)));
    }

    function test_registerWallet_onlyRegistrar() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                outsider,
                registry.REGISTRAR_ROLE()
            )
        );
        vm.prank(outsider);
        registry.registerWallet(outsider, PARTNER, bytes32(uint256(1)));
    }

    function test_registerWallet_rejectsUnknownPartner() public {
        vm.expectRevert(
            abi.encodeWithSelector(IWalletRegistry.PartnerNotActive.selector, OTHER_PARTNER)
        );
        vm.prank(relayer);
        registry.registerWallet(outsider, OTHER_PARTNER, bytes32(uint256(1)));
    }

    function test_registerWallet_rejectsEmptyKycHash() public {
        vm.expectRevert(IWalletRegistry.InvalidKycAttestation.selector);
        vm.prank(relayer);
        registry.registerWallet(outsider, PARTNER, bytes32(0));
    }

    function test_registerWallet_rejectsZeroAddress() public {
        vm.expectRevert(IWalletRegistry.ZeroAddress.selector);
        vm.prank(relayer);
        registry.registerWallet(address(0), PARTNER, bytes32(uint256(1)));
    }

    function test_registerWallet_rejectsDuplicates() public {
        vm.expectRevert(
            abi.encodeWithSelector(IWalletRegistry.WalletAlreadyRegistered.selector, alice)
        );
        vm.prank(relayer);
        registry.registerWallet(alice, PARTNER, bytes32(uint256(1)));
    }

    function test_partnerLifecycle() public {
        vm.startPrank(admin);
        registry.registerPartner(OTHER_PARTNER);
        assertTrue(registry.isPartnerActive(OTHER_PARTNER));

        vm.expectRevert(
            abi.encodeWithSelector(IWalletRegistry.PartnerAlreadyRegistered.selector, OTHER_PARTNER)
        );
        registry.registerPartner(OTHER_PARTNER);

        registry.deactivatePartner(OTHER_PARTNER);
        assertFalse(registry.isPartnerActive(OTHER_PARTNER));

        vm.expectRevert(
            abi.encodeWithSelector(IWalletRegistry.PartnerNotActive.selector, OTHER_PARTNER)
        );
        registry.deactivatePartner(OTHER_PARTNER);

        vm.expectRevert(
            abi.encodeWithSelector(IWalletRegistry.PartnerNotActive.selector, bytes32(0))
        );
        registry.registerPartner(bytes32(0));
        vm.stopPrank();
    }

    function test_deactivatingPartner_deactivatesItsWallets() public {
        vm.prank(admin);
        registry.deactivatePartner(PARTNER);

        assertFalse(registry.isActive(alice));
        // the wallet record itself is untouched
        assertEq(
            uint8(registry.getWallet(alice).status), uint8(IWalletRegistry.WalletStatus.Active)
        );
    }

    function test_freezeAndUnfreeze() public {
        vm.expectEmit(address(registry));
        emit IWalletRegistry.WalletFrozen(alice, "AML_REVIEW");
        vm.prank(compliance);
        registry.freezeWallet(alice, "AML_REVIEW");
        assertFalse(registry.isActive(alice));

        vm.expectEmit(address(registry));
        emit IWalletRegistry.WalletUnfrozen(alice);
        vm.prank(compliance);
        registry.unfreezeWallet(alice);
        assertTrue(registry.isActive(alice));
    }

    function test_freeze_onlyCompliance() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                relayer,
                registry.COMPLIANCE_ROLE()
            )
        );
        vm.prank(relayer);
        registry.freezeWallet(alice, "AML_REVIEW");
    }

    function test_freeze_rejectsUnregisteredWallet() public {
        vm.expectRevert(
            abi.encodeWithSelector(IWalletRegistry.WalletNotRegistered.selector, outsider)
        );
        vm.prank(compliance);
        registry.freezeWallet(outsider, "AML_REVIEW");
    }

    function test_unregisteredWalletIsNotActive() public view {
        assertFalse(registry.isActive(outsider));
    }

    function test_constructor_rejectsZeroAdmin() public {
        vm.expectRevert(IWalletRegistry.ZeroAddress.selector);
        new WalletRegistry(address(0));
    }
}
