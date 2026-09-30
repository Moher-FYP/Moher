// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {IMoharToken} from "../src/interfaces/IMoharToken.sol";
import {MockV3Aggregator} from "../src/mocks/MockV3Aggregator.sol";
import {MoharTestBase} from "./utils/MoharTestBase.sol";

contract MoharTokenTest is MoharTestBase {
    // ---------------------------------------------------------------- metadata & config

    function test_metadata() public view {
        assertEq(token.name(), "MOHAR Gold");
        assertEq(token.symbol(), "MOHAR");
        assertEq(token.decimals(), 8);
        assertEq(token.walletRegistry(), address(registry));
        assertEq(token.vaultSigner(), vaultSigner);
        assertEq(token.priceFeed(), address(feed));
        assertEq(token.maxStaleness(), MAX_STALENESS);
        assertEq(token.maxDeviationBps(), 50);
        assertFalse(token.mintingPaused());
    }

    function test_latestPrice() public view {
        (uint256 price, uint256 updatedAt) = token.latestPrice();
        assertEq(price, PRICE);
        assertEq(updatedAt, block.timestamp);
    }

    // ---------------------------------------------------------------- mint

    function test_mint_mintsAndEmits() public {
        IMoharToken.Allocation memory a = _allocation(alice, 60_410_000); // 0.6041 g
        bytes memory sig = _signAllocation(a, vaultKey);

        vm.expectEmit(address(token));
        emit IMoharToken.Minted(alice, 60_410_000, PRICE, PRICE, a.allocationRef);
        vm.prank(relayer);
        token.mint(a, PRICE, sig);

        assertEq(token.balanceOf(alice), 60_410_000);
        assertEq(token.totalSupply(), 60_410_000);
        assertTrue(token.isRefUsed(a.allocationRef));
    }

    function test_mint_onlySettlementRole() public {
        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);
        bytes memory sig = _signAllocation(a, vaultKey);

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                outsider,
                token.SETTLEMENT_ROLE()
            )
        );
        vm.prank(outsider);
        token.mint(a, PRICE, sig);
    }

    function test_mint_rejectsSignatureFromNonVault() public {
        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);
        bytes memory sig = _signAllocation(a, attackerKey);

        vm.expectRevert(IMoharToken.InvalidVaultSignature.selector);
        vm.prank(relayer);
        token.mint(a, PRICE, sig);
    }

    function test_mint_rejectsTamperedAmount() public {
        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);
        bytes memory sig = _signAllocation(a, vaultKey);
        a.grams = 100 * ONE_GRAM; // relayer tries to mint more than the vault allocated

        vm.expectRevert(IMoharToken.InvalidVaultSignature.selector);
        vm.prank(relayer);
        token.mint(a, PRICE, sig);
    }

    function test_mint_rejectsRedirectedWallet() public {
        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);
        bytes memory sig = _signAllocation(a, vaultKey);
        a.wallet = bob;

        vm.expectRevert(IMoharToken.InvalidVaultSignature.selector);
        vm.prank(relayer);
        token.mint(a, PRICE, sig);
    }

    function test_mint_rejectsGarbageSignature() public {
        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);

        vm.expectRevert(IMoharToken.InvalidVaultSignature.selector);
        vm.prank(relayer);
        token.mint(a, PRICE, hex"1234");
    }

    function test_mint_rejectsExpiredAttestation() public {
        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);
        bytes memory sig = _signAllocation(a, vaultKey);
        vm.warp(a.deadline + 1);
        feed.updateAnswer(int256(PRICE)); // keep the oracle fresh so only the deadline fails

        vm.expectRevert(abi.encodeWithSelector(IMoharToken.AttestationExpired.selector, a.deadline));
        vm.prank(relayer);
        token.mint(a, PRICE, sig);
    }

    function test_mint_rejectsReplayedAllocation() public {
        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);
        bytes memory sig = _signAllocation(a, vaultKey);
        vm.startPrank(relayer);
        token.mint(a, PRICE, sig);

        vm.expectRevert(
            abi.encodeWithSelector(IMoharToken.RefAlreadyUsed.selector, a.allocationRef)
        );
        token.mint(a, PRICE, sig);
        vm.stopPrank();
        assertEq(token.balanceOf(alice), ONE_GRAM);
    }

    function test_mint_signatureIsChainSpecific() public {
        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);
        bytes memory sig = _signAllocation(a, vaultKey); // signed for this chain id
        vm.chainId(80002); // replayed on Polygon Amoy

        vm.expectRevert(IMoharToken.InvalidVaultSignature.selector);
        vm.prank(relayer);
        token.mint(a, PRICE, sig);
    }

    function test_mint_rejectsUnregisteredWallet() public {
        IMoharToken.Allocation memory a = _allocation(outsider, ONE_GRAM);
        bytes memory sig = _signAllocation(a, vaultKey);

        vm.expectRevert(abi.encodeWithSelector(IMoharToken.WalletNotActive.selector, outsider));
        vm.prank(relayer);
        token.mint(a, PRICE, sig);
    }

    function test_mint_rejectsFrozenWallet() public {
        vm.prank(compliance);
        registry.freezeWallet(alice, "AML_REVIEW");
        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);
        bytes memory sig = _signAllocation(a, vaultKey);

        vm.expectRevert(abi.encodeWithSelector(IMoharToken.WalletNotActive.selector, alice));
        vm.prank(relayer);
        token.mint(a, PRICE, sig);
    }

    function test_mint_rejectsZeroGrams() public {
        IMoharToken.Allocation memory a = _allocation(alice, 0);
        bytes memory sig = _signAllocation(a, vaultKey);

        vm.expectRevert(IMoharToken.ZeroAmount.selector);
        vm.prank(relayer);
        token.mint(a, PRICE, sig);
    }

    function test_mint_blockedWhilePaused_thenResumes() public {
        vm.prank(admin);
        token.pauseMinting();
        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);
        bytes memory sig = _signAllocation(a, vaultKey);

        vm.expectRevert(IMoharToken.MintingIsPaused.selector);
        vm.prank(relayer);
        token.mint(a, PRICE, sig);

        vm.prank(admin);
        token.unpauseMinting();
        vm.prank(relayer);
        token.mint(a, PRICE, sig);
        assertEq(token.balanceOf(alice), ONE_GRAM);
    }

    function test_mint_rejectsStaleOracle() public {
        vm.warp(block.timestamp + MAX_STALENESS + 1);
        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);
        bytes memory sig = _signAllocation(a, vaultKey);
        (,,, uint256 updatedAt,) = feed.latestRoundData();

        vm.expectRevert(abi.encodeWithSelector(IMoharToken.StalePrice.selector, updatedAt));
        vm.prank(relayer);
        token.mint(a, PRICE, sig);
    }

    function test_mint_rejectsNonPositiveOracleAnswer() public {
        feed.updateAnswer(0);
        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);
        bytes memory sig = _signAllocation(a, vaultKey);

        vm.expectRevert(abi.encodeWithSelector(IMoharToken.InvalidPrice.selector, int256(0)));
        vm.prank(relayer);
        token.mint(a, PRICE, sig);
    }

    function test_mint_acceptsMoveOfExactlyMaxDeviation() public {
        uint256 moved = PRICE * 10_050 / 10_000; // +0.50%
        feed.updateAnswer(int256(moved));
        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);
        bytes memory sig = _signAllocation(a, vaultKey);

        vm.expectEmit(address(token));
        emit IMoharToken.Minted(alice, ONE_GRAM, moved, PRICE, a.allocationRef);
        vm.prank(relayer);
        token.mint(a, PRICE, sig);
    }

    function test_mint_rejectsMoveJustOverMaxDeviation() public {
        uint256 moved = PRICE * 10_051 / 10_000; // +0.51%
        feed.updateAnswer(int256(moved));
        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);
        bytes memory sig = _signAllocation(a, vaultKey);

        vm.expectRevert(
            abi.encodeWithSelector(IMoharToken.PriceDeviationTooHigh.selector, moved, PRICE, 51)
        );
        vm.prank(relayer);
        token.mint(a, PRICE, sig);
        assertFalse(token.isRefUsed(a.allocationRef), "a failed trade must not burn the vault ref");
    }

    // ---------------------------------------------------------------- burn

    function test_burn_burnsAndEmits() public {
        _mint(alice, 2 * ONE_GRAM);
        IMoharToken.Deallocation memory d = _deallocation(alice, ONE_GRAM / 2);
        bytes memory sig = _signDeallocation(d, vaultKey);

        vm.expectEmit(address(token));
        emit IMoharToken.Burned(alice, ONE_GRAM / 2, PRICE, PRICE, d.deallocationRef);
        vm.prank(relayer);
        token.burn(d, PRICE, sig);

        assertEq(token.balanceOf(alice), 2 * ONE_GRAM - ONE_GRAM / 2);
        assertEq(token.totalSupply(), 2 * ONE_GRAM - ONE_GRAM / 2);
    }

    function test_burn_stillWorksWhileMintingPaused() public {
        _mint(alice, ONE_GRAM);
        vm.prank(admin);
        token.pauseMinting();

        IMoharToken.Deallocation memory d = _deallocation(alice, ONE_GRAM);
        bytes memory sig = _signDeallocation(d, vaultKey);
        vm.prank(relayer);
        token.burn(d, PRICE, sig);
        assertEq(token.balanceOf(alice), 0);
    }

    function test_burn_rejectsMoreThanBalance() public {
        _mint(alice, ONE_GRAM);
        IMoharToken.Deallocation memory d = _deallocation(alice, 2 * ONE_GRAM);
        bytes memory sig = _signDeallocation(d, vaultKey);

        vm.expectRevert(
            abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, alice, ONE_GRAM, 2 * ONE_GRAM
            )
        );
        vm.prank(relayer);
        token.burn(d, PRICE, sig);
    }

    function test_burn_rejectsFrozenWallet() public {
        _mint(alice, ONE_GRAM);
        vm.prank(compliance);
        registry.freezeWallet(alice, "AML_REVIEW");
        IMoharToken.Deallocation memory d = _deallocation(alice, ONE_GRAM);
        bytes memory sig = _signDeallocation(d, vaultKey);

        vm.expectRevert(abi.encodeWithSelector(IMoharToken.WalletNotActive.selector, alice));
        vm.prank(relayer);
        token.burn(d, PRICE, sig);
    }

    function test_burn_rejectsAllocationSignature() public {
        // An Allocation signature must not be usable as a Deallocation (different type hash).
        _mint(alice, ONE_GRAM);
        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);
        bytes memory allocationSig = _signAllocation(a, vaultKey);
        IMoharToken.Deallocation memory d = IMoharToken.Deallocation({
            wallet: a.wallet, grams: a.grams, deallocationRef: a.allocationRef, deadline: a.deadline
        });

        vm.expectRevert(IMoharToken.InvalidVaultSignature.selector);
        vm.prank(relayer);
        token.burn(d, PRICE, allocationSig);
    }

    function test_burn_rejectsPriceMove() public {
        _mint(alice, ONE_GRAM);
        uint256 moved = PRICE * 9_900 / 10_000; // -1%
        feed.updateAnswer(int256(moved));
        IMoharToken.Deallocation memory d = _deallocation(alice, ONE_GRAM);
        bytes memory sig = _signDeallocation(d, vaultKey);

        vm.expectRevert(
            abi.encodeWithSelector(IMoharToken.PriceDeviationTooHigh.selector, moved, PRICE, 100)
        );
        vm.prank(relayer);
        token.burn(d, PRICE, sig);
    }

    // ---------------------------------------------------------------- transfers

    function test_operatorTransfer_movesBetweenActiveWallets() public {
        _mint(alice, ONE_GRAM);

        vm.expectEmit(address(token));
        emit IMoharToken.OperatorTransfer(alice, bob, ONE_GRAM / 4);
        vm.prank(relayer);
        token.operatorTransfer(alice, bob, ONE_GRAM / 4);

        assertEq(token.balanceOf(alice), ONE_GRAM - ONE_GRAM / 4);
        assertEq(token.balanceOf(bob), ONE_GRAM / 4);
    }

    function test_operatorTransfer_rejectsUnregisteredRecipient() public {
        _mint(alice, ONE_GRAM);
        vm.expectRevert(abi.encodeWithSelector(IMoharToken.WalletNotActive.selector, outsider));
        vm.prank(relayer);
        token.operatorTransfer(alice, outsider, ONE_GRAM);
    }

    function test_operatorTransfer_onlyOperator() public {
        _mint(alice, ONE_GRAM);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, bob, token.OPERATOR_ROLE()
            )
        );
        vm.prank(bob);
        token.operatorTransfer(alice, bob, ONE_GRAM);
    }

    function test_operatorTransfer_rejectsZero() public {
        vm.expectRevert(IMoharToken.ZeroAmount.selector);
        vm.prank(relayer);
        token.operatorTransfer(alice, bob, 0);
    }

    function test_erc20Transfer_restrictedToActiveWallets() public {
        _mint(alice, ONE_GRAM);

        vm.prank(alice);
        token.transfer(bob, ONE_GRAM / 2);
        assertEq(token.balanceOf(bob), ONE_GRAM / 2);

        vm.expectRevert(abi.encodeWithSelector(IMoharToken.WalletNotActive.selector, outsider));
        vm.prank(alice);
        token.transfer(outsider, 1);

        vm.prank(compliance);
        registry.freezeWallet(bob, "AML_REVIEW");
        vm.expectRevert(abi.encodeWithSelector(IMoharToken.WalletNotActive.selector, bob));
        vm.prank(bob);
        token.transfer(alice, 1);
    }

    // ---------------------------------------------------------------- controls

    function test_pauseMinting_accessControl() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                outsider,
                token.PAUSER_ROLE()
            )
        );
        vm.prank(outsider);
        token.pauseMinting();

        vm.prank(address(reserve)); // the ReserveRegistry holds RESERVE_GUARDIAN_ROLE
        token.pauseMinting();
        assertTrue(token.mintingPaused());

        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector,
                address(reserve),
                token.PAUSER_ROLE()
            )
        );
        vm.prank(address(reserve)); // the guardian can pause but never unpause
        token.unpauseMinting();
    }

    function test_setMaxDeviationBps_bounds() public {
        vm.startPrank(admin);
        token.setMaxDeviationBps(100);
        assertEq(token.maxDeviationBps(), 100);

        vm.expectRevert(abi.encodeWithSelector(IMoharToken.InvalidMaxDeviation.selector, 0));
        token.setMaxDeviationBps(0);

        vm.expectRevert(abi.encodeWithSelector(IMoharToken.InvalidMaxDeviation.selector, 1_001));
        token.setMaxDeviationBps(1_001);
        vm.stopPrank();
    }

    function test_setPriceFeed_validatesFeed() public {
        MockV3Aggregator wrongDecimals = new MockV3Aggregator(18, "XAU / USD 18dp", 1);
        vm.startPrank(admin);

        vm.expectRevert(
            abi.encodeWithSelector(IMoharToken.InvalidPriceFeed.selector, address(wrongDecimals))
        );
        token.setPriceFeed(address(wrongDecimals), 1 hours);

        vm.expectRevert(abi.encodeWithSelector(IMoharToken.InvalidPriceFeed.selector, outsider));
        token.setPriceFeed(outsider, 1 hours); // not a contract

        vm.expectRevert(abi.encodeWithSelector(IMoharToken.InvalidStaleness.selector, 0));
        token.setPriceFeed(address(feed), 0);

        MockV3Aggregator newFeed = new MockV3Aggregator(8, "XAU / USD v2", int256(PRICE));
        token.setPriceFeed(address(newFeed), 2 hours);
        vm.stopPrank();
        assertEq(token.priceFeed(), address(newFeed));
        assertEq(token.maxStaleness(), 2 hours);
    }

    function test_setVaultSigner_rotatesKey() public {
        (address newSigner, uint256 newKey) = makeAddrAndKey("vault-v2");
        vm.prank(admin);
        token.setVaultSigner(newSigner);

        IMoharToken.Allocation memory a = _allocation(alice, ONE_GRAM);
        bytes memory oldSig = _signAllocation(a, vaultKey);
        vm.expectRevert(IMoharToken.InvalidVaultSignature.selector);
        vm.prank(relayer);
        token.mint(a, PRICE, oldSig);

        bytes memory newSig = _signAllocation(a, newKey); // sign before prank: it calls the token
        vm.prank(relayer);
        token.mint(a, PRICE, newSig);
        assertEq(token.balanceOf(alice), ONE_GRAM);
    }

    function test_setters_onlyAdmin() public {
        bytes memory unauthorized = abi.encodeWithSelector(
            IAccessControl.AccessControlUnauthorizedAccount.selector,
            relayer,
            token.DEFAULT_ADMIN_ROLE()
        );
        vm.startPrank(relayer);
        vm.expectRevert(unauthorized);
        token.setVaultSigner(relayer);
        vm.expectRevert(unauthorized);
        token.setPriceFeed(address(feed), 1 hours);
        vm.expectRevert(unauthorized);
        token.setMaxDeviationBps(100);
        vm.stopPrank();
    }
}
