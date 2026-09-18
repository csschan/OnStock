// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title OnStockVault
 * @notice ERC4626 vault for tokenized stocks on X Layer.
 *         Users deposit xStock tokens and receive receipt shares.
 *         Yield is simulated via owner calling `addYield()`.
 *
 * Flow: User deposits TSLAx → receives osTSLA shares → earns yield → withdraws TSLAx
 */
contract OnStockVault is ERC4626, Ownable {
    /// @notice Tracks total yield injected (for APY display)
    uint256 public totalYieldAdded;

    /// @notice Timestamp of last yield injection
    uint256 public lastYieldTime;

    /// @notice Target APY in basis points (e.g. 420 = 4.20%)
    uint256 public targetApyBps;

    event YieldAdded(uint256 amount, uint256 timestamp);
    event ApyUpdated(uint256 newApyBps);

    constructor(
        IERC20 asset_,
        string memory name_,
        string memory symbol_,
        uint256 apyBps_
    )
        ERC4626(asset_)
        ERC20(name_, symbol_)
        Ownable(msg.sender)
    {
        targetApyBps = apyBps_;
        lastYieldTime = block.timestamp;
    }

    /**
     * @notice Owner injects yield (simulates auto-compounding from Aave/lending).
     *         In production this would come from actual lending protocol rewards.
     * @param amount Amount of underlying asset to add as yield
     */
    function addYield(uint256 amount) external onlyOwner {
        IERC20(asset()).transferFrom(msg.sender, address(this), amount);
        totalYieldAdded += amount;
        lastYieldTime = block.timestamp;
        emit YieldAdded(amount, block.timestamp);
    }

    /**
     * @notice Update target APY (for display/frontend purposes)
     */
    function setTargetApy(uint256 apyBps_) external onlyOwner {
        targetApyBps = apyBps_;
        emit ApyUpdated(apyBps_);
    }

    /**
     * @notice Returns the total assets held by the vault (deposits + yield)
     */
    function totalAssets() public view override returns (uint256) {
        return IERC20(asset()).balanceOf(address(this));
    }

    /**
     * @notice Returns vault stats for frontend display
     */
    function getVaultInfo() external view returns (
        uint256 _totalAssets,
        uint256 _totalShares,
        uint256 _targetApyBps,
        uint256 _totalYieldAdded,
        uint256 _lastYieldTime
    ) {
        return (
            totalAssets(),
            totalSupply(),
            targetApyBps,
            totalYieldAdded,
            lastYieldTime
        );
    }
}
