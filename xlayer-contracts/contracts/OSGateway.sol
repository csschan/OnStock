// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IOSToken {
    function mint(address to, uint256 amount) external;
    function burn(address from, uint256 amount) external;
}

interface IOSPool {
    function onBuy(uint256 usdcAmount) external;
    function onSell(address user, uint256 usdcAmount) external;
    function onBridgeOut(uint256 usdcAmount) external;
    function onBridgeIn(uint256 usdcAmount) external;
}

/**
 * @title OSGateway (v4 — THORChain architecture, correct USDC flow)
 *
 *  Mainnet model:
 *    User already has real RWA tokens (bTSLA, oTSLA, etc.)
 *    OnStock is a cross-chain swap router, not an issuer.
 *    Only fee: 0.05% on cross-chain swaps.
 *
 *  Testnet model:
 *    Mock tokens simulate real assets. Buy/Sell simulates DEX trading.
 *    No fees on buy/sell (simulating real market).
 *    0.05% fee only on cross-chain swaps.
 *
 *  Cross-chain flow (correct USDC routing):
 *    1. User calls bridgeBurn → burns token + USDC value stays in source Pool
 *    2. Keeper moves USDC from source Pool → dest Pool (via CCTP/Wormhole)
 *    3. Keeper calls bridgeMint on dest chain → uses Pool USDC to back new token
 *    Every token always backed by USDC in some pool.
 */
