// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Minimal interface every country rules module must implement.
/// PK_Rules, ID_Rules, NG_Rules … all implement this so BranchlessPayCore
/// can hot-swap them at runtime via setRulesModule().
interface IRules {
    /// @return ISO-3166 alpha-2 country code this module governs (e.g. "PK")
    function country() external view returns (string memory);

    /// @notice Returns true when `amount` (USDC 6-decimal) is within the
    ///         daily limit for `tier` ("BASIC" | "STANDARD" | "PREMIUM").
    function checkLimit(string calldata tier, uint256 amount) external view returns (bool);

    /// @return The raw daily cap (USDC 6-decimal) for a given tier.
    function getDailyLimit(string calldata tier) external view returns (uint256);
}
