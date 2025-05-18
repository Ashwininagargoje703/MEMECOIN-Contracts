// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockGateway {
    // match the interface so BridgeAdapter compiles
    function callContractWithToken(
        string calldata, string calldata, bytes calldata, string calldata, uint256
    ) external {
        // noop
    }
}
