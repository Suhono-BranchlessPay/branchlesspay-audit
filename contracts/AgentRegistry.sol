// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IAgentRegistry.sol";

contract AgentRegistry is IAgentRegistry, AccessControl {
    bytes32 public constant OPERATOR_ROLE = keccak256("OPERATOR_ROLE");
    bytes32 public constant ORACLE_ROLE = keccak256("ORACLE_ROLE");

    mapping(address => AgentProfile) private _agents;
    address[] private _agentList;
    mapping(address => bool) private _registered;

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE, msg.sender);
        _grantRole(ORACLE_ROLE, msg.sender);
    }

    function registerAgent(
        address wallet,
        string calldata agentId,
        string calldata country,
        string calldata kycTier
    ) external override onlyRole(OPERATOR_ROLE) {
        require(!_registered[wallet], "AgentRegistry: already registered");
        require(wallet != address(0), "AgentRegistry: invalid wallet");

        _agents[wallet] = AgentProfile({
            wallet: wallet,
            agentId: agentId,
            country: country,
            kycTier: kycTier,
            registeredAt: block.timestamp,
            lastActiveAt: block.timestamp,
            isActive: true,
            totalTxCount: 0,
            totalVolume: 0
        });

        _registered[wallet] = true;
        _agentList.push(wallet);

        emit AgentRegistered(wallet, agentId, country);
    }

    function upgradeAgentTier(address wallet, string calldata newTier) external override onlyRole(OPERATOR_ROLE) {
        require(_registered[wallet], "AgentRegistry: not registered");

        string memory oldTier = _agents[wallet].kycTier;
        _agents[wallet].kycTier = newTier;

        emit AgentUpgraded(wallet, oldTier, newTier);
    }

    function recordActivity(address wallet, uint256 volume) external override onlyRole(ORACLE_ROLE) {
        require(_registered[wallet], "AgentRegistry: not registered");

        _agents[wallet].totalTxCount++;
        _agents[wallet].totalVolume += volume;
        _agents[wallet].lastActiveAt = block.timestamp;

        emit AgentActivityRecorded(wallet, _agents[wallet].totalTxCount, _agents[wallet].totalVolume);
    }

    function deactivateAgent(address wallet, string calldata reason) external override onlyRole(OPERATOR_ROLE) {
        require(_registered[wallet], "AgentRegistry: not registered");

        _agents[wallet].isActive = false;

        emit AgentDeactivated(wallet, reason);
    }

    function getAgent(address wallet) external view override returns (AgentProfile memory) {
        require(_registered[wallet], "AgentRegistry: not registered");
        return _agents[wallet];
    }

    function isActiveAgent(address wallet) external view override returns (bool) {
        return _registered[wallet] && _agents[wallet].isActive;
    }

    function getTotalAgents() external view override returns (uint256) {
        return _agentList.length;
    }
}
