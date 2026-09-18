// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title MockAavePool
 * @notice Simulates Aave V3 lending pool on X Layer testnet.
 *         Users supply xStock tokens and receive aTokens (interest-bearing).
 *         APY is simulated via owner calling `accrueInterest()`.
 *
 * Simplified Aave interface: supply() / withdraw() / getReserveData()
 */
contract MockAavePool is Ownable {
    struct ReserveData {
        address aTokenAddress;
        uint128 currentLiquidityRate; // ray (1e27) — supply APY
        uint128 currentVariableBorrowRate;
        uint256 totalSupply;
        uint256 totalBorrow;
    }

    /// @notice asset → reserve data
    mapping(address => ReserveData) public reserves;

    /// @notice All registered assets
    address[] public registeredAssets;

    event Supply(address indexed asset, address indexed user, uint256 amount);
    event Withdraw(address indexed asset, address indexed user, uint256 amount);
    event InterestAccrued(address indexed asset, uint256 amount);

    constructor() Ownable(msg.sender) {}

    /**
     * @notice Register a new asset for lending (owner only)
     * @param asset The xStock token address
     * @param aToken The aToken (receipt) address
     * @param supplyRateRay Supply APY in ray (e.g. 3.5% = 0.035e27)
     */
    function registerReserve(
        address asset,
        address aToken,
        uint128 supplyRateRay
    ) external onlyOwner {
        reserves[asset] = ReserveData({
            aTokenAddress: aToken,
            currentLiquidityRate: supplyRateRay,
            currentVariableBorrowRate: supplyRateRay * 2, // borrow = 2x supply
            totalSupply: 0,
            totalBorrow: 0
        });
        registeredAssets.push(asset);
    }

    /**
     * @notice Supply xStock tokens to earn yield (like Aave supply)
     */
    function supply(address asset, uint256 amount, address onBehalfOf, uint16 /* referralCode */) external {
        ReserveData storage r = reserves[asset];
        require(r.aTokenAddress != address(0), "Reserve not registered");

        IERC20(asset).transferFrom(msg.sender, address(this), amount);
        MockAToken(r.aTokenAddress).mint(onBehalfOf, amount);
        r.totalSupply += amount;

        emit Supply(asset, onBehalfOf, amount);
    }

    /**
     * @notice Withdraw xStock tokens (burn aTokens)
     */
    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        ReserveData storage r = reserves[asset];
        require(r.aTokenAddress != address(0), "Reserve not registered");

        uint256 userBalance = MockAToken(r.aTokenAddress).balanceOf(msg.sender);
        uint256 withdrawAmount = amount > userBalance ? userBalance : amount;

        MockAToken(r.aTokenAddress).burn(msg.sender, withdrawAmount);
        IERC20(asset).transfer(to, withdrawAmount);
        r.totalSupply -= withdrawAmount;

        emit Withdraw(asset, msg.sender, withdrawAmount);
        return withdrawAmount;
    }

    /**
     * @notice Simulate interest accrual (owner mints extra xStock to pool)
     */
    function accrueInterest(address asset, uint256 yieldAmount) external onlyOwner {
        // Owner transfers yield tokens into pool, increasing aToken value
        IERC20(asset).transferFrom(msg.sender, address(this), yieldAmount);
        emit InterestAccrued(asset, yieldAmount);
    }

    /**
     * @notice Update supply rate (for demo — simulate APY changes)
     */
    function setSupplyRate(address asset, uint128 supplyRateRay) external onlyOwner {
        reserves[asset].currentLiquidityRate = supplyRateRay;
    }

    /**
     * @notice Get reserve data (Aave V3 compatible interface)
     */
    function getReserveData(address asset) external view returns (
        address aTokenAddress,
        uint128 currentLiquidityRate,
        uint128 currentVariableBorrowRate,
        uint256 totalSupply,
        uint256 totalBorrow
    ) {
        ReserveData memory r = reserves[asset];
        return (r.aTokenAddress, r.currentLiquidityRate, r.currentVariableBorrowRate, r.totalSupply, r.totalBorrow);
    }

    function registeredAssetCount() external view returns (uint256) {
        return registeredAssets.length;
    }
}

/**
 * @title MockAToken
 * @notice Interest-bearing receipt token (like Aave aToken).
 *         Only the pool contract can mint/burn.
 */
contract MockAToken is ERC20, Ownable {
    address public pool;

    constructor(
        string memory name_,
        string memory symbol_,
        address pool_
    ) ERC20(name_, symbol_) Ownable(msg.sender) {
        pool = pool_;
    }

    function mint(address to, uint256 amount) external {
        require(msg.sender == pool, "Only pool");
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) external {
        require(msg.sender == pool, "Only pool");
        _burn(from, amount);
    }
}
