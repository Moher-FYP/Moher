// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {MoharToken} from "../src/MoharToken.sol";
import {ReserveRegistry} from "../src/ReserveRegistry.sol";
import {WalletRegistry} from "../src/WalletRegistry.sol";
import {MockV3Aggregator} from "../src/mocks/MockV3Aggregator.sol";

/// @notice Deploys WalletRegistry, MoharToken and ReserveRegistry (plus a MockV3Aggregator when no
///         XAU/USD feed is given), grants every role from docs/contracts.md, registers the demo
///         partner, and writes the addresses to deployments/<chainId>.json for the API.
///
/// Local (Anvil, no env needed):
///   forge script script/Deploy.s.sol --rpc-url local --broadcast
/// Amoy:
///   source .env && forge script script/Deploy.s.sol --rpc-url amoy --broadcast
contract Deploy is Script {
    // Anvil's well-known development keys. Public knowledge — NEVER use them on a real network.
    uint256 internal constant ANVIL_KEY_0 =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address internal constant ANVIL_ACCOUNT_1 = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;
    address internal constant ANVIL_ACCOUNT_2 = 0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC;
    uint256 internal constant ANVIL_CHAIN_ID = 31337;

    struct Config {
        uint256 deployerKey;
        address admin;
        address relayer;
        address vaultSigner;
        address feed; // zero = deploy a mock
        int256 initialMockPrice;
        uint256 maxStaleness;
        bytes32 demoPartnerId;
    }

    struct Deployment {
        address walletRegistry;
        address token;
        address reserveRegistry;
        address priceFeed;
        bool mockFeed;
    }

    function run() external returns (Deployment memory d) {
        Config memory c = _config();

        vm.startBroadcast(c.deployerKey);

        d.mockFeed = c.feed == address(0);
        d.priceFeed = d.mockFeed
            ? address(new MockV3Aggregator(8, "XAU / USD (mock)", c.initialMockPrice))
            : c.feed;

        WalletRegistry registry = new WalletRegistry(c.admin);
        MoharToken token =
            new MoharToken(c.admin, address(registry), c.vaultSigner, d.priceFeed, c.maxStaleness);
        ReserveRegistry reserve = new ReserveRegistry(c.admin, address(token), c.vaultSigner);

        registry.grantRole(registry.PARTNER_ADMIN_ROLE(), c.admin);
        registry.grantRole(registry.COMPLIANCE_ROLE(), c.admin);
        registry.grantRole(registry.REGISTRAR_ROLE(), c.relayer);

        token.grantRole(token.PAUSER_ROLE(), c.admin);
        token.grantRole(token.SETTLEMENT_ROLE(), c.relayer);
        token.grantRole(token.OPERATOR_ROLE(), c.relayer);
        token.grantRole(token.RESERVE_GUARDIAN_ROLE(), address(reserve));

        reserve.grantRole(reserve.PUBLISHER_ROLE(), c.relayer);

        registry.registerPartner(c.demoPartnerId);

        vm.stopBroadcast();

        d.walletRegistry = address(registry);
        d.token = address(token);
        d.reserveRegistry = address(reserve);
        _write(d, c);
    }

    function _config() internal view returns (Config memory c) {
        bool local = block.chainid == ANVIL_CHAIN_ID;

        if (local) {
            c.deployerKey = vm.envOr("DEPLOYER_PRIVATE_KEY", ANVIL_KEY_0);
            c.relayer = vm.envOr("RELAYER_ADDRESS", ANVIL_ACCOUNT_1);
            c.vaultSigner = vm.envOr("VAULT_SIGNER_ADDRESS", ANVIL_ACCOUNT_2);
        } else {
            // On any public network every key and address must be given explicitly.
            c.deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
            c.relayer = vm.envAddress("RELAYER_ADDRESS");
            c.vaultSigner = vm.envAddress("VAULT_SIGNER_ADDRESS");
            require(c.deployerKey != ANVIL_KEY_0, "Deploy: Anvil key on a public network");
        }

        c.admin = vm.addr(c.deployerKey);
        c.feed = vm.envOr("XAU_USD_FEED_ADDRESS", address(0));
        c.initialMockPrice = vm.envOr("INITIAL_XAU_USD", int256(4_616e8));
        c.maxStaleness = vm.envOr("MAX_STALENESS_SECONDS", uint256(1 hours));
        c.demoPartnerId = keccak256(bytes(vm.envOr("DEMO_PARTNER_ID", string("demo-bank"))));
    }

    function _write(Deployment memory d, Config memory c) internal {
        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "admin", c.admin);
        vm.serializeAddress(key, "relayer", c.relayer);
        vm.serializeAddress(key, "vaultSigner", c.vaultSigner);
        vm.serializeAddress(key, "walletRegistry", d.walletRegistry);
        vm.serializeAddress(key, "moharToken", d.token);
        vm.serializeAddress(key, "reserveRegistry", d.reserveRegistry);
        vm.serializeAddress(key, "xauUsdFeed", d.priceFeed);
        vm.serializeBool(key, "mockFeed", d.mockFeed);
        vm.serializeUint(key, "maxStaleness", c.maxStaleness);
        string memory json = vm.serializeBytes32(key, "demoPartnerId", c.demoPartnerId);

        string memory path =
            string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);

        console2.log("WalletRegistry  ", d.walletRegistry);
        console2.log("MoharToken      ", d.token);
        console2.log("ReserveRegistry ", d.reserveRegistry);
        console2.log("XAU/USD feed    ", d.priceFeed, d.mockFeed ? "(mock)" : "(Chainlink)");
        console2.log("Written to      ", path);
    }
}
