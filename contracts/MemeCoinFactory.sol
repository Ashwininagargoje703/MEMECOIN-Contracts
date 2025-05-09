// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MemeCoin.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@uniswap/v2-core/contracts/interfaces/IUniswapV2Factory.sol";
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

/// @title MemeCoinFactory: launchpad + fixed-price buy-only marketplace + helpers
contract MemeCoinFactory is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    struct TokenInfo {
        address token;
        address creator;
        uint256 priceWei;
        string description;
        string ipfsHash;
    }

    TokenInfo[] public allTokens;
    mapping(address => uint256) public tokenIndexPlusOne;
    mapping(address => bool) public tokenPaused;

    /// ── Fee configuration (basis points) ─────────────────────
    uint16 public platformFeeBP;
    uint16 public referralFeeBP;

    /// ── Accrued balances (pull pattern) ──────────────────────
    uint256 public platformFeesAccrued;
    mapping(address => uint256) public referralFeesAccrued;
    mapping(address => uint256) public creatorFeesAccrued;

    // DEX integration
    address public dexFactory;
    address public dexRouter;

    // Global buy circuit-breaker
    bool public buysPaused;

    /// ── Presale whitelist / merkle root ─────────────────────
    bytes32 public presaleMerkleRoot;
    mapping(address => bool) public whitelistEnabled;
    mapping(address => mapping(address => bool)) public whitelisted;

    // Vesting schedules
    struct Vesting {
        uint256 total;
        uint256 claimed;
        uint256 start;
        uint256 cliff;
        uint256 duration;
    }
    mapping(address => Vesting) public vestingSchedules;

    /*────────────────── Errors ──────────────────*/
    error PriceZero();
    error NotLaunched();
    error NotAuthorized();
    error IncorrectETH();
    error ZeroAmount();
    error TokenPaused();
    error BuysPaused();
    error NotWhitelisted();
    error NoVesting();
    error NothingToClaim();

    /*────────────────── Events ──────────────────*/
    event TokenCreated(
        address indexed token,
        address indexed creator,
        uint256 priceWei,
        string description,
        string ipfsHash
    );
    event Bought(
        address indexed token,
        address indexed buyer,
        uint256 amountAtomic,
        uint256 costWei,
        address indexed referrer,
        uint256 platformShare,
        uint256 referralShare,
        uint256 creatorShare
    );
    event PriceUpdated(address indexed token, uint256 newPriceWei);
    event FeesUpdated(uint16 newPlatformBP, uint16 newReferralBP);
    event TokenPausedEvent(address indexed token);
    event TokenUnpausedEvent(address indexed token);
    event UnsoldReclaimed(address indexed token, uint256 amount);
    event MetadataUpdated(
        address indexed token,
        string newDescription,
        string newIpfsHash
    );
    event DexConfigured(address factory, address router);
    event BuysPausedEvent();
    event BuysUnpausedEvent();
    event PresaleRootUpdated(bytes32 newRoot);
    event VestingScheduleSet(
        address indexed beneficiary,
        uint256 total,
        uint256 start,
        uint256 cliff,
        uint256 duration
    );
    event VestedClaimed(address indexed beneficiary, uint256 amountClaimed);
    event ETHRescued(address indexed to, uint256 amount);
    event TokenRescued(address indexed token, uint256 amount);

    constructor(uint16 _platformFeeBP, uint16 _referralFeeBP) {
        require(_platformFeeBP + _referralFeeBP < 10_000, "Fees too high");
        platformFeeBP = _platformFeeBP;
        referralFeeBP = _referralFeeBP;
    }

    /*────────────────── 1. Core Launch & Buy ──────────────────*/
    function createMemeCoin(
        string calldata name_,
        string calldata symbol_,
        string calldata description_,
        uint256 totalSupply_,
        uint256 priceWei_,
        string calldata ipfsHash_
    ) external nonReentrant whenNotPaused returns (address tokenAddress) {
        if (priceWei_ == 0) revert PriceZero();
        MemeCoin token = new MemeCoin(
            name_,
            symbol_,
            totalSupply_,
            msg.sender,
            ipfsHash_
        );
        tokenAddress = address(token);
        allTokens.push(
            TokenInfo(
                tokenAddress,
                msg.sender,
                priceWei_,
                description_,
                ipfsHash_
            )
        );
        tokenIndexPlusOne[tokenAddress] = allTokens.length;
        emit TokenCreated(
            tokenAddress,
            msg.sender,
            priceWei_,
            description_,
            ipfsHash_
        );
    }

    function buyToken(
        address token_,
        uint256 amountAtomic,
        address referrer
    ) public payable nonReentrant whenNotPaused {
        if (buysPaused) revert BuysPaused();
        if (amountAtomic == 0) revert ZeroAmount();
        if (tokenPaused[token_]) revert TokenPaused();

        uint256 idx = tokenIndexPlusOne[token_];
        if (idx == 0) revert NotLaunched();
        if (whitelistEnabled[token_] && !whitelisted[token_][msg.sender])
            revert NotWhitelisted();

        TokenInfo storage info = allTokens[idx - 1];
        uint256 cost = (info.priceWei * amountAtomic) / 1e18;
        if (msg.value != cost) revert IncorrectETH();

        uint256 pf = (cost * platformFeeBP) / 10_000;
        uint256 rf = referrer == address(0)
            ? 0
            : (cost * referralFeeBP) / 10_000;
        uint256 cf = cost - pf - rf;

        platformFeesAccrued += pf;
        if (rf > 0) referralFeesAccrued[referrer] += rf;
        creatorFeesAccrued[info.creator] += cf;

        IERC20(token_).safeTransfer(msg.sender, amountAtomic);

        emit Bought(
            token_,
            msg.sender,
            amountAtomic,
            cost,
            referrer,
            pf,
            rf,
            cf
        );
    }

    /*────────────────── 2. Read-only Views ──────────────────*/
    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }
    function getTokens(
        uint256 start,
        uint256 count
    ) external view returns (TokenInfo[] memory page) {
        uint256 len = allTokens.length;
        uint256 end = start + count > len ? len : start + count;
        page = new TokenInfo[](end - start);
        for (uint256 i = start; i < end; i++) {
            page[i - start] = allTokens[i];
        }
    }
    function priceOf(address token_) external view returns (uint256) {
        uint256 idx = tokenIndexPlusOne[token_];
        if (idx == 0) revert NotLaunched();
        return allTokens[idx - 1].priceWei;
    }

    /*────────────────── 3. Fee Withdrawals ──────────────────*/
    function platformFeesAccumulated() external view returns (uint256) {
        return platformFeesAccrued;
    }
    function referralFees(address who) external view returns (uint256) {
        return referralFeesAccrued[who];
    }
    function withdrawPlatformFees() external onlyOwner nonReentrant {
        uint256 bal = platformFeesAccrued;
        if (bal == 0) revert IncorrectETH();
        platformFeesAccrued = 0;
        payable(owner()).transfer(bal);
        emit ETHRescued(owner(), bal);
    }
    function withdrawReferralFees() external nonReentrant {
        uint256 bal = referralFeesAccrued[msg.sender];
        if (bal == 0) revert IncorrectETH();
        referralFeesAccrued[msg.sender] = 0;
        payable(msg.sender).transfer(bal);
        emit ETHRescued(msg.sender, bal);
    }
    function withdrawCreatorFees(address token_) external nonReentrant {
        uint256 idx = tokenIndexPlusOne[token_];
        if (idx == 0) revert NotLaunched();
        address c = allTokens[idx - 1].creator;
        if (msg.sender != c) revert NotAuthorized();
        uint256 bal = creatorFeesAccrued[c];
        if (bal == 0) revert IncorrectETH();
        creatorFeesAccrued[c] = 0;
        payable(c).transfer(bal);
        emit ETHRescued(c, bal);
    }

    /*────────────────── 4. Creator Dashboard ──────────────────*/
    function updatePrice(
        address token_,
        uint256 newPriceWei
    ) external whenNotPaused {
        if (newPriceWei == 0) revert PriceZero();
        uint256 idx = tokenIndexPlusOne[token_];
        if (idx == 0) revert NotLaunched();
        TokenInfo storage info = allTokens[idx - 1];
        if (msg.sender != info.creator && msg.sender != owner())
            revert NotAuthorized();
        info.priceWei = newPriceWei;
        emit PriceUpdated(token_, newPriceWei);
    }
    function reclaimUnsold(
        address token_,
        uint256 amount
    ) external nonReentrant {
        uint256 idx = tokenIndexPlusOne[token_];
        if (idx == 0) revert NotLaunched();
        TokenInfo storage info = allTokens[idx - 1];
        if (msg.sender != info.creator) revert NotAuthorized();
        IERC20(token_).safeTransfer(info.creator, amount);
        emit UnsoldReclaimed(token_, amount);
    }
    function updateMetadata(
        address token_,
        string calldata d,
        string calldata h
    ) external {
        uint256 idx = tokenIndexPlusOne[token_];
        require(idx != 0, "Not launched");
        TokenInfo storage info = allTokens[idx - 1];
        require(msg.sender == info.creator, "Not creator");
        info.description = d;
        info.ipfsHash = h;
        emit MetadataUpdated(token_, d, h);
    }

    /*────────────────── 5. Admin / Treasury ──────────────────*/
    function updateFees(uint16 _pf, uint16 _rf) external onlyOwner {
        require(_pf + _rf < 10_000, "Fees too high");
        platformFeeBP = _pf;
        referralFeeBP = _rf;
        emit FeesUpdated(_pf, _rf);
    }
    function rescueERC20(
        address token_,
        uint256 amount
    ) external onlyOwner nonReentrant {
        IERC20(token_).safeTransfer(owner(), amount);
        emit TokenRescued(token_, amount);
    }

    /*────────────────── 6. DEX Helpers ──────────────────*/
    function setDexAddresses(address f, address r) external onlyOwner {
        require(f != address(0) && r != address(0), "Invalid DEX addr");
        dexFactory = f;
        dexRouter = r;
        emit DexConfigured(f, r);
    }
    function createLiquidityPair(
        address token_
    ) external onlyOwner returns (address pair) {
        IUniswapV2Factory fac = IUniswapV2Factory(dexFactory);
        address weth = IUniswapV2Router02(dexRouter).WETH();
        pair = fac.getPair(token_, weth);
        if (pair == address(0)) pair = fac.createPair(token_, weth);
    }
    function addLiquidity(
        address token_,
        uint256 amt
    ) external payable nonReentrant returns (uint256, uint256, uint256) {
        IERC20(token_).safeTransferFrom(msg.sender, address(this), amt);
        IERC20(token_).safeIncreaseAllowance(dexRouter, amt);
        return
            IUniswapV2Router02(dexRouter).addLiquidityETH{value: msg.value}(
                token_,
                amt,
                0,
                0,
                msg.sender,
                block.timestamp
            );
    }
    function removeLiquidity(
        address token_,
        uint256 liq
    ) external nonReentrant returns (uint256, uint256) {
        address weth = IUniswapV2Router02(dexRouter).WETH();
        address pair = IUniswapV2Factory(dexFactory).getPair(token_, weth);
        IERC20(pair).safeTransferFrom(msg.sender, address(this), liq);
        IERC20(pair).safeIncreaseAllowance(dexRouter, liq);
        return
            IUniswapV2Router02(dexRouter).removeLiquidityETH(
                token_,
                liq,
                0,
                0,
                msg.sender,
                block.timestamp
            );
    }
    function getPoolAddress(address token_) external view returns (address) {
        address weth = IUniswapV2Router02(dexRouter).WETH();
        return IUniswapV2Factory(dexFactory).getPair(token_, weth);
    }
    function isListed(address token_) external view returns (bool) {
        address weth = IUniswapV2Router02(dexRouter).WETH();
        return
            IUniswapV2Factory(dexFactory).getPair(token_, weth) != address(0);
    }

    /*────────────────── 7. Batch & Pagination ──────────────────*/
    function listTokensPaginated(
        uint256 s,
        uint256 c
    ) external view returns (TokenInfo[] memory page, uint256 total) {
        total = allTokens.length;
        uint256 e = s + c > total ? total : s + c;
        page = new TokenInfo[](e - s);
        for (uint256 i = s; i < e; i++) page[i - s] = allTokens[i];
    }
    function unsoldForAll(
        address[] calldata toks
    ) external view returns (uint256[] memory out) {
        out = new uint256[](toks.length);
        for (uint256 i; i < toks.length; i++) {
            out[i] = IERC20(toks[i]).balanceOf(address(this));
        }
    }
    function reclaimUnsoldBatch(
        address[] calldata toks,
        uint256[] calldata amts
    ) external nonReentrant {
        require(toks.length == amts.length, "Length mismatch");
        for (uint256 i; i < toks.length; i++) {
            address t = toks[i];
            uint256 a = amts[i];
            uint256 idx = tokenIndexPlusOne[t];
            if (idx == 0) revert NotLaunched();
            TokenInfo storage info = allTokens[idx - 1];
            if (msg.sender != info.creator) revert NotAuthorized();
            IERC20(t).safeTransfer(info.creator, a);
            emit UnsoldReclaimed(t, a);
        }
    }

    /*────────────────── 8. Pause & Emergency ──────────────────*/
    function pauseBuys() external onlyOwner {
        buysPaused = true;
        emit BuysPausedEvent();
    }
    function unpauseBuys() external onlyOwner {
        buysPaused = false;
        emit BuysUnpausedEvent();
    }
    function pauseTokenSales(address t) external onlyOwner {
        tokenPaused[t] = true;
        emit TokenPausedEvent(t);
    }
    function unpauseTokenSales(address t) external onlyOwner {
        tokenPaused[t] = false;
        emit TokenUnpausedEvent(t);
    }

    function emergencyWithdrawETH() external onlyOwner nonReentrant {
        uint256 bal = address(this).balance;
        require(bal > 0, "No ETH");
        payable(owner()).transfer(bal);
        emit ETHRescued(owner(), bal);
    }
    function emergencyWithdrawToken(address t) external onlyOwner nonReentrant {
        uint256 bal = IERC20(t).balanceOf(address(this));
        require(bal > 0, "No tokens");
        IERC20(t).safeTransfer(owner(), bal);
        emit TokenRescued(t, bal);
    }

    /*────────────────── 9. Whitelist & Presale ──────────────────*/
    function setWhitelistEnabled(address token_, bool on) external onlyOwner {
        whitelistEnabled[token_] = on;
    }
    function addToWhitelist(
        address token_,
        address[] calldata users
    ) external onlyOwner {
        for (uint i; i < users.length; i++) {
            whitelisted[token_][users[i]] = true;
        }
    }
    function setPresaleMerkleRoot(bytes32 root_) external onlyOwner {
        presaleMerkleRoot = root_;
        emit PresaleRootUpdated(root_);
    }
    function buyPresale(
        address token_,
        uint256 amt,
        address ref,
        bytes32[] calldata proof
    ) external payable nonReentrant {
        if (
            !MerkleProof.verify(
                proof,
                presaleMerkleRoot,
                keccak256(abi.encodePacked(msg.sender))
            )
        ) revert NotWhitelisted();
        buyToken(token_, amt, ref);
    }

    /*──────────────────10. Vesting & Tokenomics ──────────────────*/
    function setVestingSchedule(
        address b,
        uint256 tot,
        uint256 cliff_,
        uint256 dur
    ) external onlyOwner {
        require(tot > 0 && dur > cliff_, "Bad params");
        vestingSchedules[b] = Vesting(tot, 0, block.timestamp, cliff_, dur);
        emit VestingScheduleSet(b, tot, block.timestamp, cliff_, dur);
    }
    function claimVested() external nonReentrant {
        Vesting storage v = vestingSchedules[msg.sender];
        if (v.total == 0) revert NoVesting();
        uint256 elapsed = block.timestamp - v.start;
        uint256 vested = elapsed < v.cliff
            ? 0
            : elapsed >= v.duration
                ? v.total
                : (v.total * (elapsed - v.cliff)) / (v.duration - v.cliff);
        uint256 claimable = vested - v.claimed;
        if (claimable == 0) revert NothingToClaim();
        v.claimed = vested;
        IERC20(address(this)).safeTransfer(msg.sender, claimable);
        emit VestedClaimed(msg.sender, claimable);
    }

    /*──────────────────11. Analytics & Views ──────────────────*/
    function getSalesStats(
        address token_
    ) external view returns (uint256 sold_, uint256 raised_) {
        sold_ =
            IERC20(token_).totalSupply() -
            IERC20(token_).balanceOf(address(this));
        raised_ = address(this).balance;
    }
    function getRevenueSplit(
        uint256 amt
    ) external view returns (uint256 pf, uint256 rf, uint256 cf) {
        pf = (amt * platformFeeBP) / 10_000;
        rf = (amt * referralFeeBP) / 10_000;
        cf = amt - pf - rf;
    }

    receive() external payable {
        revert("Use buyToken");
    }
    fallback() external payable {
        revert("Use buyToken");
    }
}

/// @notice Simple LP-locking contract
contract LiquidityLocker is Ownable {
    using SafeERC20 for IERC20;
    struct Lock {
        address pair;
        uint256 amount;
        uint256 unlockTime;
    }
    mapping(address => Lock[]) public locks;

    function lockLP(address pair, uint256 amt, uint256 dur) external {
        IERC20(pair).safeTransferFrom(msg.sender, address(this), amt);
        locks[msg.sender].push(Lock(pair, amt, block.timestamp + dur));
    }
    function withdrawUnlocked(uint256 idx) external {
        Lock storage L = locks[msg.sender][idx];
        require(block.timestamp >= L.unlockTime, "Still locked");
        IERC20(L.pair).safeTransfer(msg.sender, L.amount);
        delete locks[msg.sender][idx];
    }
}
