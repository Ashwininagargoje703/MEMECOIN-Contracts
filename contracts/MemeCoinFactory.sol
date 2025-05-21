// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

// ───────────── OpenZeppelin ─────────────
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ───────────── Uniswap V2 interfaces ─────────────
import "./interfaces/IUniswapV2Factory.sol";
import "./interfaces/IUniswapV2Router02.sol";
import "./interfaces/IUniswapV2Pair.sol";

// ───────────── Project Modules ─────────────
import "./MemeCoin.sol";
import "./WhitelistPresale.sol";
import "./StakingRewards.sol";
import "./AirdropMerkle.sol";

/// @title MemeCoinFactory (V2-only)
/// @notice Deploy new MemeCoins, bonding-curve buys, Uniswap V2 pools, presale, staking & airdrops.
contract MemeCoinFactory is
    Context,
    ERC2771Context,
    AccessControl,
    Pausable,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    // ───────── Events ─────────
    event ModuleSet(string indexed name, address module);
    event TokenCreated(address indexed token, address indexed creator);
    event Bought(
        address indexed token,
        address indexed buyer,
        uint256 amount,
        uint256 cost
    );
    event V2PairCreated(address indexed t0, address indexed t1, address pair);

    // ───────── Roles ─────────
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ───────── Fees ─────────
    uint16 public platformFeeBP;
    uint16 public referralFeeBP;
    uint256 public platformFeesAccrued;
    mapping(address => uint256) public creatorFeesAccrued;

    /// @notice Flat fee for creating a V2 pool
    uint256 public constant POOL_CREATION_FEE = 0.002 ether;

    // ───────── Bonding‐Curve ─────────
    uint256 public immutable basePrice; // wei per token
    uint256 public immutable slope; // wei per token sold
    uint256 public totalSold; // tokens sold so far

    // ───────── Token Registry ─────────
    struct TokenInfo {
        address token;
        address creator;
        string description;
        string ipfsHash;
        bool active;
    }
    TokenInfo[] public allTokens;
    mapping(address => uint256) public tokenIndexPlusOne;
    mapping(address => bool) public tokenPaused;

    // ───────── Modules ─────────
    WhitelistPresale public whitelistModule;
    IUniswapV2Factory public v2Factory;
    StakingRewards public stakingModule;
    AirdropMerkle public airdropModule;

    // ───────── Created Pools ─────────
    address[] public createdV2Pools;

    constructor(
        address forwarder_,
        uint16 _platformFeeBP,
        uint16 _referralFeeBP,
        uint256 _basePrice,
        uint256 _slope,
        address v2Factory_
    ) ERC2771Context(forwarder_) {
        require(_platformFeeBP + _referralFeeBP < 10000, "FeesTooHigh");
        platformFeeBP = _platformFeeBP;
        referralFeeBP = _referralFeeBP;
        basePrice = _basePrice;
        slope = _slope;
        v2Factory = IUniswapV2Factory(v2Factory_);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    // ───────── Meta‐tx overrides ─────────
    function _msgSender()
        internal
        view
        override(Context, ERC2771Context)
        returns (address)
    {
        return ERC2771Context._msgSender();
    }

    function _msgData()
        internal
        view
        override(Context, ERC2771Context)
        returns (bytes calldata)
    {
        return ERC2771Context._msgData();
    }

    function _contextSuffixLength()
        internal
        view
        override(Context, ERC2771Context)
        returns (uint256)
    {
        return ERC2771Context._contextSuffixLength();
    }

    // ───────── Module wiring ─────────
    function setWhitelistModule(
        address a
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistModule = WhitelistPresale(a);
        emit ModuleSet("WhitelistPresale", a);
    }

    function setV2Factory(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        v2Factory = IUniswapV2Factory(a);
        emit ModuleSet("V2Factory", a);
    }

    function setStakingModule(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        stakingModule = StakingRewards(a);
        emit ModuleSet("StakingRewards", a);
    }

    function setAirdropModule(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        airdropModule = AirdropMerkle(a);
        emit ModuleSet("AirdropMerkle", a);
    }

    // ───────── Bonding‐curve price ─────────
    function currentPrice() public view returns (uint256) {
        return basePrice + slope * totalSold;
    }

    // ───────── Create new MemeCoin ─────────
    function createMemeCoin(
        string calldata name_,
        string calldata symbol_,
        string calldata description_,
        uint256 totalSupply_,
        uint256,
        string calldata ipfsHash_
    ) external whenNotPaused nonReentrant returns (address tokenAddr) {
        MemeCoin token = new MemeCoin(
            name_,
            symbol_,
            totalSupply_,
            _msgSender(),
            ipfsHash_
        );
        tokenAddr = address(token);
        allTokens.push(
            TokenInfo(tokenAddr, _msgSender(), description_, ipfsHash_, true)
        );
        tokenIndexPlusOne[tokenAddr] = allTokens.length;
        emit TokenCreated(tokenAddr, _msgSender());
    }

    // ───────── Bonding‐curve buy ─────────
    function buyToken(
        address token_,
        uint256 amountAtomic,
        address referrer
    ) public payable whenNotPaused nonReentrant {
        require(amountAtomic > 0, "ZeroAmount");
        require(!tokenPaused[token_], "TokenPaused");
        uint256 idx = tokenIndexPlusOne[token_];
        require(idx != 0 && allTokens[idx - 1].active, "NotForSale");
        require(amountAtomic % 1e18 == 0, "NonInteger");
        uint256 count = amountAtomic / 1e18;

        uint256 ts = totalSold;
        uint256 cost = count *
            basePrice +
            slope *
            (ts * count + (count * (count - 1)) / 2);
        require(msg.value == cost, "IncorrectETH");
        totalSold = ts + count;

        uint256 pf = (cost * platformFeeBP) / 10000;
        uint256 rf = referrer == address(0)
            ? 0
            : (cost * referralFeeBP) / 10000;
        uint256 cf = cost - pf - rf;
        platformFeesAccrued += pf;
        creatorFeesAccrued[allTokens[idx - 1].creator] += cf;

        IERC20(token_).safeTransfer(_msgSender(), amountAtomic);
        emit Bought(token_, _msgSender(), amountAtomic, cost);
        if (rf > 0) payable(referrer).transfer(rf);
    }

    // ───────── Whitelist presale ─────────
    function buyPresale(
        address token_,
        uint256 amt,
        uint256 maxAlloc,
        address ref,
        bytes32[] calldata proof
    ) external payable {
        whitelistModule.buyPresale{value: msg.value}(
            token_,
            amt,
            maxAlloc,
            ref,
            proof
        );
    }

    // ───────── Uniswap V2 pool ─────────
    function createV2Pool(
        address a,
        address b
    ) external payable returns (address pair) {
        require(msg.value == POOL_CREATION_FEE, "WrongFee");
        pair = ensureV2Pair(a, b);
        platformFeesAccrued += msg.value;
    }

    function ensureV2Pair(address a, address b) public returns (address pair) {
        require(address(v2Factory) != address(0), "V2Factory not set");
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        pair = v2Factory.getPair(t0, t1);
        if (pair == address(0)) {
            pair = v2Factory.createPair(t0, t1);
            createdV2Pools.push(pair);
            emit V2PairCreated(t0, t1, pair);
        }
    }

    // ───────── V2 add/remove liquidity ─────────
    function addV2Liquidity(
        address router,
        address tokenA,
        address tokenB,
        uint256 amtA,
        uint256 amtB,
        uint256 minA,
        uint256 minB,
        address to,
        uint256 dl
    ) external {
        ensureV2Pair(tokenA, tokenB);
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amtA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amtB);
        IERC20(tokenA).approve(router, amtA);
        IERC20(tokenB).approve(router, amtB);
        IUniswapV2Router02(router).addLiquidity(
            tokenA,
            tokenB,
            amtA,
            amtB,
            minA,
            minB,
            to,
            dl
        );
    }

    function removeV2Liquidity(
        address router,
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 minA,
        uint256 minB,
        address to,
        uint256 dl
    ) external {
        address pair = ensureV2Pair(tokenA, tokenB);
        IERC20(pair).safeTransferFrom(msg.sender, address(this), liquidity);
        IERC20(pair).approve(router, liquidity);
        IUniswapV2Router02(router).removeLiquidity(
            tokenA,
            tokenB,
            liquidity,
            minA,
            minB,
            to,
            dl
        );
    }

    // ───────── Staking ─────────
    function stakeTokens(uint256 amt) external whenNotPaused {
        IERC20(allTokens[0].token).safeTransferFrom(
            _msgSender(),
            address(stakingModule),
            amt
        );
        stakingModule.stake(amt);
    }

    function withdrawStake(uint256 amt) external {
        stakingModule.withdraw(amt);
    }

    function claimStakeReward() external {
        stakingModule.getReward();
    }

    // ───────── Airdrop ─────────
    function claimAirdrop(uint256 amt, bytes32[] calldata proof) external {
        airdropModule.claim(amt, proof);
    }

    // ───────── Pool list helpers ─────────
    function getV2PoolCount() external view returns (uint256) {
        return createdV2Pools.length;
    }

    function getV2Pool(uint256 i) external view returns (address) {
        return createdV2Pools[i];
    }

    function getV2PoolTokens(
        uint256 i
    ) external view returns (address t0, address t1) {
        IUniswapV2Pair p = IUniswapV2Pair(createdV2Pools[i]);
        return (p.token0(), p.token1());
    }

    // ───────── Pause control ─────────
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    receive() external payable {
        revert();
    }

    fallback() external payable {
        revert();
    }
}
