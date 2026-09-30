// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {AggregatorV3Interface} from "./interfaces/AggregatorV3Interface.sol";
import {IMoharToken} from "./interfaces/IMoharToken.sol";
import {IWalletRegistry} from "./interfaces/IWalletRegistry.sol";
import {MoharTypes} from "./libraries/MoharTypes.sol";

/// @title MoharToken
/// @notice ERC-20 gold token: 1 MOHAR = 1 gram of vault-allocated 24K gold, 8 decimals.
///         Mint and burn settle atomically against a vault signature and the XAU/USD oracle
///         (AAOIFI SS-57 spot basis). See docs/contracts.md for the full sequence.
contract MoharToken is IMoharToken, ERC20, EIP712, AccessControl {
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant RESERVE_GUARDIAN_ROLE = keccak256("RESERVE_GUARDIAN_ROLE");

    /// @dev Upper bound for maxDeviationBps (10%), to stop a misconfiguration disabling the check.
    uint16 public constant MAX_DEVIATION_LIMIT_BPS = 1_000;

    IWalletRegistry private immutable REGISTRY;

    address private _vaultSigner;
    AggregatorV3Interface private _priceFeed;
    uint256 private _maxStaleness;
    uint16 private _maxDeviationBps;
    bool private _mintingPaused;

    mapping(bytes32 ref => bool used) private _usedRefs;

    constructor(
        address admin,
        address walletRegistry_,
        address vaultSigner_,
        address priceFeed_,
        uint256 maxStaleness_
    ) ERC20("MOHAR Gold", "MOHAR") EIP712(MoharTypes.TOKEN_EIP712_NAME, MoharTypes.EIP712_VERSION) {
        if (admin == address(0) || walletRegistry_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        REGISTRY = IWalletRegistry(walletRegistry_);
        _setVaultSigner(vaultSigner_);
        _setPriceFeed(priceFeed_, maxStaleness_);
        _setMaxDeviationBps(MoharTypes.DEFAULT_MAX_DEVIATION_BPS);
    }

    // ---------------------------------------------------------------- ERC-20

    /// @notice 8 decimals: the smallest unit is 0.00000001 g.
    function decimals() public pure override returns (uint8) {
        return MoharTypes.TOKEN_DECIMALS;
    }

    /// @dev Every token movement (mint, burn, transfer) requires Active wallets on both ends.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && !REGISTRY.isActive(from)) revert WalletNotActive(from);
        if (to != address(0) && !REGISTRY.isActive(to)) revert WalletNotActive(to);
        super._update(from, to, value);
    }

    // ---------------------------------------------------------------- settlement

    /// @inheritdoc IMoharToken
    function mint(
        Allocation calldata allocation,
        uint256 quotedPrice,
        bytes calldata vaultSignature
    ) external onlyRole(SETTLEMENT_ROLE) {
        if (_mintingPaused) revert MintingIsPaused();
        if (allocation.grams == 0) revert ZeroAmount();

        bytes32 structHash = keccak256(
            abi.encode(
                MoharTypes.ALLOCATION_TYPEHASH,
                allocation.wallet,
                allocation.grams,
                allocation.allocationRef,
                allocation.deadline
            )
        );
        _consumeVaultReceipt(
            structHash, allocation.allocationRef, allocation.deadline, vaultSignature
        );
        uint256 oraclePrice = _checkedPrice(quotedPrice);

        _mint(allocation.wallet, allocation.grams);
        emit Minted(
            allocation.wallet, allocation.grams, oraclePrice, quotedPrice, allocation.allocationRef
        );
    }

    /// @inheritdoc IMoharToken
    function burn(
        Deallocation calldata deallocation,
        uint256 quotedPrice,
        bytes calldata vaultSignature
    ) external onlyRole(SETTLEMENT_ROLE) {
        if (deallocation.grams == 0) revert ZeroAmount();

        bytes32 structHash = keccak256(
            abi.encode(
                MoharTypes.DEALLOCATION_TYPEHASH,
                deallocation.wallet,
                deallocation.grams,
                deallocation.deallocationRef,
                deallocation.deadline
            )
        );
        _consumeVaultReceipt(
            structHash, deallocation.deallocationRef, deallocation.deadline, vaultSignature
        );
        uint256 oraclePrice = _checkedPrice(quotedPrice);

        _burn(deallocation.wallet, deallocation.grams);
        emit Burned(
            deallocation.wallet,
            deallocation.grams,
            oraclePrice,
            quotedPrice,
            deallocation.deallocationRef
        );
    }

    /// @inheritdoc IMoharToken
    function operatorTransfer(address from, address to, uint256 grams)
        external
        onlyRole(OPERATOR_ROLE)
    {
        if (grams == 0) revert ZeroAmount();
        _transfer(from, to, grams);
        emit OperatorTransfer(from, to, grams);
    }

    // ---------------------------------------------------------------- controls

    /// @inheritdoc IMoharToken
    /// @dev Callable by PAUSER_ROLE or RESERVE_GUARDIAN_ROLE (the ReserveRegistry). Idempotent.
    function pauseMinting() external {
        if (!hasRole(PAUSER_ROLE, msg.sender) && !hasRole(RESERVE_GUARDIAN_ROLE, msg.sender)) {
            revert AccessControlUnauthorizedAccount(msg.sender, PAUSER_ROLE);
        }
        if (!_mintingPaused) {
            _mintingPaused = true;
            emit MintingPaused(msg.sender);
        }
    }

    /// @inheritdoc IMoharToken
    function unpauseMinting() external onlyRole(PAUSER_ROLE) {
        if (_mintingPaused) {
            _mintingPaused = false;
            emit MintingUnpaused(msg.sender);
        }
    }

    /// @inheritdoc IMoharToken
    function setVaultSigner(address signer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setVaultSigner(signer);
    }

    /// @inheritdoc IMoharToken
    function setPriceFeed(address feed, uint256 maxStaleness_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        _setPriceFeed(feed, maxStaleness_);
    }

    /// @inheritdoc IMoharToken
    function setMaxDeviationBps(uint16 maxDeviationBps_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setMaxDeviationBps(maxDeviationBps_);
    }

    // ---------------------------------------------------------------- views

    function mintingPaused() external view returns (bool) {
        return _mintingPaused;
    }

    function vaultSigner() external view returns (address) {
        return _vaultSigner;
    }

    function walletRegistry() external view returns (address) {
        return address(REGISTRY);
    }

    function priceFeed() external view returns (address) {
        return address(_priceFeed);
    }

    function maxStaleness() external view returns (uint256) {
        return _maxStaleness;
    }

    function maxDeviationBps() external view returns (uint16) {
        return _maxDeviationBps;
    }

    function isRefUsed(bytes32 ref) external view returns (bool) {
        return _usedRefs[ref];
    }

    /// @inheritdoc IMoharToken
    function latestPrice() public view returns (uint256 price, uint256 updatedAt) {
        (, int256 answer,, uint256 updated,) = _priceFeed.latestRoundData();
        if (answer <= 0) revert InvalidPrice(answer);
        if (updated + _maxStaleness < block.timestamp) revert StalePrice(updated);
        // forge-lint: disable-next-line(unsafe-typecast)
        return (uint256(answer), updated); // answer > 0 checked above
    }

    /// @notice EIP-712 domain separator, exposed for off-chain signers and tests.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------- internal

    /// @dev Checks deadline, single use and the vault's EIP-712 signature, then burns the ref.
    function _consumeVaultReceipt(
        bytes32 structHash,
        bytes32 ref,
        uint256 deadline,
        bytes calldata signature
    ) private {
        if (block.timestamp > deadline) revert AttestationExpired(deadline);
        if (_usedRefs[ref]) revert RefAlreadyUsed(ref);

        (address signer, ECDSA.RecoverError err,) =
            ECDSA.tryRecover(_hashTypedDataV4(structHash), signature);
        if (err != ECDSA.RecoverError.NoError || signer != _vaultSigner) {
            revert InvalidVaultSignature();
        }
        _usedRefs[ref] = true;
    }

    /// @dev Reads the oracle and enforces the quote-to-execution deviation bound (gharar control).
    function _checkedPrice(uint256 quotedPrice) private view returns (uint256 oraclePrice) {
        (oraclePrice,) = latestPrice();
        if (quotedPrice == 0) revert InvalidPrice(0);
        uint256 deviation = MoharTypes.deviationBps(quotedPrice, oraclePrice);
        if (deviation > _maxDeviationBps) {
            revert PriceDeviationTooHigh(oraclePrice, quotedPrice, deviation);
        }
    }

    function _setVaultSigner(address signer) private {
        if (signer == address(0)) revert ZeroAddress();
        emit VaultSignerUpdated(_vaultSigner, signer);
        _vaultSigner = signer;
    }

    function _setPriceFeed(address feed, uint256 maxStaleness_) private {
        if (feed == address(0) || feed.code.length == 0) revert InvalidPriceFeed(feed);
        if (AggregatorV3Interface(feed).decimals() != MoharTypes.PRICE_DECIMALS) {
            revert InvalidPriceFeed(feed);
        }
        if (maxStaleness_ == 0) revert InvalidStaleness(maxStaleness_);
        _priceFeed = AggregatorV3Interface(feed);
        _maxStaleness = maxStaleness_;
        emit PriceFeedUpdated(feed, maxStaleness_);
    }

    function _setMaxDeviationBps(uint16 maxDeviationBps_) private {
        if (maxDeviationBps_ == 0 || maxDeviationBps_ > MAX_DEVIATION_LIMIT_BPS) {
            revert InvalidMaxDeviation(maxDeviationBps_);
        }
        _maxDeviationBps = maxDeviationBps_;
        emit MaxDeviationUpdated(maxDeviationBps_);
    }
}
