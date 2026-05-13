// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IBranchlessPayCore {
    enum TxStatus { PENDING, SUCCESS, FAILED, REFUNDED }

    // ── Events ────────────────────────────────────────────────────────────────
    event TopUp(address indexed agent, uint256 usdcAmount, string fiatRef, string country);
    event PPOBSettled(bytes32 indexed txId, address indexed agent, string productType, uint256 amount, bool success);
    /// @dev Emitted by the new executePPOB path (4-step validation).
    event PPOBExecuted(bytes32 indexed txId, address indexed agent, string country, string tier, uint256 amount, bytes32 idempotencyKey);
    event CommissionPaid(address indexed agent, uint256 amount);
    event CircuitBreakerTriggered(address indexed agent, string reason);
    event ComplianceFlag(address indexed agent, string reason, uint256 timestamp);
    event SystemPaused(address by);
    event SystemUnpaused(address by);
    event RulesModuleUpdated(string indexed country, address indexed moduleAddress);

    // ── Deposit ───────────────────────────────────────────────────────────────
    function topUp(address agent, uint256 usdcAmount, string calldata fiatRef, string calldata country) external;

    // ── PPOB settlement ───────────────────────────────────────────────────────
    /// @notice Full 4-step PPOB execution: idempotency → balance → rules → circuit-breaker.
    function executePPOB(
        address agent,
        uint256 usdcAmount,
        string  calldata tier,
        string  calldata country,
        string  calldata productCode,
        bytes32 idempotencyKey
    ) external returns (bytes32 txId);

    /// @notice Legacy oracle-driven settlement (kept for backward compatibility).
    function settlePPOB(address agent, uint256 usdcAmount, string calldata productType, string calldata providerId, string calldata country) external returns (bytes32 txId);

    function updateTxStatus(bytes32 txId, bool success) external;

    // ── Compliance / admin ────────────────────────────────────────────────────
    function flagForCompliance(address agent, string calldata reason) external;
    function emergencyPause() external;
    function unpause() external;

    // ── Views ─────────────────────────────────────────────────────────────────
    function getBalance(address agent) external view returns (uint256);
    function setCommissionRate(string calldata country, uint256 basisPoints) external;
    function setRulesModule(string memory country, address moduleAddress) external;

    /// @notice Returns the country() value of the active rules module for `country`.
    ///         Returns "" if no module is registered.
    function getActiveCountry(string calldata country) external view returns (string memory);
}
