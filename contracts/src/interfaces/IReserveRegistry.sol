// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title IReserveRegistry
/// @notice On-chain Proof-of-Reserve. The vault signs a daily attestation of total grams held
///         plus a Merkle root of every individual allocation; the MOHAR API relayer publishes it.
///         Anyone (partner, regulator, customer) can read the latest attestation and verify a
///         single allocation against the root without seeing the full allocation database.
///
///         If attested grams fall below token.totalSupply() at publish time, the registry pauses
///         minting on the token (burns stay open). Unpausing is a manual admin action after
///         reconciliation.
///
///         Vault accounting rule (so honest attestations never show a false shortfall): the vault
///         counts an allocation from the moment it signs it, and releases a de-allocation only
///         after the matching burn is confirmed on-chain.
///
///         Merkle leaves follow the OpenZeppelin merkle-tree JS library "standard" encoding:
///         leaf = keccak256(bytes.concat(keccak256(abi.encode(allocationRef, wallet, grams))))
///
/// @dev Roles: DEFAULT_ADMIN_ROLE (config), PUBLISHER_ROLE (MOHAR API relayer).
interface IReserveRegistry {
    /// EIP-712 type:
    /// ReserveAttestation(uint256 totalGrams,bytes32 allocationsRoot,uint64 asOf,uint256 nonce)
    struct ReserveAttestation {
        uint256 totalGrams; // grams in vault, 8 decimals
        bytes32 allocationsRoot; // Merkle root of individual allocations
        uint64 asOf; // unix seconds the vault snapshot was taken
        uint256 nonce; // strictly increasing
    }

    struct PublishedAttestation {
        ReserveAttestation attestation;
        uint256 tokenSupplyAtPublish;
        uint64 publishedAt;
    }

    // ---------------------------------------------------------------- events

    event AttestationPublished(
        uint256 indexed nonce,
        uint256 totalGrams,
        bytes32 allocationsRoot,
        uint64 asOf,
        uint256 tokenSupply
    );
    event ReserveShortfall(uint256 indexed nonce, uint256 totalGrams, uint256 tokenSupply);
    event VaultSignerUpdated(address indexed previous, address indexed current);

    // ---------------------------------------------------------------- errors

    error InvalidVaultSignature();
    error NonceNotIncreasing(uint256 lastNonce, uint256 nonce);
    error SnapshotOutOfOrder(uint64 lastAsOf, uint64 asOf);
    error NoAttestation();
    error ZeroAddress();

    // ---------------------------------------------------------------- publishing

    /// @notice Publishes a vault-signed attestation. PUBLISHER_ROLE only.
    function publish(ReserveAttestation calldata attestation, bytes calldata vaultSignature)
        external;

    function setVaultSigner(address signer) external;

    // ---------------------------------------------------------------- views

    function token() external view returns (address);

    function vaultSigner() external view returns (address);

    function attestationCount() external view returns (uint256);

    function attestationAt(uint256 index) external view returns (PublishedAttestation memory);

    function latest() external view returns (PublishedAttestation memory);

    /// @return true if the latest attestation covered the token supply at the moment it was
    ///         published. False if nothing has been published yet.
    function isFullyBacked() external view returns (bool);

    /// @notice Verifies one allocation against the latest published Merkle root.
    function verifyAllocation(
        bytes32 allocationRef,
        address wallet,
        uint256 grams,
        bytes32[] calldata proof
    ) external view returns (bool);
}
