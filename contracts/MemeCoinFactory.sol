// contracts/MemeCoinFactory.sol
// SPDX-License-Identifier: GPL-3.0-or-later
pragma solidity ^0.8.20;

// ───────── OpenZeppelin ─────────
import "@openzeppelin/contracts/utils/Context.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// ───────── Fixed-Point Math ─────────
import "abdk-libraries-solidity/ABDKMath64x64.sol";

// ───────── Project Modules ─────────
import "./MemeCoin.sol";
import "./WhitelistPresale.sol";
import "./StakingRewards.sol";
import "./AirdropMerkle.sol";

// ───────── Uniswap V2 ─────────
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

interface IWETH {
    function deposit() external payable;
}

/// @notice Simple linear vesting helper
contract SimpleVesting {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable beneficiary;
    uint256 public immutable start;
    uint256 public immutable duration;
    uint256 public released;

    event VestingReleased(address indexed vestingContract, uint256 amount, uint256 timestamp);

    constructor(IERC20 _token, address _beneficiary, uint256 _start, uint256 _duration) {
        token = _token;
        beneficiary = _beneficiary;
        start = _start;
        duration = _duration;
    }

    function release() external {
        uint256 vested = vestedAmount();
        uint256 unreleased = vested - released;
        require(unreleased > 0, "NoTokens");
        released = vested;
        token.safeTransfer(beneficiary, unreleased);
        emit VestingReleased(address(this), unreleased, block.timestamp);
    }

    function vestedAmount() public view returns (uint256) {
        uint256 total = token.balanceOf(address(this)) + released;
        if (block.timestamp >= start + duration) return total;
        return (total * (block.timestamp - start)) / duration;
    }
}

