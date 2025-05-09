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
/// @notice Launchpad + fixed‑price marketplace + vesting + whitelist + rescue + modular DEX
contract MemeCoinFactory is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── Roles ─────────────────────────────────────────────────────
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    // ─── Fees ──────────────────────────────────────────────────────
    uint16 public platformFeeBP;
    uint16 public referralFeeBP;
    uint256 public platformFeesAccrued;
    mapping(address => uint256) public referralFeesAccrued;
    mapping(address => uint256) public creatorFeesAccrued;

    // ─── Whitelist & Presale ──────────────────────────────────────
    bytes32 public presaleMerkleRoot;
    mapping(address => bool) public whitelistEnabled;
    mapping(address => mapping(address => bool)) public whitelisted;

    // ─── Token Listings ────────────────────────────────────────────
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

    // ─── Vesting ───────────────────────────────────────────────────
    struct Vesting {
        address token;
        uint256 total;
        uint256 claimed;
        uint256 start;
        uint256 cliff;
        uint256 duration;
    }
    mapping(address => Vesting) public vestingSchedules;

    // ─── Modular DEX Helper ────────────────────────────────────────
    IMemeCoinDEXHelper public dexHelper;

    /*──────────────────── Events ──────────────────────────────*/
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
        platformFeeBP = _platformFeeBP;
        referralFeeBP = _referralFeeBP;
        _setupRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _setupRole(PAUSER_ROLE, msg.sender);
        _setupRole(OPERATOR_ROLE, msg.sender);
    }

    /*────────────────── 1. Launch & Buy ─────────────────────────*/
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
        require(amountAtomic > 0, "ZeroAmount");
        require(!tokenPaused[token_], "TokenPaused");

        uint256 idx = tokenIndexPlusOne[token_];
        require(idx != 0, "NotLaunched");
        if (whitelistEnabled[token_]) {
            require(whitelisted[token_][msg.sender], "NotWhitelisted");
        }

        TokenInfo storage info = allTokens[idx - 1];
        uint256 cost = (info.priceWei * amountAtomic) / 1e18;
        require(msg.value == cost, "IncorrectETH");

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

    /*────────────────── 2. Views, Fees, Metadata ─────────────────*/
    // ... (keep your existing view functions and fee-withdrawals here, unchanged)

    /*────────────────── 3. Whitelist & Presale ─────────────────*/
    // ... (keep your existing whitelist/presale functions, unchanged)

    /*────────────────── 4. Vesting ─────────────────────────────*/
    // ... (keep your existing vesting functions, unchanged)

    /*────────────────── 5. Rescue & Pause ───────────────────────*/
    // ... (keep your emergency/rescue and pause controls, unchanged)

    /*────────────────── 6. Modular DEX Helpers ──────────────────*/
    /// @notice Point to your deployed DEX helper
    function setDexHelper(
        address helper_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(helper_ != address(0), "InvalidHelper");
        dexHelper = IMemeCoinDEXHelper(helper_);
        emit DexHelperSet(helper_);
    }

    /// @notice Configure Uniswap V2 addresses (factory & router)
    function configureDex(
        address factory_,
        address router_
    ) external onlyRole(DEFAULT_ADMIN_ROLE) whenNotPaused {
        dexHelper.setDexAddresses(factory_, router_);
    }

    /// @notice Create ETH–token pair
    function createPair(
        address token_
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused {
        dexHelper.createLiquidityPair(token_);
    }

    /// @notice Add liquidity (tokens must already be in this contract or approved)
    function addTokenLiquidity(
        address token_,
        uint256 amountToken_
    ) external payable onlyRole(OPERATOR_ROLE) whenNotPaused {
        dexHelper.addLiquidity{value: msg.value}(token_, amountToken_);
    }

    /// @notice Remove liquidity
    function removeTokenLiquidity(
        address token_,
        uint256 liq_
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused {
        dexHelper.removeLiquidity(token_, liq_);
    }

    receive() external payable {
        revert("Use buyToken");
    }
    fallback() external payable {
        revert("Use buyToken");
    }
}
