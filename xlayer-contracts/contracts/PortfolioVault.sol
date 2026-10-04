// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title PortfolioVault
 * @notice One-token diversified RWA portfolio.
 *         Users deposit USDC → get osPFO shares → keeper auto-rebalances
 *         using RWA scoring engine (NAV deviation, freshness, issuer trust).
 *
 *         Unlike Ondo Intelligent Portfolios (BlackRock fixed strategy),
 *         weights are driven by on-chain data signals, not human discretion.
 *
 * Flow:
 *   1. User deposits USDC → receives osPFO shares
 *   2. Keeper buys xStock tokens per target weights
 *   3. Keeper periodically calls rebalance() with new weights
 *   4. User redeems osPFO → gets proportional USDC back
 */
contract PortfolioVault is ERC20, Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    address public keeper;

    // Portfolio assets
    address[] public assetTokens;
    uint256[] public targetWeights;     // basis points, sum = 10000
    uint256 public assetCount;

    // Accounting
    uint256 public totalDepositedUsd;   // cumulative USDC deposited
    uint256 public lastRebalanceTime;
    uint256 public rebalanceCount;

    // Events
    event Deposit(address indexed user, uint256 usdcAmount, uint256 shares);
    event Withdraw(address indexed user, uint256 shares, uint256 usdcOut);
    event Rebalanced(uint256 indexed count, uint256 timestamp, uint256[] newWeights);
    event KeeperUpdated(address indexed newKeeper);
    event AssetAdded(address indexed token, uint256 weight);

    modifier onlyKeeper() {
        require(msg.sender == keeper || msg.sender == owner(), "not keeper");
        _;
    }

    constructor(
        address _usdc,
        address _keeper,
        address[] memory _tokens,
        uint256[] memory _weights
    ) ERC20("OnStock Portfolio", "osPFO") Ownable(msg.sender) {
        require(_tokens.length == _weights.length, "length mismatch");
        usdc = IERC20(_usdc);
        keeper = _keeper;

        uint256 totalWeight;
        for (uint256 i = 0; i < _tokens.length; i++) {
            assetTokens.push(_tokens[i]);
            targetWeights.push(_weights[i]);
            totalWeight += _weights[i];
        }
        require(totalWeight == 10000, "weights != 10000");
        assetCount = _tokens.length;
        lastRebalanceTime = block.timestamp;
    }

    // ─── Deposit ────────────────────────────────────────────────────────────────

    /**
     * @notice Deposit USDC and receive portfolio shares.
     *         Shares are minted 1:1 with USDC (1 share = $0.000001 = 1 USDC unit).
     */
    function deposit(uint256 usdcAmount) external returns (uint256 shares) {
        require(usdcAmount > 0, "zero amount");
        usdc.safeTransferFrom(msg.sender, address(this), usdcAmount);

        // First depositor: 1:1. After that: proportional to NAV.
        if (totalSupply() == 0) {
            shares = usdcAmount;
        } else {
            shares = (usdcAmount * totalSupply()) / nav();
        }

        _mint(msg.sender, shares);
        totalDepositedUsd += usdcAmount;
        emit Deposit(msg.sender, usdcAmount, shares);
    }

    /**
     * @notice Redeem portfolio shares for proportional USDC.
     */
    function withdraw(uint256 shares) external returns (uint256 usdcOut) {
        require(shares > 0 && shares <= balanceOf(msg.sender), "bad shares");

        usdcOut = (shares * nav()) / totalSupply();
        _burn(msg.sender, shares);

        // Send USDC to user
        uint256 usdcBal = usdc.balanceOf(address(this));
        require(usdcBal >= usdcOut, "insufficient USDC, rebalance needed");
        usdc.safeTransfer(msg.sender, usdcOut);

        emit Withdraw(msg.sender, shares, usdcOut);
    }

    // ─── NAV ────────────────────────────────────────────────────────────────────

    /**
     * @notice Total portfolio value in USDC units.
     *         = USDC balance + value of all xStock holdings (priced by keeper).
     *         For testnet: simplified to USDC balance only (keeper manages conversions).
     */
    function nav() public view returns (uint256) {
        return usdc.balanceOf(address(this));
    }

    /**
     * @notice Share price in USDC units (6 decimals).
     */
    function sharePrice() external view returns (uint256) {
        if (totalSupply() == 0) return 1e6; // $1.00
        return (nav() * 1e6) / totalSupply();
    }

    // ─── Keeper: Rebalance ──────────────────────────────────────────────────────

    /**
     * @notice Update portfolio weights. Called by keeper after RWA scoring engine
     *         computes new optimal allocation.
     * @param newWeights New target weights in basis points (must sum to 10000)
     */
    function rebalance(uint256[] calldata newWeights) external onlyKeeper {
        require(newWeights.length == assetCount, "wrong length");

        uint256 totalWeight;
        for (uint256 i = 0; i < assetCount; i++) {
            targetWeights[i] = newWeights[i];
            totalWeight += newWeights[i];
        }
        require(totalWeight == 10000, "weights != 10000");

        rebalanceCount++;
        lastRebalanceTime = block.timestamp;
        emit Rebalanced(rebalanceCount, block.timestamp, newWeights);
    }

    /**
     * @notice Keeper deposits xStock tokens into the vault after purchasing.
     *         In production: vault would swap via DEX directly.
     *         Testnet: keeper mints and deposits.
     */
    function keeperDeposit(address token, uint256 amount) external onlyKeeper {
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
    }

    /**
     * @notice Keeper withdraws xStock for rebalancing (sell overweight assets).
     */
    function keeperWithdraw(address token, uint256 amount) external onlyKeeper {
        IERC20(token).safeTransfer(keeper, amount);
    }

    // ─── View ───────────────────────────────────────────────────────────────────

    function getPortfolio() external view returns (
        address[] memory tokens,
        uint256[] memory weights,
        uint256[] memory balances,
        uint256 totalNav,
        uint256 _rebalanceCount,
        uint256 _lastRebalanceTime
    ) {
        tokens = new address[](assetCount);
        weights = new uint256[](assetCount);
        balances = new uint256[](assetCount);
        for (uint256 i = 0; i < assetCount; i++) {
            tokens[i] = assetTokens[i];
            weights[i] = targetWeights[i];
            balances[i] = IERC20(assetTokens[i]).balanceOf(address(this));
        }
        totalNav = nav();
        _rebalanceCount = rebalanceCount;
        _lastRebalanceTime = lastRebalanceTime;
    }

    // ─── Admin ──────────────────────────────────────────────────────────────────

    function setKeeper(address _keeper) external onlyOwner {
        keeper = _keeper;
        emit KeeperUpdated(_keeper);
    }
}
