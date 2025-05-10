// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./MemeCoin.sol";

/// @dev External DEX helper interface (splitted out to stay below size limit)
interface IMemeCoinDEXHelper {
    function setDexAddresses(address factory_, address router_) external;
    function createLiquidityPair(address token_) external returns (address);
    function addLiquidity(
        address token_,
        uint256 amountToken_
    ) external payable returns (uint256, uint256, uint256);
    function removeLiquidity(
        address token_,
        uint256 liquidity_
    ) external returns (uint256, uint256);
}

/// @title MemeCoinFactory
/// @notice Launchpad + fixed-price marketplace + vesting + whitelist + rescue + modular DEX
contract MemeCoinFactory is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ────────────────────────────────────────────────
    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ─── Fees ─────────────────────────────────────────────────
    uint16  public platformFeeBP;
    uint16  public referralFeeBP;
    uint256 public platformFeesAccrued;
    mapping(address => uint256) public referralFeesAccrued;
    mapping(address => uint256) public creatorFeesAccrued;

    // ─── Whitelist & Presale ─────────────────────────────────
    bytes32 public presaleMerkleRoot;
    mapping(address => bool)                    public whitelistEnabled;
    mapping(address => mapping(address => bool)) public whitelisted;

    // ─── Token Listings ──────────────────────────────────────
    struct TokenInfo {
        address token;
        address creator;
        uint256 priceWei;
        string  description;
        string  ipfsHash;
    }
    TokenInfo[] public allTokens;
    mapping(address => uint256) public tokenIndexPlusOne;
    mapping(address => bool)    public tokenPaused;

    // ─── Vesting ─────────────────────────────────────────────
    struct Vesting {
        address token;
        uint256 total;
        uint256 claimed;
        uint256 start;
        uint256 cliff;
        uint256 duration;
    }
    mapping(address => Vesting) public vestingSchedules;

    // ─── Modular DEX Helper ──────────────────────────────────
    IMemeCoinDEXHelper public dexHelper;

    /*──────────────────── Events ─────────────────────────────*/
    event TokenCreated(
        address indexed token,
        address indexed creator,
        uint256 priceWei,
        string  description,
        string  ipfsHash
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
    event FeesUpdated(uint16 newPlatformBP, uint16 newReferralBP);
    event DexHelperSet(address indexed helper);
    event PriceUpdated(address indexed token, uint256 newPriceWei);
    event MetadataUpdated(address indexed token, string desc, string ipfsHash);
    event TokenPaused(address indexed token);
    event TokenUnpaused(address indexed token);
    event UnsoldReclaimed(address indexed token, uint256 amount);
    event PresaleRootUpdated(bytes32 newRoot);
    event WhitelistToggled(address indexed token, bool enabled);
    event UserWhitelisted(address indexed token, address indexed user);
    event VestingScheduleSet(
        address indexed beneficiary,
        address indexed token,
        uint256 total,
        uint256 start,
        uint256 cliff,
        uint256 duration
    );
    event VestedClaimed(
        address indexed beneficiary,
        address indexed token,
        uint256 amountClaimed
    );
    event ETHRescued(address indexed to, uint256 amount);
    event TokenRescued(address indexed token, uint256 amount);

    constructor(uint16 _platformFeeBP, uint16 _referralFeeBP) {
        require(_platformFeeBP + _referralFeeBP < 10_000, "Fees too high");
        platformFeeBP   = _platformFeeBP;
        referralFeeBP   = _referralFeeBP;
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(PAUSER_ROLE,         msg.sender);
        _setupRole(OPERATOR_ROLE,       msg.sender);
    }

    /*────────────────── 1. Launch & Buy ───────────────────────*/
    function createMemeCoin(
        string calldata name_,
        string calldata symbol_,
        string calldata description_,
        uint256 totalSupply_,
        uint256 priceWei_,
        string calldata ipfsHash_
    )
        external
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
        nonReentrant
        returns (address)
    {
        require(priceWei_ > 0, "PriceZero");

        MemeCoin token = new MemeCoin(
            name_,
            symbol_,
            totalSupply_,
            msg.sender,
            ipfsHash_
        );
        address tokenAddr = address(token);

        allTokens.push(
            TokenInfo(tokenAddr, msg.sender, priceWei_, description_, ipfsHash_)
        );
        tokenIndexPlusOne[tokenAddr] = allTokens.length;

        emit TokenCreated(
            tokenAddr,
            msg.sender,
            priceWei_,
            description_,
            ipfsHash_
        );
        return tokenAddr;
    }

    function buyToken(
        address token_,
        uint256 amountAtomic,
        address referrer
    ) public payable whenNotPaused nonReentrant {
        require(amountAtomic > 0,           "ZeroAmount");
        require(!tokenPaused[token_],       "TokenPaused");
        uint256 idx = tokenIndexPlusOne[token_];
        require(idx != 0,                   "NotLaunched");
        if (whitelistEnabled[token_]) {
            require(whitelisted[token_][msg.sender], "NotWhitelisted");
        }

        TokenInfo storage info = allTokens[idx - 1];
        uint256 cost = (info.priceWei * amountAtomic) / 1e18;
        require(msg.value == cost,          "IncorrectETH");

        uint256 pf = (cost * platformFeeBP)   / 10_000;
        uint256 rf = referrer == address(0)
            ? 0
            : (cost * referralFeeBP)         / 10_000;
        uint256 cf = cost - pf - rf;

        platformFeesAccrued += pf;
        if (rf > 0) referralFeesAccrued[referrer] += rf;
        creatorFeesAccrued[info.creator]  += cf;

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

    /*────────────────── 2. Views, Fees & Metadata ─────────────*/
    /// @notice Get a single listing by array index
    function getTokenDetails(uint256 index)
        external
        view
        returns (
            address token,
            address creator,
            uint256 priceWei,
            string memory description,
            string memory ipfsHash
        )
    {
        TokenInfo storage info = allTokens[index];
        return (
            info.token,
            info.creator,
            info.priceWei,
            info.description,
            info.ipfsHash
        );
    }

    /// @notice Get listing info by token address
    function getTokenDetailsByAddress(address token_)
        external
        view
        returns (
            address creator,
            uint256 priceWei,
            string memory description,
            string memory ipfsHash
        )
    {
        uint256 idx = tokenIndexPlusOne[token_];
        require(idx != 0, "NotLaunched");
        TokenInfo storage info = allTokens[idx - 1];
        return (
            info.creator,
            info.priceWei,
            info.description,
            info.ipfsHash
        );
    }

    /// @notice Find the array index of a given token
    function getTokenIndex(address token_) external view returns (uint256) {
        uint256 idxPlusOne = tokenIndexPlusOne[token_];
        require(idxPlusOne != 0, "NotLaunched");
        return idxPlusOne - 1;
    }

    /// @notice List all tokens created by a particular address
    function getTokensByCreator(address creator_)
        external
        view
        returns (TokenInfo[] memory)
    {
        uint256 total = allTokens.length;
        uint256 count = 0;
        for (uint256 i = 0; i < total; i++) {
            if (allTokens[i].creator == creator_) {
                count++;
            }
        }
        TokenInfo[] memory result = new TokenInfo[](count);
        uint256 j = 0;
        for (uint256 i = 0; i < total; i++) {
            if (allTokens[i].creator == creator_) {
                result[j++] = allTokens[i];
            }
        }
        return result;
    }

    /// @notice How many tokens of `token_` remain unsold (in this contract)
    function unsoldSupply(address token_) external view returns (uint256) {
        return IERC20(token_).balanceOf(address(this));
    }

    // ────────────────── 3. Whitelist & Presale ─────────────────
    function toggleWhitelist(address token_, bool on)
        external
        onlyRole(OPERATOR_ROLE)
    {
        whitelistEnabled[token_] = on;
        emit WhitelistToggled(token_, on);
    }

    function addToWhitelist(address token_, address[] calldata users)
        external
        onlyRole(OPERATOR_ROLE)
    {
        for (uint256 i = 0; i < users.length; i++) {
            whitelisted[token_][users[i]] = true;
            emit UserWhitelisted(token_, users[i]);
        }
    }

    function setPresaleMerkleRoot(bytes32 root_)
        external
        onlyRole(OPERATOR_ROLE)
    {
        presaleMerkleRoot = root_;
        emit PresaleRootUpdated(root_);
    }

    function buyPresale(
        address token_,
        uint256 amt,
        address ref,
        bytes32[] calldata proof
    ) external payable whenNotPaused nonReentrant {
        require(
            MerkleProof.verify(
                proof,
                presaleMerkleRoot,
                keccak256(abi.encodePacked(msg.sender))
            ),
            "NotWhitelisted"
        );
        buyToken(token_, amt, ref);
    }

    // ────────────────── 4. Vesting ─────────────────────────────
    function setVestingSchedule(
        address beneficiary,
        address token_,
        uint256 total,
        uint256 cliff,
        uint256 duration
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused {
        require(total > 0 && duration > cliff, "BadParams");
        IERC20(token_).safeTransferFrom(msg.sender, address(this), total);
        vestingSchedules[beneficiary] = Vesting(
            token_,
            total,
            0,
            block.timestamp,
            cliff,
            duration
        );
        emit VestingScheduleSet(
            beneficiary,
            token_,
            total,
            block.timestamp,
            cliff,
            duration
        );
    }

    function claimVested() external whenNotPaused nonReentrant {
        Vesting storage v = vestingSchedules[msg.sender];
        require(v.total > 0, "NoVesting");
        uint256 elapsed = block.timestamp - v.start;
        uint256 vested = elapsed < v.cliff
            ? 0
            : elapsed >= v.duration
                ? v.total
                : (v.total * (elapsed - v.cliff)) /
                  (v.duration - v.cliff);
        uint256 claimable = vested - v.claimed;
        require(claimable > 0, "NothingToClaim");

        v.claimed = vested;
        IERC20(v.token).safeTransfer(msg.sender, claimable);
        emit VestedClaimed(msg.sender, v.token, claimable);
    }

    // ────────────────── 5. Rescue & Pause ───────────────────────
    function reclaimUnsold(address token_, uint256 amount)
        external
        whenNotPaused
        nonReentrant
    {
        uint256 idx = tokenIndexPlusOne[token_];
        require(idx != 0, "NotLaunched");
        TokenInfo storage info = allTokens[idx - 1];
        require(msg.sender == info.creator, "NotAuthorized");
        IERC20(token_).safeTransfer(info.creator, amount);
        emit UnsoldReclaimed(token_, amount);
    }

    function reclaimUnsoldBatch(address[] calldata toks, uint256[] calldata amts)
        external
        whenNotPaused
        nonReentrant
    {
        require(toks.length == amts.length, "LengthMismatch");
        for (uint256 i = 0; i < toks.length; i++) {
            address t = toks[i];
            uint256 a = amts[i];
            uint256 idx = tokenIndexPlusOne[t];
            require(idx != 0, "NotLaunched");
            TokenInfo storage info = allTokens[idx - 1];
            require(msg.sender == info.creator, "NotAuthorized");
            IERC20(t).safeTransfer(info.creator, a);
            emit UnsoldReclaimed(t, a);
        }
    }

    function rescueERC20(address token_, uint256 amount)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        whenNotPaused
    {
        IERC20(token_).safeTransfer(msg.sender, amount);
        emit TokenRescued(token_, amount);
    }

    function emergencyWithdrawETH()
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        uint256 bal = address(this).balance;
        require(bal > 0, "NoETH");
        payable(msg.sender).transfer(bal);
        emit ETHRescued(msg.sender, bal);
    }

    function emergencyWithdrawToken(address token_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        nonReentrant
    {
        uint256 bal = IERC20(token_).balanceOf(address(this));
        require(bal > 0, "NoTokens");
        IERC20(token_).safeTransfer(msg.sender, bal);
        emit TokenRescued(token_, bal);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    function pauseTokenSales(address token_) external onlyRole(OPERATOR_ROLE) {
        tokenPaused[token_] = true;
        emit TokenPaused(token_);
    }
    function unpauseTokenSales(address token_) external onlyRole(OPERATOR_ROLE) {
        tokenPaused[token_] = false;
        emit TokenUnpaused(token_);
    }

    // ────────────────── 6. Modular DEX Helpers ──────────────────
    function setDexHelper(address helper_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(helper_ != address(0), "InvalidHelper");
        dexHelper = IMemeCoinDEXHelper(helper_);
        emit DexHelperSet(helper_);
    }

    function configureDex(address factory_, address router_)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
        whenNotPaused
    {
        dexHelper.setDexAddresses(factory_, router_);
    }

    function createPair(address token_)
        external
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
    {
        dexHelper.createLiquidityPair(token_);
    }

    function addTokenLiquidity(address token_, uint256 amountToken_)
        external
        payable
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
    {
        dexHelper.addLiquidity{value: msg.value}(token_, amountToken_);
    }

    function removeTokenLiquidity(address token_, uint256 liq_)
        external
        onlyRole(OPERATOR_ROLE)
        whenNotPaused
    {
        dexHelper.removeLiquidity(token_, liq_);
    }

    receive() external payable {
        revert("Use buyToken");
    }
    fallback() external payable {
        revert("Use buyToken");
    }
}
