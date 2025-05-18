// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MockGasService {
    // match the interface so BridgeAdapter compiles
    function payNativeGasForContractCallWithToken(
        address, string calldata, string calldata, bytes calldata, string calldata, uint256, address
    ) external payable {
        // noop
    }
}
