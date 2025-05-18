// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./MemeCoinFactory.sol";

/**
 * @title Whitelist & Presale Module
 * @notice Forward Merkle-proof based presale buys to the main factory and manage a secondary whitelist
 */
contract WhitelistPresale is AccessControl, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    /// @notice Main factory to execute presale buys
    MemeCoinFactory public immutable factory;
    /// @notice Current Merkle root for presale eligibility
    bytes32 public presaleMerkleRoot;

    /// @notice Simple on-chain whitelist mapping: token => user => allowed
    mapping(address => mapping(address => bool)) public isWhitelisted;

    event PresaleRootUpdated(bytes32 indexed newRoot);
    event UserWhitelisted(address indexed token, address indexed user);
    event PresalePurchase(
        address indexed token,
        address indexed buyer,
        uint256 amount,
        uint256 cost
    );

    /**
     * @param factoryAddress Address of the deployed MemeCoinFactory
     */
    constructor(address factoryAddress) {
        require(factoryAddress != address(0), "Factory zero address");
        // cast to payable so we can forward { value: msg.value } through buyPresale
        factory = MemeCoinFactory(payable(factoryAddress));

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE,      msg.sender);
    }

    /**
     * @notice Update the Merkle root used for presale eligibility
     */
    function setPresaleRoot(bytes32 newRoot) external onlyRole(OPERATOR_ROLE) {
        presaleMerkleRoot = newRoot;
        emit PresaleRootUpdated(newRoot);
    }

    /**
     * @notice Bulk-whitelist specific users for a token, bypassing Merkle
     */
    function whitelistUsers(address token, address[] calldata users)
        external
        onlyRole(OPERATOR_ROLE)
    {
        for (uint256 i; i < users.length; ) {
            isWhitelisted[token][users[i]] = true;
            emit UserWhitelisted(token, users[i]);
            unchecked { ++i; }
        }
    }

    /**
     * @notice Buy during presale if eligible by Merkle proof or on-chain whitelist
     */
    function buyPresale(
        address    token,
        uint256    amountAtomic,
        uint256    maxAllocation,
        address    referrer,
        bytes32[] calldata proof
    ) external payable nonReentrant {
        // either Merkle-proof or pre-whitelisted
        bool ok = isWhitelisted[token][msg.sender] ||
            MerkleProof.verify(
                proof,
                presaleMerkleRoot,
                keccak256(abi.encodePacked(msg.sender, maxAllocation))
            );
        require(ok, "Not eligible for presale");

        // forward ETH + args to factory
        factory.buyPresale{value: msg.value}(
            token,
            amountAtomic,
            maxAllocation,
            referrer,
            proof
        );

        emit PresalePurchase(token, msg.sender, amountAtomic, msg.value);
    }
}
