// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IWalletRegistry} from "./interfaces/IWalletRegistry.sol";

/// @title WalletRegistry
/// @notice Which custodial wallets may hold MOHAR, and which partner institution onboarded them.
///         Partners perform KYC/AML; MOHAR stores only a hash of the partner's KYC reference.
contract WalletRegistry is IWalletRegistry, AccessControl {
    bytes32 public constant PARTNER_ADMIN_ROLE = keccak256("PARTNER_ADMIN_ROLE");
    bytes32 public constant REGISTRAR_ROLE = keccak256("REGISTRAR_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    mapping(bytes32 partnerId => bool active) private _partners;
    mapping(address wallet => Wallet) private _wallets;

    constructor(address admin) {
        if (admin == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------- partner admin

    /// @inheritdoc IWalletRegistry
    function registerPartner(bytes32 partnerId) external onlyRole(PARTNER_ADMIN_ROLE) {
        if (partnerId == bytes32(0)) revert PartnerNotActive(partnerId);
        if (_partners[partnerId]) revert PartnerAlreadyRegistered(partnerId);
        _partners[partnerId] = true;
        emit PartnerRegistered(partnerId);
    }

    /// @inheritdoc IWalletRegistry
    function deactivatePartner(bytes32 partnerId) external onlyRole(PARTNER_ADMIN_ROLE) {
        if (!_partners[partnerId]) revert PartnerNotActive(partnerId);
        _partners[partnerId] = false;
        emit PartnerDeactivated(partnerId);
    }

    // ---------------------------------------------------------------- wallets

    /// @inheritdoc IWalletRegistry
    function registerWallet(address wallet, bytes32 partnerId, bytes32 kycAttestationHash)
        external
        onlyRole(REGISTRAR_ROLE)
    {
        if (wallet == address(0)) revert ZeroAddress();
        if (!_partners[partnerId]) revert PartnerNotActive(partnerId);
        if (kycAttestationHash == bytes32(0)) revert InvalidKycAttestation();
        if (_wallets[wallet].status != WalletStatus.None) revert WalletAlreadyRegistered(wallet);

        _wallets[wallet] = Wallet({
            partnerId: partnerId,
            kycAttestationHash: kycAttestationHash,
            registeredAt: uint64(block.timestamp),
            status: WalletStatus.Active
        });
        emit WalletRegistered(wallet, partnerId, kycAttestationHash);
    }

    /// @inheritdoc IWalletRegistry
    function freezeWallet(address wallet, bytes32 reasonCode) external onlyRole(COMPLIANCE_ROLE) {
        Wallet storage w = _requireRegistered(wallet);
        w.status = WalletStatus.Frozen;
        emit WalletFrozen(wallet, reasonCode);
    }

    /// @inheritdoc IWalletRegistry
    function unfreezeWallet(address wallet) external onlyRole(COMPLIANCE_ROLE) {
        Wallet storage w = _requireRegistered(wallet);
        w.status = WalletStatus.Active;
        emit WalletUnfrozen(wallet);
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc IWalletRegistry
    function isActive(address wallet) external view returns (bool) {
        Wallet storage w = _wallets[wallet];
        return w.status == WalletStatus.Active && _partners[w.partnerId];
    }

    /// @inheritdoc IWalletRegistry
    function isPartnerActive(bytes32 partnerId) external view returns (bool) {
        return _partners[partnerId];
    }

    /// @inheritdoc IWalletRegistry
    function getWallet(address wallet) external view returns (Wallet memory) {
        return _wallets[wallet];
    }

    // ---------------------------------------------------------------- internal

    function _requireRegistered(address wallet) private view returns (Wallet storage w) {
        w = _wallets[wallet];
        if (w.status == WalletStatus.None) revert WalletNotRegistered(wallet);
    }
}
