// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title IMoharToken
/// @notice ERC-20 representing an undivided beneficial interest in vault-allocated 24K gold.
///         1 MOHAR = 1 gram. decimals() == 8, so the smallest unit is 0.00000001 g.
///
///         Settlement model (AAOIFI SS-57, spot basis / qabd):
///         1. The MOHAR API quotes a price from the XAU/USD oracle and locks it for ~60 seconds.
///         2. The (mock) vault signs an EIP-712 Allocation for exactly `grams` for `wallet`.
///         3. The API relayer calls mint(). In ONE transaction the contract checks the vault
///            signature, re-reads the oracle, rejects the trade if the live price has moved more
///            than maxDeviationBps from the quote (gharar control), and mints.
///         Burns mirror this with a Deallocation signature.
///
/// @dev Roles (OpenZeppelin AccessControl):
///      - DEFAULT_ADMIN_ROLE:     MOHAR admin (multisig in production); config setters
///      - SETTLEMENT_ROLE:        MOHAR API relayer; calls mint() and burn()
///      - OPERATOR_ROLE:          MOHAR API relayer; custodial transfers between wallets
///      - PAUSER_ROLE:            pauses / unpauses minting manually
///      - RESERVE_GUARDIAN_ROLE:  held by the ReserveRegistry; pauses minting on a shortfall
///      Wallet rules: every recipient and sender must be Active in the WalletRegistry.
///      Pausing minting never blocks burns, so holders can always exit.
interface IMoharToken is IERC20 {
    /// @notice Vault receipt confirming `grams` of physical gold were allocated to `wallet`.
    /// EIP-712 type:
    /// Allocation(address wallet,uint256 grams,bytes32 allocationRef,uint256 deadline)
    struct Allocation {
        address wallet;
        uint256 grams; // 8 decimals
        bytes32 allocationRef; // vault's allocation record id; single use
        uint256 deadline; // unix seconds; signature invalid after this
    }

    /// @notice Vault receipt confirming `grams` were de-allocated from `wallet`.
    /// EIP-712 type:
    /// Deallocation(address wallet,uint256 grams,bytes32 deallocationRef,uint256 deadline)
    struct Deallocation {
        address wallet;
        uint256 grams; // 8 decimals
        bytes32 deallocationRef; // single use
        uint256 deadline;
    }

    // ---------------------------------------------------------------- events

    /// @param oraclePrice XAU/USD per troy ounce read on-chain in this transaction (8 decimals)
    /// @param quotedPrice XAU/USD price shown to the customer in the quote (8 decimals)
    event Minted(
        address indexed wallet,
        uint256 grams,
        uint256 oraclePrice,
        uint256 quotedPrice,
        bytes32 indexed allocationRef
    );
    event Burned(
        address indexed wallet,
        uint256 grams,
        uint256 oraclePrice,
        uint256 quotedPrice,
        bytes32 indexed deallocationRef
    );
    event OperatorTransfer(address indexed from, address indexed to, uint256 grams);
    event MintingPaused(address indexed by);
    event MintingUnpaused(address indexed by);
    event VaultSignerUpdated(address indexed previous, address indexed current);
    event PriceFeedUpdated(address indexed feed, uint256 maxStaleness);
    event MaxDeviationUpdated(uint16 maxDeviationBps);

    // ---------------------------------------------------------------- errors

    error ZeroAmount();
    error WalletNotActive(address wallet);
    error InvalidVaultSignature();
    error AttestationExpired(uint256 deadline);
    error RefAlreadyUsed(bytes32 ref);
    error MintingIsPaused();
    error InvalidPrice(int256 answer);
    error StalePrice(uint256 updatedAt);
    error PriceDeviationTooHigh(uint256 oraclePrice, uint256 quotedPrice, uint256 deviationBps);

    // ---------------------------------------------------------------- settlement

    /// @notice Mints `allocation.grams` to `allocation.wallet`. SETTLEMENT_ROLE only.
    /// @param quotedPrice XAU/USD (8 decimals) from the quote the customer accepted.
    /// @param vaultSignature EIP-712 signature over `allocation` by vaultSigner().
    function mint(
        Allocation calldata allocation,
        uint256 quotedPrice,
        bytes calldata vaultSignature
    ) external;

    /// @notice Burns `deallocation.grams` from `deallocation.wallet`. SETTLEMENT_ROLE only.
    ///         Fiat payout is handled off-chain by the partner institution.
    function burn(
        Deallocation calldata deallocation,
        uint256 quotedPrice,
        bytes calldata vaultSignature
    ) external;

    /// @notice Custodial transfer between two Active wallets. OPERATOR_ROLE only.
    function operatorTransfer(address from, address to, uint256 grams) external;

    // ---------------------------------------------------------------- controls

    function pauseMinting() external;

    function unpauseMinting() external;

    function setVaultSigner(address signer) external;

    /// @param feed Chainlink-compatible XAU/USD feed with 8 decimals
    /// @param maxStaleness maximum age of the oracle answer in seconds
    function setPriceFeed(address feed, uint256 maxStaleness) external;

    /// @param maxDeviationBps maximum allowed move between quote and execution (50 = 0.50%)
    function setMaxDeviationBps(uint16 maxDeviationBps) external;

    // ---------------------------------------------------------------- views

    function mintingPaused() external view returns (bool);

    function vaultSigner() external view returns (address);

    function walletRegistry() external view returns (address);

    function priceFeed() external view returns (address);

    function maxStaleness() external view returns (uint256);

    function maxDeviationBps() external view returns (uint16);

    function isRefUsed(bytes32 ref) external view returns (bool);

    /// @return price XAU/USD per troy ounce (8 decimals) and the time it was last updated
    function latestPrice() external view returns (uint256 price, uint256 updatedAt);
}
