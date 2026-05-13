// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IRules.sol";

/// @notice Pakistan KYC/AML rules module — governs by SBP, FIA, and FBR.
///         Implements IRules so BranchlessPayCore can hot-swap it at runtime.
contract PK_Rules is IRules {
    string public country = "PK";

    mapping(string => uint256) public dailyLimits;

    constructor() {
        dailyLimits["BASIC"]    =  25_000 * 1e6;  // PKR 25,000  in USDC 6-decimals
        dailyLimits["STANDARD"] = 100_000 * 1e6;  // PKR 100,000
        dailyLimits["PREMIUM"]  = 150_000 * 1e6;  // PKR 150,000
    }

    function checkLimit(string calldata tier, uint256 amount)
        external view override returns (bool)
    {
        return amount <= dailyLimits[tier];
    }

    function getDailyLimit(string calldata tier)
        external view override returns (uint256)
    {
        return dailyLimits[tier];
    }

    function getRegulators() external pure returns (string memory) {
        return "SBP,FIA,FBR";
    }
}
