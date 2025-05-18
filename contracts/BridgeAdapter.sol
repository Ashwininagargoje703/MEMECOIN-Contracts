// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./IAxelarGasService.sol";
import "./IAxelarGateway.sol";

contract BridgeAdapter {
    IAxelarGasService public immutable gasService;
    IAxelarGateway   public immutable gateway;

    constructor(address _gasService, address _gateway) {
        gasService = IAxelarGasService(_gasService);
        gateway    = IAxelarGateway(_gateway);
    }

    function forwardWithToken(
        string calldata destinationChain,
        string calldata destinationAddress,
        bytes  calldata payload,
        string calldata symbol,
        uint256 amount
    ) external payable {
        // 1) Pay gas
        gasService.payNativeGasForContractCallWithToken{value: msg.value}(
            address(this),           // sender
            destinationChain,
            destinationAddress,
            payload,
            symbol,
            amount,
            msg.sender               // refund
        );

        // 2) Forward the call + tokens
        gateway.callContractWithToken(
            destinationChain,
            destinationAddress,
            payload,
            symbol,
            amount
        );
    }
}
