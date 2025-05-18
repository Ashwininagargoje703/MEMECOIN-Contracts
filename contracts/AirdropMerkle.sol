// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/utils/cryptography/MerkleProof.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Merkle‐Airdrop Module
/// @notice Distribute tokens to a precomputed Merkle tree of (address → amount)
contract AirdropMerkle {
    using SafeERC20 for IERC20;

    /// @notice The token to airdrop
    IERC20 public immutable token;
    /// @notice Merkle root of (address, amount) leaves
    bytes32 public merkleRoot;
    /// @notice Track who has claimed
    mapping(address => bool) public claimed;

    event AirdropClaimed(address indexed user, uint256 amount);
    event MerkleRootUpdated(bytes32 newRoot);

    /// @param token_     ERC‐20 token to distribute
    /// @param merkleRoot_ Initial Merkle root
    constructor(address token_, bytes32 merkleRoot_) {
        require(token_ != address(0), "Zero token");
        token      = IERC20(token_);
        merkleRoot = merkleRoot_;
    }

    /// @notice Update the Merkle root (e.g. for additional rounds)
    function setMerkleRoot(bytes32 newRoot) external {
        // guard this behind your factory’s OPERATOR_ROLE or similar
        merkleRoot = newRoot;
        emit MerkleRootUpdated(newRoot);
    }

    /// @notice Claim `amount` tokens if your (msg.sender, amount) is in the Merkle tree
    function claim(uint256 amount, bytes32[] calldata proof) external {
        require(!claimed[msg.sender], "Already claimed");
        // verify proof
        bytes32 leaf = keccak256(abi.encodePacked(msg.sender, amount));
        require(MerkleProof.verify(proof, merkleRoot, leaf), "Invalid proof");

        claimed[msg.sender] = true;
        token.safeTransfer(msg.sender, amount);
        emit AirdropClaimed(msg.sender, amount);
    }
}
