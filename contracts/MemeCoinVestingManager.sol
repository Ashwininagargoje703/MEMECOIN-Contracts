// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/* ────────────────── Dependencies ────────────────── */
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title MemeCoin Vesting Manager
/// @notice Handles token vesting for beneficiaries
contract MemeCoinVestingManager is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");

    struct Vesting {
        address token;
        uint256 total;
        uint256 claimed;
        uint256 start;
        uint256 cliff;
        uint256 duration;
    }

    mapping(address => Vesting[]) public vestingSchedules;

    error BadParams();
    error InsufficientBalance();
    error NothingToClaim();

    event VestingScheduleSet(
        address indexed beneficiary,
        address indexed token,
        uint256 total,
        uint256 start,
        uint256 cliff,
        uint256 duration
    );
    event VestedClaimed(
        address indexed beneficiary,
        address indexed token,
        uint256 amount
    );

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
    }

    function setVestingSchedule(
        address beneficiary,
        address token,
        uint256 total,
        uint256 cliff,
        uint256 duration
    ) external onlyRole(OPERATOR_ROLE) whenNotPaused {
        if (total == 0 || duration <= cliff) revert BadParams();
        if (IERC20(token).balanceOf(address(this)) < total)
            revert InsufficientBalance();

        vestingSchedules[beneficiary].push(
            Vesting({
                token: token,
                total: total,
                claimed: 0,
                start: block.timestamp,
                cliff: cliff,
                duration: duration
            })
        );
        emit VestingScheduleSet(
            beneficiary,
            token,
            total,
            block.timestamp,
            cliff,
            duration
        );
    }

    function claimVested() external whenNotPaused nonReentrant {
        Vesting[] storage vs = vestingSchedules[msg.sender];
        uint256 totalClaimed;
        for (uint i; i < vs.length; ++i) {
            Vesting storage v = vs[i];
            if (v.claimed < v.total) {
                uint256 elapsed = block.timestamp - v.start;
                uint256 vested = elapsed < v.cliff
                    ? 0
                    : elapsed >= v.duration
                        ? v.total
                        : (v.total * (elapsed - v.cliff)) /
                            (v.duration - v.cliff);
                uint256 claimable = vested - v.claimed;
                if (claimable > 0) {
                    v.claimed += claimable;
                    totalClaimed += claimable;
                    IERC20(v.token).safeTransfer(msg.sender, claimable);
                    emit VestedClaimed(msg.sender, v.token, claimable);
                }
            }
        }
        if (totalClaimed == 0) revert NothingToClaim();
    }

    function vestingScheduleCount(
        address beneficiary
    ) external view returns (uint256) {
        return vestingSchedules[beneficiary].length;
    }

    function getVestingSchedule(
        address beneficiary,
        uint256 index
    )
        external
        view
        returns (
            address token,
            uint256 total,
            uint256 claimed,
            uint256 start,
            uint256 cliff,
            uint256 duration
        )
    {
        Vesting storage v = vestingSchedules[beneficiary][index];
        return (v.token, v.total, v.claimed, v.start, v.cliff, v.duration);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }
    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function rescueERC20(
        address token,
        uint256 amount
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IERC20(token).safeTransfer(msg.sender, amount);
    }
    function emergencyWithdrawETH() external onlyRole(DEFAULT_ADMIN_ROLE) {
        payable(msg.sender).transfer(address(this).balance);
    }

    receive() external payable {
        revert();
    }
    fallback() external payable {
        revert();
    }
}
