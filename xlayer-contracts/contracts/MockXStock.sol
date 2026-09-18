// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockXStock
 * @notice Mock tokenized stock for X Layer testnet (e.g. TSLAx, NVDAx, SPYx)
 *         Owner can mint freely for testing. Decimals = 18.
 */
contract MockXStock is ERC20, Ownable {
    constructor(
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {}

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    /// @notice Testnet faucet — anyone can claim 100 tokens once
    mapping(address => bool) public claimed;

    function faucet() external {
        require(!claimed[msg.sender], "Already claimed");
        claimed[msg.sender] = true;
        _mint(msg.sender, 100 * 10 ** decimals());
    }
}