contract OSGateway is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    IOSPool public pool;
    address public keeper;

    struct Asset {
        address osToken;
        uint256 priceUsd;           // 6 decimals
        uint256 lastPriceUpdate;
        bool marketOpen;
        uint256 totalBought;        // renamed from totalMinted
        uint256 totalSold;          // renamed from totalRedeemed
    }

    mapping(bytes32 => Asset) public assets;
    bytes32[] public assetKeys;

    uint256 public maxPriceAge = 3600;
    uint256 public tradeFeeBps = 50;    // 0.5% buy/sell fee
    uint256 public bridgeFeeBps = 5;    // 0.05% cross-chain fee

    // Bridge
    uint256 public bridgeNonce;
    mapping(bytes32 => bool) public bridgeMintProcessed;

    // Events
    event Buy(address indexed user, bytes32 indexed ticker, uint256 usdcIn, uint256 tokenOut, uint256 price);
    event Sell(address indexed user, bytes32 indexed ticker, uint256 tokenIn, uint256 usdcOut, uint256 price);
    event BridgeBurn(address indexed user, bytes32 indexed ticker, uint256 usdcValue, uint256 tokenBurned, string destChain, string destAddress, uint256 nonce);
    event BridgeMint(address indexed user, bytes32 indexed ticker, uint256 usdcValue, uint256 tokenMinted, string srcChain, uint256 srcNonce);
    event PriceUpdated(bytes32 indexed ticker, uint256 price, bool marketOpen);
    event AssetRegistered(bytes32 indexed ticker, address osToken);

    modifier onlyKeeper() {
        require(msg.sender == keeper || msg.sender == owner(), "not keeper");
        _;
    }

    constructor(address _usdc, address _pool, address _keeper) Ownable(msg.sender) {
        usdc = IERC20(_usdc);
        pool = IOSPool(_pool);
        keeper = _keeper;
    }

    // ── Admin ───────────────────────────────────────────────────────────────

    function registerAsset(string calldata ticker, address osToken) external onlyOwner {
        bytes32 key = keccak256(bytes(ticker));
        require(assets[key].osToken == address(0), "exists");
        assets[key] = Asset(osToken, 0, 0, false, 0, 0);
        assetKeys.push(key);
        emit AssetRegistered(key, osToken);
    }

    // ── Keeper: Oracle ──────────────────────────────────────────────────────

    function setPrice(string calldata ticker, uint256 priceUsd, bool _marketOpen) external onlyKeeper {
        bytes32 key = keccak256(bytes(ticker));
        Asset storage a = assets[key];
        require(a.osToken != address(0), "unknown");
        require(priceUsd > 0, "zero");
        a.priceUsd = priceUsd;
        a.lastPriceUpdate = block.timestamp;
        a.marketOpen = _marketOpen;
        emit PriceUpdated(key, priceUsd, _marketOpen);
    }

    function setPriceBatch(
        string[] calldata tickers, uint256[] calldata prices, bool[] calldata opens
    ) external onlyKeeper {
        for (uint256 i = 0; i < tickers.length; i++) {
            bytes32 key = keccak256(bytes(tickers[i]));
            Asset storage a = assets[key];
            if (a.osToken == address(0) || prices[i] == 0) continue;
            a.priceUsd = prices[i];
            a.lastPriceUpdate = block.timestamp;
            a.marketOpen = opens[i];
            emit PriceUpdated(key, prices[i], opens[i]);
        }
    }

    // ── Buy: USDC → token (no fee) ──────────────────────────────────────────

    function buy(string calldata ticker, uint256 usdcAmount) external returns (uint256 tokenOut) {
        bytes32 key = keccak256(bytes(ticker));
        Asset storage a = assets[key];
        require(a.osToken != address(0), "unknown");
        require(a.priceUsd > 0, "price not set");
        require(a.marketOpen || block.timestamp - a.lastPriceUpdate <= maxPriceAge, "stale");
        require(usdcAmount > 0, "zero");

        // 0.5% trade fee
        uint256 fee = (usdcAmount * tradeFeeBps) / 10000;
        uint256 netUsdc = usdcAmount - fee;
        tokenOut = (netUsdc * 1e6) / a.priceUsd;
        require(tokenOut > 0, "too small");

        // USDC → Pool
        usdc.safeTransferFrom(msg.sender, address(pool), usdcAmount);
        pool.onBuy(usdcAmount);

        // Token to user (testnet: mint; mainnet: would come from DEX)
        IOSToken(a.osToken).mint(msg.sender, tokenOut);
        a.totalBought += tokenOut;

        emit Buy(msg.sender, key, usdcAmount, tokenOut, a.priceUsd);
    }

    // ── Sell: token → USDC (no fee) ─────────────────────────────────────────

    function sell(string calldata ticker, uint256 tokenAmount) external returns (uint256 usdcOut) {
        bytes32 key = keccak256(bytes(ticker));
        Asset storage a = assets[key];
        require(a.osToken != address(0), "unknown");
        require(a.priceUsd > 0, "price not set");
        require(tokenAmount > 0, "zero");

        // 0.5% trade fee
        uint256 grossUsdc = (tokenAmount * a.priceUsd) / 1e6;
        uint256 fee = (grossUsdc * tradeFeeBps) / 10000;
        usdcOut = grossUsdc - fee;
        require(usdcOut > 0, "too small");

        // Burn token
        IOSToken(a.osToken).burn(msg.sender, tokenAmount);
        a.totalSold += tokenAmount;

        // Pool sends USDC to user
        pool.onSell(msg.sender, usdcOut);

        emit Sell(msg.sender, key, tokenAmount, usdcOut, a.priceUsd);
    }

    // ── Cross-Chain Swap: the only thing OnStock charges for ────────────────

    /**
     * @notice Step 1: User sells token on source chain.
     *         Token burned, USDC value stays in Pool.
     *         Keeper will buy equivalent on dest chain using dest Pool's USDC.
     *
     *         0.05% fee deducted from USDC value.
     */
    function bridgeBurn(
        string calldata ticker, uint256 tokenAmount,
        string calldata destChain, string calldata destAddress
    ) external {
        bytes32 key = keccak256(bytes(ticker));
        Asset storage a = assets[key];
        require(a.osToken != address(0), "unknown");
        require(a.priceUsd > 0, "price not set");
        require(tokenAmount > 0, "zero");

        // Calculate USDC value
        uint256 grossUsdc = (tokenAmount * a.priceUsd) / 1e6;

        // 0.05% bridge fee
        uint256 fee = (grossUsdc * bridgeFeeBps) / 10000;
        uint256 netUsdc = grossUsdc - fee;
        require(netUsdc > 0, "too small");

        // Burn token
        IOSToken(a.osToken).burn(msg.sender, tokenAmount);

        // USDC stays in Pool (will be moved to dest pool by Keeper)
        // Mark the USDC as pending outbound
        pool.onBridgeOut(netUsdc);

        bridgeNonce++;
        emit BridgeBurn(msg.sender, key, netUsdc, tokenAmount, destChain, destAddress, bridgeNonce);
    }

    /**
     * @notice Step 3: Keeper buys token on dest chain using Pool's USDC.
     *         Called after Keeper has bridged USDC into this Pool.
     */
    function bridgeMint(
        string calldata ticker, address to, uint256 usdcValue,
        string calldata srcChain, uint256 srcNonce
    ) external onlyKeeper {
        bytes32 mintKey = keccak256(abi.encodePacked(srcChain, srcNonce));
        require(!bridgeMintProcessed[mintKey], "replay");
        bridgeMintProcessed[mintKey] = true;

        bytes32 key = keccak256(bytes(ticker));
        Asset storage a = assets[key];
        require(a.osToken != address(0), "unknown");
        require(a.priceUsd > 0, "price not set");

        // Calculate token amount from USDC value at current price
        uint256 tokenOut = (usdcValue * 1e6) / a.priceUsd;
        require(tokenOut > 0, "too small");

        // Record that Pool USDC is now backing this token
        pool.onBridgeIn(usdcValue);

        // Mint token (testnet: mint; mainnet: DEX buy)
        IOSToken(a.osToken).mint(to, tokenOut);
        a.totalBought += tokenOut;

        emit BridgeMint(to, key, usdcValue, tokenOut, srcChain, srcNonce);
    }

    // ── View ────────────────────────────────────────────────────────────────

    function getAsset(string calldata ticker) external view returns (
        address osToken, uint256 priceUsd, uint256 lastUpdate,
        bool marketOpen, uint256 totalBought, uint256 totalSold
    ) {
        bytes32 key = keccak256(bytes(ticker));
        Asset storage a = assets[key];
        return (a.osToken, a.priceUsd, a.lastPriceUpdate, a.marketOpen, a.totalBought, a.totalSold);
    }

    function assetCount() external view returns (uint256) { return assetKeys.length; }

    // ── Admin ───────────────────────────────────────────────────────────────

    function setKeeper(address _k) external onlyOwner { keeper = _k; }
    function setPool(address _p) external onlyOwner { pool = IOSPool(_p); }
    function setFees(uint256 _tradeBps, uint256 _bridgeBps) external onlyOwner {
        require(_tradeBps <= 500 && _bridgeBps <= 100, "too high");
        tradeFeeBps = _tradeBps;
        bridgeFeeBps = _bridgeBps;
    }
    function setMaxPriceAge(uint256 _age) external onlyOwner { maxPriceAge = _age; }
}
