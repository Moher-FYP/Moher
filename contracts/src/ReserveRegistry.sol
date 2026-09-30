// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MerkleProof} from "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import {IMoharToken} from "./interfaces/IMoharToken.sol";
import {IReserveRegistry} from "./interfaces/IReserveRegistry.sol";
import {MoharTypes} from "./libraries/MoharTypes.sol";

/// @title ReserveRegistry
/// @notice On-chain Proof-of-Reserve for MOHAR. Publishes vault-signed attestations and pauses
///         minting on the token if the vault's grams do not cover the token supply.
/// @dev Needs RESERVE_GUARDIAN_ROLE on the token to pause minting.
contract ReserveRegistry is IReserveRegistry, EIP712, AccessControl {
    bytes32 public constant PUBLISHER_ROLE = keccak256("PUBLISHER_ROLE");

    address private immutable TOKEN;
    address private _vaultSigner;
    PublishedAttestation[] private _history;

    constructor(address admin, address token_, address vaultSigner_)
        EIP712(MoharTypes.RESERVE_EIP712_NAME, MoharTypes.EIP712_VERSION)
    {
        if (admin == address(0) || token_ == address(0)) revert ZeroAddress();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        TOKEN = token_;
        _setVaultSigner(vaultSigner_);
    }

    // ---------------------------------------------------------------- publishing

    /// @inheritdoc IReserveRegistry
    function publish(ReserveAttestation calldata attestation, bytes calldata vaultSignature)
        external
        onlyRole(PUBLISHER_ROLE)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                MoharTypes.RESERVE_ATTESTATION_TYPEHASH,
                attestation.totalGrams,
                attestation.allocationsRoot,
                attestation.asOf,
                attestation.nonce
            )
        );
        (address signer, ECDSA.RecoverError err,) =
            ECDSA.tryRecover(_hashTypedDataV4(structHash), vaultSignature);
        if (err != ECDSA.RecoverError.NoError || signer != _vaultSigner) {
            revert InvalidVaultSignature();
        }

        uint256 count = _history.length;
        if (count > 0) {
            ReserveAttestation storage last = _history[count - 1].attestation;
            if (attestation.nonce <= last.nonce) {
                revert NonceNotIncreasing(last.nonce, attestation.nonce);
            }
            if (attestation.asOf < last.asOf) {
                revert SnapshotOutOfOrder(last.asOf, attestation.asOf);
            }
        }

        uint256 supply = IERC20(TOKEN).totalSupply();
        _history.push(
            PublishedAttestation({
                attestation: attestation,
                tokenSupplyAtPublish: supply,
                publishedAt: uint64(block.timestamp)
            })
        );
        emit AttestationPublished(
            attestation.nonce,
            attestation.totalGrams,
            attestation.allocationsRoot,
            attestation.asOf,
            supply
        );

        if (attestation.totalGrams < supply) {
            emit ReserveShortfall(attestation.nonce, attestation.totalGrams, supply);
            IMoharToken(TOKEN).pauseMinting();
        }
    }

    /// @inheritdoc IReserveRegistry
    function setVaultSigner(address signer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setVaultSigner(signer);
    }

    // ---------------------------------------------------------------- views

    function token() external view returns (address) {
        return TOKEN;
    }

    function vaultSigner() external view returns (address) {
        return _vaultSigner;
    }

    function attestationCount() external view returns (uint256) {
        return _history.length;
    }

    function attestationAt(uint256 index) external view returns (PublishedAttestation memory) {
        return _history[index];
    }

    /// @inheritdoc IReserveRegistry
    function latest() public view returns (PublishedAttestation memory) {
        if (_history.length == 0) revert NoAttestation();
        return _history[_history.length - 1];
    }

    /// @inheritdoc IReserveRegistry
    function isFullyBacked() external view returns (bool) {
        if (_history.length == 0) return false;
        PublishedAttestation storage last = _history[_history.length - 1];
        return last.attestation.totalGrams >= last.tokenSupplyAtPublish;
    }

    /// @inheritdoc IReserveRegistry
    function verifyAllocation(
        bytes32 allocationRef,
        address wallet,
        uint256 grams,
        bytes32[] calldata proof
    ) external view returns (bool) {
        if (_history.length == 0) return false;
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(allocationRef, wallet, grams))));
        return MerkleProof.verifyCalldata(
            proof, _history[_history.length - 1].attestation.allocationsRoot, leaf
        );
    }

    /// @notice EIP-712 domain separator, exposed for off-chain signers and tests.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ---------------------------------------------------------------- internal

    function _setVaultSigner(address signer) private {
        if (signer == address(0)) revert ZeroAddress();
        emit VaultSignerUpdated(_vaultSigner, signer);
        _vaultSigner = signer;
    }
}
