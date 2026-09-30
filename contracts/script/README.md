# Deploy scripts

Deployment scripts (`Deploy.s.sol`) arrive with the contract implementation PR.
They will deploy `WalletRegistry`, `MoharToken`, `ReserveRegistry` and, when no Chainlink
XAU/USD feed address is configured, a `MockV3Aggregator`, then grant the roles listed in
`docs/contracts.md`.
