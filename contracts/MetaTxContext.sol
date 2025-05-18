// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/metatx/ERC2771Context.sol";

abstract contract MetaTxContext is ERC2771Context {
    constructor(address forwarder) ERC2771Context(forwarder) {}

    /// @dev Only need to override the one base we inherit directly.
    function _msgSender()
        internal
        view
        override /* (ERC2771Context) implicit */
        returns (address)
    {
        return super._msgSender();
    }

    function _msgData()
        internal
        view
        override /* (ERC2771Context) implicit */
        returns (bytes calldata)
    {
        return super._msgData();
    }
}
