// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/// @title Minimal WETH9 with full ERC-20 interface
contract WETH9 {
    string public  name     = "Wrapped Ether";
    string public  symbol   = "WETH";
    uint8  public  decimals = 18;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    event Approval(address indexed owner, address indexed spender, uint256 value);
    event Transfer(address indexed from, address indexed to, uint256 value);
    event Deposit(address indexed dst, uint256 wad);
    event Withdrawal(address indexed src, uint256 wad);

    /// @notice Deposit ETH and mint WETH
    function deposit() public payable {
        balanceOf[msg.sender] += msg.value;
        emit Deposit(msg.sender, msg.value);
    }

    /// @notice Withdraw WETH as ETH
    function withdraw(uint256 wad) public {
        require(balanceOf[msg.sender] >= wad, "WETH: insufficient balance");
        balanceOf[msg.sender] -= wad;
        payable(msg.sender).transfer(wad);
        emit Withdrawal(msg.sender, wad);
    }

    /// @notice Total supply equals ETH held
    function totalSupply() public view returns (uint256) {
        return address(this).balance;
    }

    /// @notice Approve `spender` to spend up to `wad`
    function approve(address spender, uint256 wad) public returns (bool) {
        allowance[msg.sender][spender] = wad;
        emit Approval(msg.sender, spender, wad);
        return true;
    }

    /// @notice Transfer `wad` tokens to `to`
    function transfer(address to, uint256 wad) public returns (bool) {
        return transferFrom(msg.sender, to, wad);
    }

    /// @notice Transfer `wad` tokens from `from` to `to`
    function transferFrom(address from, address to, uint256 wad) public returns (bool) {
        require(balanceOf[from] >= wad, "WETH: insufficient balance");
        if (from != msg.sender) {
            require(allowance[from][msg.sender] >= wad, "WETH: insufficient allowance");
            allowance[from][msg.sender] -= wad;
        }
        balanceOf[from] -= wad;
        balanceOf[to] += wad;
        emit Transfer(from, to, wad);
        return true;
    }

    receive() external payable {
        deposit();
    }
}
