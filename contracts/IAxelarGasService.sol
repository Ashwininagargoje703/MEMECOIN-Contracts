// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAxelarGasService {
    function payNativeGasForContractCallWithToken(
        address sender,
        string calldata destinationChain,
        string calldata destinationAddress,
        bytes calldata payload,
        string calldata symbol,
        uint256 amount,
        address refundAddress
    ) external payable;
}
