// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title OSToken
 * @notice Unified cross-chain share token for a single RWA stock.
 *         e.g. osTSLA represents "TSLA exposure" regardless of which chain
 *         or issuer the underlying token comes from.
 *
 *         Only the Gateway contract can mint/burn.
 */
contract OSToken is ERC20, Ownable {
    address public gateway;

    event GatewayUpdated(address indexed newGateway);

    modifier onlyGateway() {
        require(msg.sender == gateway, "OSToken: only gateway");
        _;
    }

    constructor(
        string memory name_,
        string memory symbol_,
        address gateway_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        gateway = gateway_;
    }

    function mint(address to, uint256 amount) external onlyGateway {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external onlyGateway {
        _burn(from, amount);
    }

    function setGateway(address gateway_) external onlyOwner {
        gateway = gateway_;
        emit GatewayUpdated(gateway_);
    }

    function decimals() public pure override returns (uint8) {
        return 6; // same as USDC for simpler math
    }
}
