// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title OSPool (THORChain-style liquidity pool)
 *
 *  Holds USDC reserves that back all tokens on this chain.
 *  Every token is backed by USDC somewhere in the pool network.
 *
 *  USDC flows:
 *    Buy:         user USDC → Pool (reserve grows)
 *    Sell:        Pool USDC → user (reserve shrinks)
 *    Bridge out:  USDC stays but marked as pending transfer to dest pool
 *    Bridge in:   Keeper deposits USDC received from source pool
 *
 *  LP: deposits USDC to provide cross-chain liquidity, earns bridge fees.
 */
contract OSPool is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public gateway;
    address public keeper;

    uint256 public totalReserve;        // USDC backing tokens on this chain
    uint256 public pendingOutbound;     // USDC owed to other chains
    uint256 public totalBridgeFees;     // accumulated bridge fees

    // LP
    mapping(address => uint256) public lpShares;
    uint256 public totalLpShares;

    event LpDeposit(address indexed lp, uint256 amount, uint256 shares);
    event LpWithdraw(address indexed lp, uint256 shares, uint256 usdcOut);
    event Buy(uint256 usdcAmount);
    event Sell(address indexed user, uint256 usdcAmount);
    event BridgeOut(uint256 usdcAmount);
    event BridgeIn(uint256 usdcAmount);

    modifier onlyGateway() {
        require(msg.sender == gateway, "only gateway");
        _;
    }

    modifier onlyKeeper() {
        require(msg.sender == keeper || msg.sender == owner(), "not keeper");
        _;
    }

    constructor(address _usdc, address _gateway, address _keeper) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        gateway = _gateway;
        keeper = _keeper;
    }

    // ── LP ───────────────────────────────────────────────────────────────────

    function lpDeposit(uint256 amount) external {
        require(amount > 0, "zero");
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        uint256 shares = (totalLpShares == 0 || totalReserve == 0)
            ? amount
            : (amount * totalLpShares) / totalReserve;

        lpShares[msg.sender] += shares;
        totalLpShares += shares;
        totalReserve += amount;
        emit LpDeposit(msg.sender, amount, shares);
    }

    function lpWithdraw(uint256 shares) external {
        require(shares > 0 && shares <= lpShares[msg.sender], "bad");
        uint256 usdcOut = (shares * totalReserve) / totalLpShares;
        require(usdcOut <= usdc.balanceOf(address(this)), "insufficient");

        lpShares[msg.sender] -= shares;
        totalLpShares -= shares;
        totalReserve -= usdcOut;
        usdc.safeTransfer(msg.sender, usdcOut);
        emit LpWithdraw(msg.sender, shares, usdcOut);
    }

    // ── Gateway calls ───────────────────────────────────────────────────────

    /// User buys token → USDC enters pool
    function onBuy(uint256 usdcAmount) external onlyGateway {
        totalReserve += usdcAmount;
        emit Buy(usdcAmount);
    }

    /// User sells token → Pool pays USDC to user
    function onSell(address user, uint256 usdcAmount) external onlyGateway {
        require(usdc.balanceOf(address(this)) >= usdcAmount, "insufficient");
        totalReserve -= usdcAmount;
        usdc.safeTransfer(user, usdcAmount);
        emit Sell(user, usdcAmount);
    }

    /// Bridge: mark USDC as pending outbound (token burned on this chain)
    function onBridgeOut(uint256 usdcAmount) external onlyGateway {
        pendingOutbound += usdcAmount;
        emit BridgeOut(usdcAmount);
    }

    /// Bridge: USDC arrived from another chain, now backs token minted here
    function onBridgeIn(uint256 usdcAmount) external onlyGateway {
        emit BridgeIn(usdcAmount);
    }

    // ── Keeper: cross-chain USDC transfer ───────────────────────────────────

    /// Keeper withdraws USDC to bridge to dest chain pool
    function rebalanceOut(uint256 amount, string calldata destChain) external onlyKeeper {
        require(usdc.balanceOf(address(this)) >= amount, "insufficient");
        require(pendingOutbound >= amount, "no pending");
        usdc.safeTransfer(keeper, amount);
        pendingOutbound -= amount;
        totalReserve -= amount;
    }

    /// Keeper deposits USDC received from source chain pool
    function rebalanceIn(uint256 amount, string calldata srcChain) external onlyKeeper {
        usdc.safeTransferFrom(keeper, address(this), amount);
        totalReserve += amount;
    }

    // ── View ────────────────────────────────────────────────────────────────

    function poolInfo() external view returns (
        uint256 reserve, uint256 lpTotal, uint256 pendingOut, uint256 usdcBalance
    ) {
        return (totalReserve, totalLpShares, pendingOutbound, usdc.balanceOf(address(this)));
    }

    function lpValue(address lp) external view returns (uint256) {
        if (totalLpShares == 0) return 0;
        return (lpShares[lp] * totalReserve) / totalLpShares;
    }

    // ── Admin ───────────────────────────────────────────────────────────────

    function setGateway(address _gw) external onlyOwner { gateway = _gw; }
    function setKeeper(address _k) external onlyOwner { keeper = _k; }
}
