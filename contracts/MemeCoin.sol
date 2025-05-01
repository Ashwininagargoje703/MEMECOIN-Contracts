// contracts/MemeCoin.sol
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title ERC20 “MemeCoin” with IPFS metadata + EIP-2612 Permit & ownership
contract MemeCoin is ERC20Permit, Ownable {
    /// @notice IPFS CID for off-chain JSON metadata
    string public ipfsHash;

    error ZeroAddress();
    error EmptyNameOrSymbol();
    error ZeroSupply();

    /// @param name_       Token name (min 3 chars)
    /// @param symbol_     Token symbol (min 3 chars)
    /// @param totalSupply_ Mint amount in atomic units (18 decimals)
    /// @param creator_    Address to receive ownership
    /// @param ipfsHash_   CID for metadata JSON
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        address creator_,
        string memory ipfsHash_
    )
        ERC20(name_, symbol_)
        ERC20Permit(name_)
        Ownable(msg.sender)                // <— pass msg.sender into OZ5’s Ownable
    {
        if (creator_ == address(0)) revert ZeroAddress();
        if (bytes(name_).length < 3 || bytes(symbol_).length < 3)
            revert EmptyNameOrSymbol();
        if (totalSupply_ == 0) revert ZeroSupply();

        ipfsHash = ipfsHash_;
        _mint(msg.sender, totalSupply_);   // factory (msg.sender) gets full supply
        transferOwnership(creator_);        // then hand token-owner to creator
    }

    /// @notice Returns the full metadata URI, e.g. "ipfs://<CID>"
    function tokenURI() external view returns (string memory) {
        return string(abi.encodePacked("ipfs://", ipfsHash));
    }
}
