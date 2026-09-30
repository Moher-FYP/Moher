// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IWalletRegistry
/// @notice Records which custodial wallets may hold MOHAR, and which partner institution
///         onboarded them. KYC/AML is performed by the partner; MOHAR relies on the partner's
///         attestation (FATF Recommendation 17 reliance model) and keeps only a hash of the
///         partner's KYC reference on-chain — never personal data.
/// @dev Roles (OpenZeppelin AccessControl):
///      - DEFAULT_ADMIN_ROLE: MOHAR admin (multisig in production)
///      - PARTNER_ADMIN_ROLE: registers / deactivates partner institutions
///      - REGISTRAR_ROLE:     MOHAR API relayer; registers wallets on a partner's behalf
///      - COMPLIANCE_ROLE:    freezes / unfreezes wallets (AML action)
interface IWalletRegistry {
    enum WalletStatus {
        None, // never registered
        Active,
        Frozen
    }

    struct Wallet {
        bytes32 partnerId; // partner institution that onboarded the customer
        bytes32 kycAttestationHash; // keccak256 of the partner's KYC reference; no PII on-chain
        uint64 registeredAt;
        WalletStatus status;
    }

    // ---------------------------------------------------------------- events

    event PartnerRegistered(bytes32 indexed partnerId);
    event PartnerDeactivated(bytes32 indexed partnerId);
    event WalletRegistered(
        address indexed wallet, bytes32 indexed partnerId, bytes32 kycAttestationHash
    );
    event WalletFrozen(address indexed wallet, bytes32 reasonCode);
    event WalletUnfrozen(address indexed wallet);

    // ---------------------------------------------------------------- errors

    error PartnerNotActive(bytes32 partnerId);
    error PartnerAlreadyRegistered(bytes32 partnerId);
    error WalletAlreadyRegistered(address wallet);
    error WalletNotRegistered(address wallet);
    error InvalidKycAttestation();
    error ZeroAddress();

    // ---------------------------------------------------------------- partner admin

    function registerPartner(bytes32 partnerId) external;

    function deactivatePartner(bytes32 partnerId) external;

    // ---------------------------------------------------------------- wallets

    /// @notice Registers a custodial wallet after the partner confirms the customer passed KYC.
    /// @param kycAttestationHash keccak256 of the partner's KYC reference (must be non-zero).
    function registerWallet(address wallet, bytes32 partnerId, bytes32 kycAttestationHash) external;

    /// @notice Blocks a wallet from minting, burning and transferring (AML action).
    function freezeWallet(address wallet, bytes32 reasonCode) external;

    function unfreezeWallet(address wallet) external;

    // ---------------------------------------------------------------- views

    /// @return true if the wallet is Active and its partner is still active.
    function isActive(address wallet) external view returns (bool);

    function isPartnerActive(bytes32 partnerId) external view returns (bool);

    function getWallet(address wallet) external view returns (Wallet memory);
}