/// @title MemeCoinFactory — Launchpad with UX enhancements
contract MemeCoinFactory is Context, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    using ABDKMath64x64 for int128;

    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    uint16 public platformFeeBP;
    uint16 public referralFeeBP;
    uint256 public platformFeesAccrued;
    mapping(address => uint256) public creatorFeesAccrued;
    uint256 public constant POOL_CREATION_FEE = 0.002 ether;

    IUniswapV2Factory public v2Factory;
    IUniswapV2Router02 public router;
    address public WETH;

    // UX enhancements
    string public auditReportURI;
    mapping(bytes32 => address) public referralCodes;

    enum CurveType { Linear, Exponential, Polynomial, Step }
    enum LaunchMode { Normal, Rush }

    // Events (core + UX)
    event TokenCreated(address indexed token, address indexed creator);
    event VaultDeposited(address indexed token, address indexed user, uint256 amount);
    event VaultReleasedManual(address indexed token, uint256 timestamp);
    event VaultClaimed(address indexed token, address indexed user, uint256 amount);
    event Bought(address indexed token, address indexed buyer, uint256 amount, uint256 cost);
    event Sold(address indexed token, address indexed seller, uint256 amount, uint256 refund);
    event PoolCreated(address indexed token, address indexed pair);
    event NextPrice(address indexed token, uint256 nextPrice, uint256 timestamp);
    event VestingCreated(address indexed token, address vestingContract);
    event FeeDistributed(address indexed token, address indexed payer, uint256 platformFee, uint256 creatorFee, uint256 referralFee);
    event PresalePurchased(address indexed token, address indexed buyer, uint256 amount, uint256 cost, address referrer);

    // UX events
    event AuditReportUpdated(string uri);
    event ReferralCodeRegistered(bytes32 code, address indexed creator);
    event BuyExecuted(address indexed token, address indexed buyer, uint256 amountAtomic, uint256 cost, bytes32 referralCode);

    struct CurveInfo {
        CurveType curveType;
        uint256 basePrice;
        uint256 slope;
        uint256 exponent;
        uint256 stepSize;
        uint256 totalSold;
        uint256 fundingGoal;
        bool poolCreated;
        uint16 startFeeBP;
        uint16 endFeeBP;
        uint256 feeChangeStart;
        uint256 feeChangeEnd;
    }
    struct TokenInfo {
        address token;
        address creator;
        LaunchMode launchMode;
        uint256 preMintCap;
        bool active;
        uint256 vaultEnd;
    }

    TokenInfo[] public allTokens;
    mapping(address => uint256) public tokenIndexPlusOne;
    mapping(address => CurveInfo) public curves;

    // Vault storage
    mapping(address => mapping(address => uint256)) public vaultDeposits;
    mapping(address => uint256) public vaultTotal;
    mapping(address => bool) public vaultReleased;

    WhitelistPresale public whitelistModule;
    StakingRewards public stakingModule;
    AirdropMerkle public airdropModule;

    constructor(uint16 _platformFeeBP, uint16 _referralFeeBP, address _v2Factory, address _router) {
        require(_platformFeeBP + _referralFeeBP < 10000, "FeesTooHigh");
        platformFeeBP  = _platformFeeBP;
        referralFeeBP  = _referralFeeBP;
        v2Factory      = IUniswapV2Factory(_v2Factory);
        router         = IUniswapV2Router02(_router);
        WETH           = router.WETH();

        _grantRole(DEFAULT_ADMIN_ROLE, _msgSender());
        _grantRole(PAUSER_ROLE,         _msgSender());
        _grantRole(OPERATOR_ROLE,       _msgSender());
    }

    // Register referral code
    function registerReferralCode(bytes32 code) external {
        require(referralCodes[code] == address(0), "CodeExists");
        referralCodes[code] = _msgSender();
        emit ReferralCodeRegistered(code, _msgSender());
    }

    // Update audit URI
    function updateAuditReport(string calldata uri) external onlyRole(DEFAULT_ADMIN_ROLE) {
        auditReportURI = uri;
        emit AuditReportUpdated(uri);
    }

    // ── PRICING ──────────────────────────────────────────────────────
    function costToBuy(address token_, uint256 amountAtomic) public view returns (uint256) {
        uint256 count = amountAtomic / 1e18;
        if (count == 0) return 0;
        CurveInfo storage c = curves[token_];
        if (c.curveType == CurveType.Linear) {
            uint256 S = c.totalSold;
            return count * c.basePrice + c.slope * (S * count + (count * (count - 1)) / 2);
        }
        return count * currentPrice(token_);
    }

    function currentPrice(address token_) public view returns (uint256) {
        CurveInfo storage c = curves[token_];
        if (c.curveType == CurveType.Linear) {
            return c.basePrice + c.slope * c.totalSold;
        } else if (c.curveType == CurveType.Exponential) {
            int128 x = ABDKMath64x64.fromUInt(c.slope * c.totalSold);
            return c.basePrice * uint256(ABDKMath64x64.toUInt(ABDKMath64x64.exp(x)));
        } else if (c.curveType == CurveType.Polynomial) {
            return c.basePrice + c.slope * (c.totalSold ** c.exponent);
        } else {
            return c.basePrice + (c.totalSold / c.stepSize) * c.slope;
        }
    }

    // ── BUY w/ SLIPPAGE & REFERRAL ───────────────────────────────────
    function buyToken(
        address token_,
        uint256 amountAtomic,
        bytes32 referralCode,
        uint256 minCost
    ) external payable whenNotPaused nonReentrant {
        uint256 cost = costToBuy(token_, amountAtomic);
        require(cost >= minCost,   "SlippageExceeded");
        require(msg.value >= cost, "InsufficientETH");

        // refund excess
        uint256 refund = msg.value - cost;
        if (refund > 0) payable(_msgSender()).transfer(refund);

        // update curves
        TokenInfo storage t = allTokens[tokenIndexPlusOne[token_] - 1];
        CurveInfo storage c = curves[token_];
        require(block.timestamp > t.vaultEnd, "VaultActive");

        uint256 count = amountAtomic / 1e18;
        if (t.launchMode == LaunchMode.Rush) {
            require(c.totalSold + count <= t.preMintCap, "RushCapExceeded");
        }
        c.totalSold += count;

        // distribute fees
        address ref = referralCodes[referralCode];
        _distributeFees(token_, cost, ref);

        // transfer
        IERC20(token_).safeTransfer(_msgSender(), amountAtomic);

        emit Bought(token_, _msgSender(), amountAtomic, cost);
        emit BuyExecuted(token_, _msgSender(), amountAtomic, cost, referralCode);
        emit NextPrice(token_, currentPrice(token_), block.timestamp);

        // auto-pool
        if (!c.poolCreated && c.totalSold * 1e18 >= c.fundingGoal) {
            c.poolCreated = true;
            address pair = v2Factory.getPair(token_, WETH);
            if (pair == address(0)) {
                pair = v2Factory.createPair(token_, WETH);
            }
            IERC20(token_).approve(address(router), amountAtomic);
            try router.addLiquidityETH{ value: cost }(
                token_, amountAtomic, 0, 0, address(this), block.timestamp
            ) {
                emit PoolCreated(token_, pair);
            } catch {}
        }
    }

    // ── SELL w/ SLIPPAGE ────────────────────────────────────────────
    function sellToken(
        address token_,
        uint256 amountAtomic,
        uint256 minRefund
    ) external whenNotPaused nonReentrant {
        CurveInfo storage c = curves[token_];
        uint256 count = amountAtomic / 1e18;
        require(c.totalSold >= count, "InsufficientSold");

        uint256 refund = _calcRefund(c, token_, count);
        require(refund >= minRefund, "SlippageExceeded");
        c.totalSold -= count;

        IERC20(token_).safeTransferFrom(msg.sender, address(this), amountAtomic);
        payable(msg.sender).transfer(refund);

        emit Sold(token_, msg.sender, amountAtomic, refund);
        emit NextPrice(token_, currentPrice(token_), block.timestamp);
    }

    // ── PRESALE ─────────────────────────────────────────────────────
    function buyPresale(
        address t,
        uint256 a,
        uint256,   // maxAlloc ignored
        address r,
        bytes32[] calldata p
    ) external payable nonReentrant {
        whitelistModule.buyPresale{ value: msg.value }(t, a, 0, r, p);
        emit PresalePurchased(t, _msgSender(), a, msg.value, r);
    }

    // ── WITHDRAW FEES ──────────────────────────────────────────────
    function withdrawCreatorFees() external nonReentrant {
        uint256 amt = creatorFeesAccrued[msg.sender];
        require(amt > 0, "NoCreatorFees");
        creatorFeesAccrued[msg.sender] = 0;
        (bool sent, ) = payable(msg.sender).call{ value: amt }("");
        require(sent, "ETH_TRANSFER_FAILED");
    }
    function withdrawPlatformFees(address to) external onlyRole(DEFAULT_ADMIN_ROLE) nonReentrant {
        uint256 amt = platformFeesAccrued;
        require(amt > 0, "NoPlatformFees");
        platformFeesAccrued = 0;
        (bool sent, ) = payable(to).call{ value: amt }("");
        require(sent, "ETH_TRANSFER_FAILED");
    }

    // ── INTERNAL FEE & REFUND ──────────────────────────────────────
    function _distributeFees(address token_, uint256 cost, address referrer) internal {
        uint16 bp = _currentFeeBP(curves[token_]);
        uint256 pf = (cost * bp) / 10000;
        uint256 rf = referrer == address(0) ? 0 : (cost * referralFeeBP) / 10000;
        uint256 cf = cost - pf - rf;

        platformFeesAccrued += pf;
        creatorFeesAccrued[allTokens[tokenIndexPlusOne[token_] - 1].creator] += cf;
        if (rf > 0) payable(referrer).transfer(rf);

        emit FeeDistributed(token_, _msgSender(), pf, cf, rf);
    }

    function _currentFeeBP(CurveInfo storage c) internal view returns (uint16) {
        if (block.timestamp < c.feeChangeStart) return c.startFeeBP;
        if (block.timestamp >= c.feeChangeEnd) return c.endFeeBP;
        uint256 t = block.timestamp - c.feeChangeStart;
        uint256 d = c.feeChangeEnd - c.feeChangeStart;
        return uint16(c.startFeeBP + ((c.endFeeBP - c.startFeeBP) * t) / d);
    }

    function _calcRefund(CurveInfo storage c, address, uint256 count) internal view returns (uint256) {
        if (c.curveType == CurveType.Linear) {
            uint256 S = c.totalSold;
            return count * c.basePrice + c.slope * (S * count - (count * (count + 1)) / 2);
        }
        return count * currentPrice(address(0));
    }

    // ── MANUAL POOL CREATION ───────────────────────────────────────
    function createV2Pool(address a, address b) external payable onlyRole(OPERATOR_ROLE) returns (address pair) {
        require(msg.value == POOL_CREATION_FEE, "WrongFee");
        (address t0, address t1) = a < b ? (a, b) : (b, a);
        pair = v2Factory.getPair(t0, t1);
        if (pair == address(0)) {
            pair = v2Factory.createPair(t0, t1);
        }
        emit PoolCreated(a, pair);
    }

    // ── LAUNCH NEW MEMECOIN ─────────────────────────────────────────
    function createMemeCoin(
        string calldata name_,
        string calldata symbol_,
        LaunchMode launchMode_,
        uint256 preMintCap_,
        CurveType curveType_,
        uint256 basePrice_,
        uint256 slope_,
        uint256 exponent_,
        uint256 stepSize_,
        uint256 fundingGoal_,
        uint16 startFeeBP_,
        uint16 endFeeBP_,
        uint256 feeChangeStart_,
        uint256 feeChangeEnd_,
        uint256 vaultEnd_,
        uint256 vestAmount_,
        uint256 vestStart_,
        uint256 vestDuration_,
        uint256 totalSupply_,
        string calldata ipfsHash_
    ) external whenNotPaused nonReentrant onlyRole(OPERATOR_ROLE) returns (address tokenAddr) {
        MemeCoin token = new MemeCoin(name_, symbol_, totalSupply_, address(this), ipfsHash_);
        SimpleVesting vest = new SimpleVesting(IERC20(address(token)), _msgSender(), vestStart_, vestDuration_);
        IERC20(address(token)).safeTransfer(address(vest), vestAmount_);
        emit VestingCreated(address(token), address(vest));

        tokenAddr = address(token);
        allTokens.push(TokenInfo({
            token: tokenAddr,
            creator: _msgSender(),
            launchMode: launchMode_,
            preMintCap: preMintCap_,
            active: true,
            vaultEnd: vaultEnd_
        }));
        tokenIndexPlusOne[tokenAddr] = allTokens.length;
        curves[tokenAddr] = CurveInfo({
            curveType: curveType_,
            basePrice: basePrice_,
            slope: slope_,
            exponent: exponent_,
            stepSize: stepSize_,
            totalSold: 0,
            fundingGoal: fundingGoal_,
            poolCreated: false,
            startFeeBP: startFeeBP_,
            endFeeBP: endFeeBP_,
            feeChangeStart: feeChangeStart_,
            feeChangeEnd: feeChangeEnd_
        });

        emit TokenCreated(tokenAddr, _msgSender());
    }

    // ── VAULT & MODULES ────────────────────────────────────────────
    function depositVault(address token_) external payable {
        require(block.timestamp <= allTokens[tokenIndexPlusOne[token_] - 1].vaultEnd, "VaultClosed");
        vaultDeposits[token_][_msgSender()] += msg.value;
        vaultTotal[token_] += msg.value;
        emit VaultDeposited(token_, _msgSender(), msg.value);
    }

    function releaseVault(address token_) external onlyRole(OPERATOR_ROLE) {
        require(block.timestamp > allTokens[tokenIndexPlusOne[token_] - 1].vaultEnd, "VaultActive");
        vaultReleased[token_] = true;
        emit VaultReleasedManual(token_, block.timestamp);
    }

    function claimVault(address token_) external nonReentrant {
        require(vaultReleased[token_], "NotReleased");
        uint256 dep = vaultDeposits[token_][_msgSender()];
        require(dep > 0, "NoDeposit");
        vaultDeposits[token_][_msgSender()] = 0;
        uint256 cap = allTokens[tokenIndexPlusOne[token_] - 1].preMintCap;
        uint256 total = vaultTotal[token_];
        uint256 amt = (cap * dep) / total;
        IERC20(token_).safeTransfer(_msgSender(), amt * 1e18);
        emit VaultClaimed(token_, _msgSender(), amt * 1e18);
    }

    function stakeTokens(uint256 amt) external whenNotPaused {
        address tk = allTokens[0].token;
        IERC20(tk).safeTransferFrom(_msgSender(), address(stakingModule), amt);
        stakingModule.stake(amt);
    }

    function withdrawStake(uint256 amt) external {
        stakingModule.withdraw(amt);
    }

    function claimStakeReward() external {
        stakingModule.getReward();
    }

    function claimAirdrop(uint256 a, bytes32[] calldata p) external {
        airdropModule.claim(a, p);
    }

    function setWhitelistModule(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        whitelistModule = WhitelistPresale(a);
    }

    function setStakingModule(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        stakingModule = StakingRewards(a);
    }

    function setAirdropModule(address a) external onlyRole(DEFAULT_ADMIN_ROLE) {
        airdropModule = AirdropMerkle(a);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    receive() external payable {}
    fallback() external payable {
        revert();
    }
}
