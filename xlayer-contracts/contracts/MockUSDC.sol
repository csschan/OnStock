// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockUSDC
 * @notice Mock USDC for X Layer testnet. 6 decimals like real USDC.
 */
contract MockUSDC is ERC20, Ownable {
    constructor() ERC20("USD Coin", "USDC") Ownable(msg.sender) {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Testnet faucet — anyone can claim 10,000 USDC once
    mapping(address => bool) public claimed;

    function faucet() external {
        require(!claimed[msg.sender], "Already claimed");
        claimed[msg.sender] = true;
        _mint(msg.sender, 10_000 * 10 ** decimals());
    }
}
