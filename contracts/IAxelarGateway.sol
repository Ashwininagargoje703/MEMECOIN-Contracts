// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface IAxelarGateway {
    function callContractWithToken(
        string calldata destinationChain,
        string calldata destinationAddress,
        bytes calldata payload,
        string calldata symbol,
        uint256 amount
    ) external;
}
