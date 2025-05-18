// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// ───────────── OpenZeppelin ─────────────
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/metatx/ERC2771Context.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ───────────── Uniswap V2 ─────────────
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

// ───────────── Uniswap V3 ─────────────
import "@uniswap/v3-periphery/contracts/interfaces/INonfungiblePositionManager.sol";

// ───────────── Project Modules ─────────────
import "./MemeCoin.sol";
import "./WhitelistPresale.sol";
import "./UniswapV3Helper.sol";
import "./StakingRewards.sol";
import "./GovernanceToken.sol";
import "./GovernorContract.sol";
import "./BridgeAdapter.sol";
import "./AirdropMerkle.sol";
import "./BuybackBurn.sol";

contract MemeCoinFactory is
    ERC2771Context,
    AccessControl,
    Pausable,
    ReentrancyGuard
{
    using SafeERC20 for IERC20;

    // ───────── Roles ─────────
    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ───────── Fees ─────────
    uint16  public platformFeeBP;
    uint16  public referralFeeBP;
    uint256 public platformFeesAccrued;
    mapping(address => uint256) public creatorFeesAccrued;

    // ───────── Bonding‐Curve ─────────
    uint256 public immutable basePrice;   // wei per token
    uint256 public immutable slope;       // wei per token sold
    uint256 public totalSold;             // count of tokens sold

    // ───────── Token Registry ─────────
    struct TokenInfo {
        address token;
        address creator;
        string  description;
        string  ipfsHash;
        bool    active;
    }
    TokenInfo[]                 public allTokens;
    mapping(address => uint256) public tokenIndexPlusOne; // 1-based
    mapping(address => bool)    public tokenPaused;

    // ───────── Modules ─────────
    WhitelistPresale            public whitelistModule;
    UniswapV3Helper             public v3Helper;
    INonfungiblePositionManager public positionManager;
    IUniswapV2Factory           public v2Factory;
    StakingRewards              public stakingModule;
    GovernanceToken             public govToken;
    GovernorContract            public governor;
    BridgeAdapter               public bridgeModule;
    AirdropMerkle               public airdropModule;
    BuybackBurn                 public buybackModule;

    // ───────── Events ─────────
    event ModuleSet(string indexed name, address module);
    event TokenCreated(address indexed token, address indexed creator);
    event Bought(address indexed token, address indexed buyer, uint256 amountAtomic, uint256 cost);

    constructor(
        address forwarder_,
        uint16  platformFeeBP_,
        uint16  referralFeeBP_,
        uint256 _basePrice,
        uint256 _slope,
        address positionManager_,
        address v2Factory_
    ) ERC2771Context(forwarder_) {
        require(platformFeeBP_ + referralFeeBP_ < 10_000, "FeesTooHigh");
        platformFeeBP    = platformFeeBP_;
        referralFeeBP    = referralFeeBP_;
        basePrice        = _basePrice;
        slope            = _slope;
        positionManager  = INonfungiblePositionManager(positionManager_);
        v2Factory        = IUniswapV2Factory(v2Factory_);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PAUSER_ROLE,          msg.sender);
        _grantRole(OPERATOR_ROLE,        msg.sender);
    }

    // ───────── Meta-tx Overrides ─────────
    function _msgSender() internal view override(Context, ERC2771Context) returns (address) {
        return ERC2771Context._msgSender();
    }
    function _msgData() internal view override(Context, ERC2771Context) returns (bytes calldata) {
        return ERC2771Context._msgData();
    }
    function _contextSuffixLength() internal view override(Context, ERC2771Context) returns (uint256) {
        return ERC2771Context._contextSuffixLength();
    }

    // ───────── Module Wiring ─────────
    function setWhitelistModule(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistModule = WhitelistPresale(a);
        emit ModuleSet("WhitelistPresale", a);
    }
    function setV3Helper(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        v3Helper = UniswapV3Helper(a);
        emit ModuleSet("UniswapV3Helper", a);
    }
    function setPositionManager(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        positionManager = INonfungiblePositionManager(a);
        emit ModuleSet("PositionManager", a);
    }
    function setV2Factory(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        v2Factory = IUniswapV2Factory(a);
        emit ModuleSet("V2Factory", a);
    }
    function setStakingModule(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        stakingModule = StakingRewards(a);
        emit ModuleSet("StakingRewards", a);
    }
    function setGovernanceModules(address gt, address gv) external onlyRole(DEFAULT_ADMIN_ROLE) {
        govToken = GovernanceToken(gt);
        governor = GovernorContract(payable(gv));
        emit ModuleSet("GovernanceToken", gt);
        emit ModuleSet("GovernorContract", gv);
    }
    function setBridgeModule(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        bridgeModule = BridgeAdapter(a);
        emit ModuleSet("BridgeAdapter", a);
    }
    function setAirdropModule(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        airdropModule = AirdropMerkle(a);
        emit ModuleSet("AirdropMerkle", a);
    }
    function setBuybackModule(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        buybackModule = BuybackBurn(payable(a));
        emit ModuleSet("BuybackBurn", a);
    }

    // ───────── Bonding‐Curve ─────────
    function currentPrice() public view returns (uint256) {
        return basePrice + slope * totalSold;
    }

    // ───────── Create Token ─────────
    function createMemeCoin(
        string calldata name_,
        string calldata symbol_,
        string calldata description_,
        uint256 totalSupply_,
        uint256,                // legacy price ignored
        string calldata ipfsHash_
    ) external whenNotPaused nonReentrant returns (address tokenAddr) {
        MemeCoin token = new MemeCoin(name_, symbol_, totalSupply_, _msgSender(), ipfsHash_);
        tokenAddr = address(token);
        allTokens.push(TokenInfo(tokenAddr, _msgSender(), description_, ipfsHash_, true));
        tokenIndexPlusOne[tokenAddr] = allTokens.length;
        emit TokenCreated(tokenAddr, _msgSender());
    }

    // ───────── Buy Token ─────────
    function buyToken(
        address token_,
        uint256 amountAtomic,
        address referrer
    ) public payable whenNotPaused nonReentrant {
        require(amountAtomic > 0,                 "ZeroAmount");
        require(!tokenPaused[token_],             "TokenPaused");
        uint256 idx = tokenIndexPlusOne[token_];
        require(idx != 0 && allTokens[idx-1].active, "NotForSale");

        require(amountAtomic % 1e18 == 0, "Non-integer token amount");
        uint256 count = amountAtomic / 1e18;

        uint256 ts = totalSold;
        uint256 cost = count * basePrice
            + slope * ( ts * count + (count * (count - 1)) / 2 );
        require(msg.value == cost, "IncorrectETH");

        totalSold = ts + count;

        uint256 pf = (cost * platformFeeBP) / 10_000;
        uint256 rf = referrer == address(0) ? 0 : (cost * referralFeeBP) / 10_000;
        uint256 cf = cost - pf - rf;

        platformFeesAccrued                           += pf;
        creatorFeesAccrued[allTokens[idx-1].creator] += cf;

        IERC20(token_).safeTransfer(_msgSender(), amountAtomic);
        emit Bought(token_, _msgSender(), amountAtomic, cost);

        if (rf > 0) payable(referrer).transfer(rf);
    }

    // ───────── Presale ─────────
    function buyPresale(
        address token_,
        uint256 amt,
        uint256 maxAlloc,
        address ref,
        bytes32[] calldata proof
    ) external payable {
        whitelistModule.buyPresale{ value: msg.value }(token_, amt, maxAlloc, ref, proof);
    }

    // ───────── Uniswap V3: Create & Initialize ─────────
    function createAndInitializePoolIfNeeded(
        address token0,
        address token1,
        uint24  fee,
        uint160 sqrtPriceX96
    ) external {
        positionManager.createAndInitializePoolIfNecessary(token0, token1, fee, sqrtPriceX96);
    }

    // ───────── Uniswap V3: Mint Position ─────────
    function mintV3Position(
        INonfungiblePositionManager.MintParams calldata params
    )
        external
        payable
        returns (
            uint256 tokenId,
            uint128 liquidity,
            uint256 amount0,
            uint256 amount1
        )
    {
        (tokenId, liquidity, amount0, amount1) =
            positionManager.mint{ value: msg.value }(params);
    }

    // ───────── Uniswap V3: Decrease & Collect ─────────
    function decreaseAndCollect(
        uint256 tokenId,
        uint128 liquidity,
        uint256 amount0Min,
        uint256 amount1Min,
        uint256 deadline
    ) external returns (uint256, uint256) {
        positionManager.decreaseLiquidity(
            INonfungiblePositionManager.DecreaseLiquidityParams({
                tokenId:       tokenId,
                liquidity:     liquidity,
                amount0Min:    amount0Min,
                amount1Min:    amount1Min,
                deadline:      deadline
            })
        );
        (uint256 collected0, uint256 collected1) = positionManager.collect(
            INonfungiblePositionManager.CollectParams({
                tokenId:    tokenId,
                recipient:  msg.sender,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );
        return (collected0, collected1);
    }

    // ───────── Uniswap V2: Ensure Pair ─────────
    function ensureV2Pair(address a, address b) public returns (address pair) {
        pair = v2Factory.getPair(a, b);
        if (pair == address(0)) {
            pair = v2Factory.createPair(a, b);
        }
    }

    // ───────── Uniswap V2: Add Liquidity ─────────
    function addV2Liquidity(
        address router,
        address tokenA,
        address tokenB,
        uint256 amtA,
        uint256 amtB,
        uint256 minA,
        uint256 minB,
        address to,
        uint256 deadline
    ) external {
        ensureV2Pair(tokenA, tokenB);
        IERC20(tokenA).safeTransferFrom(msg.sender, address(this), amtA);
        IERC20(tokenB).safeTransferFrom(msg.sender, address(this), amtB);
        IERC20(tokenA).approve(router, amtA);
        IERC20(tokenB).approve(router, amtB);
        IUniswapV2Router02(router).addLiquidity(
            tokenA, tokenB, amtA, amtB, minA, minB, to, deadline
        );
    }

    // ───────── Uniswap V2: Remove Liquidity ─────────
    function removeV2Liquidity(
        address router,
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 minA,
        uint256 minB,
        address to,
        uint256 deadline
    ) external {
        address pair = ensureV2Pair(tokenA, tokenB);
        IERC20(pair).safeTransferFrom(msg.sender, address(this), liquidity);
        IERC20(pair).approve(router, liquidity);
        IUniswapV2Router02(router).removeLiquidity(
            tokenA, tokenB, liquidity, minA, minB, to, deadline
        );
    }

    // ───────── Staking ─────────
    function stakeTokens(uint256 amountAtomic) external {
        require(amountAtomic > 0, "ZeroAmount");
        address stk = allTokens[0].token;
        IERC20(stk).safeTransferFrom(_msgSender(), address(stakingModule), amountAtomic);
        stakingModule.stake(amountAtomic);
    }
    function withdrawStake(uint256 amt) external { stakingModule.withdraw(amt); }
    function claimStakeReward() external { stakingModule.getReward(); }

    // ───────── Governance ─────────
    function propose(
        address[] memory targets,
        uint256[] memory values,
        bytes[]   memory calld,
        string    memory desc
    ) external returns (uint256) {
        return governor.propose(targets, values, calld, desc);
    }
    function executeProposal(
        address[] memory targets,
        uint256[] memory values,
        bytes[]   memory calld,
        bytes32      descHash
    ) external {
        governor.execute(targets, values, calld, descHash);
    }

    // ───────── Bridge ─────────
    function bridgeToken(
        string  calldata chain,
        string  calldata receiver,
        address         token,
        uint256         amt
    ) external payable {
        IERC20(token).approve(address(bridgeModule), amt);
        string memory sym = IERC20Metadata(token).symbol();
        bridgeModule.forwardWithToken{ value: msg.value }(chain, receiver, "", sym, amt);
    }

    // ───────── Airdrop ─────────
    function claimAirdrop(uint256 amt, bytes32[] calldata proof) external {
        airdropModule.claim(amt, proof);
    }

    // ───────── Buyback ─────────
    function buybackAndBurn(uint256 minOut, address[] calldata path) external payable {
        buybackModule.buyAndBurn{ value: msg.value }(minOut, path);
    }

    // ───────── Fee Withdrawal ─────────
    function withdrawCreatorFees() external {
        uint256 owed = creatorFeesAccrued[_msgSender()];
        require(owed > 0, "NoFees");
        creatorFeesAccrued[_msgSender()] = 0;
        payable(_msgSender()).transfer(owed);
    }

    // ───────── Pause Control ─────────
    function pause() external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // ───────── Fallbacks ─────────
    receive() external payable { revert(); }
    fallback() external payable { revert(); }
}
