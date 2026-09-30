// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title MoharTypes
/// @notice Shared units and EIP-712 type hashes. The API's signer code MUST use the exact same
///         type strings — see docs/contracts.md.
library MoharTypes {
    /// @notice 1 MOHAR = 1 gram of 24K gold, 8 decimals.
    uint8 internal constant TOKEN_DECIMALS = 8;
    uint256 internal constant ONE_GRAM = 1e8;

    /// @notice Chainlink XAU/USD answers are USD per troy ounce with 8 decimals.
    uint8 internal constant PRICE_DECIMALS = 8;

    /// @notice Grams per troy ounce, scaled by 1e4 (31.1035 g).
    uint256 internal constant GRAMS_PER_TROY_OUNCE_E4 = 311_035;

    uint16 internal constant BPS_DENOMINATOR = 10_000;
    uint16 internal constant DEFAULT_MAX_DEVIATION_BPS = 50; // 0.50%

    string internal constant TOKEN_EIP712_NAME = "MOHAR";
    string internal constant RESERVE_EIP712_NAME = "MOHAR Reserve";
    string internal constant EIP712_VERSION = "1";

    bytes32 internal constant ALLOCATION_TYPEHASH = keccak256(
        "Allocation(address wallet,uint256 grams,bytes32 allocationRef,uint256 deadline)"
    );

    bytes32 internal constant DEALLOCATION_TYPEHASH = keccak256(
        "Deallocation(address wallet,uint256 grams,bytes32 deallocationRef,uint256 deadline)"
    );

    bytes32 internal constant RESERVE_ATTESTATION_TYPEHASH = keccak256(
        "ReserveAttestation(uint256 totalGrams,bytes32 allocationsRoot,uint64 asOf,uint256 nonce)"
    );

    /// @notice Absolute deviation between two prices in basis points of `quoted`.
    function deviationBps(uint256 quoted, uint256 observed) internal pure returns (uint256) {
        uint256 diff = quoted > observed ? quoted - observed : observed - quoted;
        return (diff * BPS_DENOMINATOR) / quoted;
    }
}
