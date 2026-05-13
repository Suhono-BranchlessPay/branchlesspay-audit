// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IAgentRegistry {
    struct AgentProfile {
        address wallet;
        string agentId;
        string country;
        string kycTier;
        uint256 registeredAt;
        uint256 lastActiveAt;
        bool isActive;
        uint256 totalTxCount;
        uint256 totalVolume;
    }

    event AgentRegistered(address indexed wallet, string agentId, string country);
    event AgentUpgraded(address indexed wallet, string oldTier, string newTier);
    event AgentDeactivated(address indexed wallet, string reason);
    event AgentActivityRecorded(address indexed wallet, uint256 txCount, uint256 volume);

    function registerAgent(address wallet, string calldata agentId, string calldata country, string calldata kycTier) external;
    function upgradeAgentTier(address wallet, string calldata newTier) external;
    function recordActivity(address wallet, uint256 volume) external;
    function deactivateAgent(address wallet, string calldata reason) external;
    function getAgent(address wallet) external view returns (AgentProfile memory);
    function isActiveAgent(address wallet) external view returns (bool);
    function getTotalAgents() external view returns (uint256);
}
