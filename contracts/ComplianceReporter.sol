// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract ComplianceReporter is AccessControl {
    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");

    enum KYCStatus { NONE, PENDING, VERIFIED, SUSPENDED, REJECTED }

    struct ComplianceReport {
        string reportType;
        string country;
        string regulator;
        bytes32 dataHash;
        uint256 periodStart;
        uint256 periodEnd;
        uint256 submittedAt;
        address submittedBy;
    }

    mapping(uint256 => ComplianceReport) public reports;
    uint256 public reportCount;

    mapping(address => KYCStatus) public kycStatus;
    mapping(address => string) public kycTier;
    mapping(address => bool) public blacklist;

    event ReportSubmitted(
        uint256 indexed reportId,
        string reportType,
        string country,
        string regulator,
        bytes32 dataHash
    );
    event KYCUpdated(address indexed agent, KYCStatus status, string tier);
    event SARFiled(address indexed agent, string reason, uint256 timestamp);
    event AgentBlacklisted(address indexed agent, string reason);

    constructor() {
        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(REPORTER_ROLE, msg.sender);
    }

    function submitReport(
        string calldata reportType,
        string calldata country,
        string calldata regulator,
        bytes32 dataHash,
        uint256 periodStart,
        uint256 periodEnd
    ) external onlyRole(REPORTER_ROLE) returns (uint256 reportId) {
        reportId = reportCount++;

        reports[reportId] = ComplianceReport({
            reportType: reportType,
            country: country,
            regulator: regulator,
            dataHash: dataHash,
            periodStart: periodStart,
            submittedAt: block.timestamp,
            periodEnd: periodEnd,
            submittedBy: msg.sender
        });

        emit ReportSubmitted(reportId, reportType, country, regulator, dataHash);

        return reportId;
    }

    function updateKYC(
        address agent,
        KYCStatus status,
        string calldata tier
    ) external onlyRole(REPORTER_ROLE) {
        kycStatus[agent] = status;
        kycTier[agent] = tier;
        emit KYCUpdated(agent, status, tier);
    }

    function fileSAR(address agent, string calldata reason) external onlyRole(REPORTER_ROLE) {
        emit SARFiled(agent, reason, block.timestamp);
    }

    function blacklistAgent(address agent, string calldata reason) external onlyRole(REPORTER_ROLE) {
        blacklist[agent] = true;
        emit AgentBlacklisted(agent, reason);
    }

    function getAgentCompliance(address agent)
        external
        view
        returns (
            KYCStatus status,
            string memory tier,
            bool isBlacklisted
        )
    {
        return (kycStatus[agent], kycTier[agent], blacklist[agent]);
    }
}
