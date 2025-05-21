// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "./MemeCoinFactory.sol";

contract WhitelistPresale is AccessControl, ReentrancyGuard {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    MemeCoinFactory public immutable factory;
    bytes32 public presaleMerkleRoot;
    mapping(address => mapping(address => bool)) public isWhitelisted;

    event PresaleRootUpdated(bytes32 indexed newRoot);
    event UserWhitelisted(address indexed token, address indexed user);
    event PresalePurchase(
        address indexed token,
        address indexed buyer,
        uint256 amt,
        uint256 cost
    );

    constructor(address payable factoryAddress) {
        require(factoryAddress != address(0), "Factory zero");
        factory = MemeCoinFactory(factoryAddress);
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    function setPresaleRoot(bytes32 newRoot) external onlyRole(OPERATOR_ROLE) {
        presaleMerkleRoot = newRoot;
        emit PresaleRootUpdated(newRoot);
    }

    function whitelistUsers(
        address token,
        address[] calldata users
    ) external onlyRole(OPERATOR_ROLE) {
        for (uint i; i < users.length; ) {
            isWhitelisted[token][users[i]] = true;
            emit UserWhitelisted(token, users[i]);
            unchecked {
                ++i;
            }
        }
    }

    function buyPresale(
        address token,
        uint256 amountAtomic,
        uint256, // maxAlloc
        address referrer,
        bytes32[] calldata proof
    ) external payable nonReentrant {
        bool ok = isWhitelisted[token][msg.sender] ||
            MerkleProof.verify(
                proof,
                presaleMerkleRoot,
                keccak256(abi.encodePacked(msg.sender, amountAtomic))
            );
        require(ok, "Not eligible");

        // 1) Forward ETH into factory.buyToken,
        //    it transfers amountAtomic to this contract
        factory.buyToken{value: msg.value}(token, amountAtomic, referrer);

        // 2) Directly transfer from this contract to buyer
        IERC20(token).transfer(msg.sender, amountAtomic);

        emit PresalePurchase(token, msg.sender, amountAtomic, msg.value);
    }
}
