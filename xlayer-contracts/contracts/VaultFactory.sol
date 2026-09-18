// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "./OnStockVault.sol";

/**
 * @title VaultFactory
 * @notice Deploys OnStockVault instances for each xStock token.
 *         Registry for frontend to discover all vaults.
 */
contract VaultFactory is Ownable {
    /// @notice xStock address → vault address
    mapping(address => address) public vaults;

    /// @notice All deployed vault addresses
    address[] public allVaults;

    event VaultCreated(address indexed asset, address vault, string symbol);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Deploy a new vault for an xStock token
     * @param asset_ The xStock ERC-20 address
     * @param name_ Receipt token name (e.g. "OnStock TSLA Vault")
     * @param symbol_ Receipt token symbol (e.g. "osTSLA")
     * @param apyBps_ Target APY in basis points
     */
    function createVault(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        uint256 apyBps_
    ) external onlyOwner returns (address) {
        require(vaults[address(asset_)] == address(0), "Vault exists");

        OnStockVault vault = new OnStockVault(asset_, name_, symbol_, apyBps_);
        vault.transferOwnership(msg.sender);

        vaults[address(asset_)] = address(vault);
        allVaults.push(address(vault));

        emit VaultCreated(address(asset_), address(vault), symbol_);
        return address(vault);
    }

    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }
}
