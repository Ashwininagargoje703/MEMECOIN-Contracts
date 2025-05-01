// contracts/MemeCoinFactory.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./MemeCoin.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";  // moved in OZ5
import "@openzeppelin/contracts/utils/Pausable.sol";          // moved in OZ5

/// @title MemeCoinFactory: launchpad + fixed-price buy-only marketplace
contract MemeCoinFactory is Ownable, ReentrancyGuard, Pausable {
    using SafeERC20 for IERC20;

    struct TokenInfo {
        address token;
        address creator;
        uint256 priceWei;    // price per whole token (atomic 1e18)
        string  description; // human-readable blurb
        string  ipfsHash;    // CID for JSON metadata
    }

    TokenInfo[] public allTokens;
    mapping(address => uint256) public tokenIndexPlusOne; // 0 = not launched
    mapping(address => bool)    public tokenPaused;       // per-token pause flag

    uint16 public platformFeeBP;  // e.g. 200 = 2%
    uint16 public referralFeeBP;  // e.g. 100 = 1%

    error PriceZero();
    error NotLaunched();
    error NotAuthorized();
    error IncorrectETH();
    error ZeroAmount();
    error TokenPaused();

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
    event FeesUpdated(uint16 newPlatformFeeBP, uint16 newReferralFeeBP);
    event TokenPausedEvent(address indexed token);
    event TokenUnpausedEvent(address indexed token);
    event ETHRescued(address indexed to, uint256 amount);
    event TokenRescued(address indexed token, uint256 amount);
    event UnsoldReclaimed(address indexed token, uint256 amount);

    /// @param _platformFeeBP basis points for platform (must + referral <10000)
    /// @param _referralFeeBP basis points for referral
    constructor(uint16 _platformFeeBP, uint16 _referralFeeBP)
        Ownable(msg.sender)                    // <— pass deployer into OZ5’s Ownable
    {
        require(_platformFeeBP + _referralFeeBP < 10_000, "Fees too high");
        platformFeeBP = _platformFeeBP;
        referralFeeBP = _referralFeeBP;
    }

    // 1. Core Launch & Buy

    /// @notice Deploys a new MemeCoin and registers it
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
            TokenInfo(tokenAddress, msg.sender, priceWei_, description_, ipfsHash_)
        );
        tokenIndexPlusOne[tokenAddress] = allTokens.length;

        emit TokenCreated(tokenAddress, msg.sender, priceWei_, description_, ipfsHash_);
    }

    /// @notice Buys `amountAtomic` at fixed price; splits fees
    function buyToken(
        address token_,
        uint256 amountAtomic,
        address referrer
    ) external payable nonReentrant whenNotPaused {
        if (amountAtomic == 0) revert ZeroAmount();
        if (tokenPaused[token_]) revert TokenPaused();

        uint256 idx = tokenIndexPlusOne[token_];
        if (idx == 0) revert NotLaunched();
        TokenInfo storage info = allTokens[idx - 1];

        uint256 cost = (info.priceWei * amountAtomic) / 1e18;
        if (msg.value != cost) revert IncorrectETH();

        uint256 platformShare = (cost * platformFeeBP) / 10_000;
        uint256 referralShare = referrer == address(0)
            ? 0
            : (cost * referralFeeBP) / 10_000;
        uint256 creatorShare = cost - platformShare - referralShare;

        if (platformShare > 0) payable(owner()).transfer(platformShare);
        if (referralShare > 0) payable(referrer).transfer(referralShare);
        payable(info.creator).transfer(creatorShare);

        IERC20(token_).safeTransfer(msg.sender, amountAtomic);

        emit Bought(
            token_, msg.sender, amountAtomic, cost,
            referrer, platformShare, referralShare, creatorShare
        );
    }

    // 2. Read-only Views

    function getTokens(uint256 start, uint256 count)
        external view returns (TokenInfo[] memory page)
    {
        uint256 len = allTokens.length;
        uint256 end = start + count > len ? len : start + count;
        page = new TokenInfo[](end - start);
        for (uint256 i = start; i < end; i++) {
            page[i - start] = allTokens[i];
        }
    }

    function totalTokens() external view returns (uint256) {
        return allTokens.length;
    }

    /// @notice Returns on-chain name/symbol + your stored metadata
    function getTokenDetails(uint256 index)
        external view
        returns (
            address token,
            string memory name_,
            string memory symbol_,
            string memory description_,
            string memory ipfsHash_,
            uint256 priceWei_,
            address creator_
        )
    {
        require(index < allTokens.length, "Index out of bounds");
        TokenInfo storage info = allTokens[index];
        token        = info.token;
        name_        = IERC20Metadata(token).name();
        symbol_      = IERC20Metadata(token).symbol();
        description_ = info.description;
        ipfsHash_    = info.ipfsHash;
        priceWei_    = info.priceWei;
        creator_     = info.creator;
    }

    // 3. Creator Dashboard

    function updatePrice(address token_, uint256 newPriceWei) external whenNotPaused {
        if (newPriceWei == 0) revert PriceZero();
        uint256 idx = tokenIndexPlusOne[token_];
        if (idx == 0) revert NotLaunched();
        TokenInfo storage info = allTokens[idx - 1];
        if (msg.sender != info.creator && msg.sender != owner()) revert NotAuthorized();

        info.priceWei = newPriceWei;
        emit PriceUpdated(token_, newPriceWei);
    }

    function reclaimUnsold(address token_, uint256 amount) external nonReentrant {
        uint256 idx = tokenIndexPlusOne[token_];
        if (idx == 0) revert NotLaunched();
        TokenInfo storage info = allTokens[idx - 1];
        if (msg.sender != info.creator) revert NotAuthorized();

        IERC20(token_).safeTransfer(info.creator, amount);
        emit UnsoldReclaimed(token_, amount);
    }

    function pauseToken(address token_)   external onlyOwner { tokenPaused[token_] = true;  emit TokenPausedEvent(token_); }
    function unpauseToken(address token_) external onlyOwner { tokenPaused[token_] = false; emit TokenUnpausedEvent(token_); }

    // 4. Admin / Treasury Panel

    function updateFees(uint16 _pf, uint16 _rf) external onlyOwner {
        require(_pf + _rf < 10_000, "Fees too high");
        platformFeeBP = _pf;
        referralFeeBP = _rf;
        emit FeesUpdated(_pf, _rf);
    }

    function withdrawETH(uint256 amount) external onlyOwner {
        require(address(this).balance >= amount, "Insufficient ETH");
        payable(owner()).transfer(amount);
        emit ETHRescued(owner(), amount);
    }

    function rescueERC20(address token_, uint256 amount) external onlyOwner {
        IERC20(token_).safeTransfer(owner(), amount);
        emit TokenRescued(token_, amount);
    }

    function pause()   external onlyOwner { _pause();   }
    function unpause() external onlyOwner { _unpause(); }

    receive() external payable { revert("Use buyToken"); }
    fallback() external payable { revert("Use buyToken"); }
}
