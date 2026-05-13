// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IBranchlessPayCore.sol";
import "./interfaces/IRules.sol";

contract BranchlessPayCore is IBranchlessPayCore, AccessControl, ReentrancyGuard, Pausable {
    bytes32 public constant OPERATOR_ROLE   = keccak256("OPERATOR_ROLE");
    bytes32 public constant ORACLE_ROLE     = keccak256("ORACLE_ROLE");
    bytes32 public constant COMPLIANCE_ROLE = keccak256("COMPLIANCE_ROLE");

    /// @notice USDC token contract (ERC-20, 6 decimals).
    IERC20 public immutable USDC;
    address public treasury;

    // ── State ─────────────────────────────────────────────────────────────────
    /// @notice Agent USDC balances (6-decimal units).
    mapping(address  => uint256)      public agentBalance;
    mapping(bytes32  => Transaction)  public transactions;
    mapping(string   => uint256)      public commissionRates;
    mapping(address  => uint256)      public txCountThisHour;
    mapping(address  => uint256)      public hourStart;
    /// @notice country code (ISO-3166) → deployed IRules module address.
    mapping(string   => address)      public rulesModules;
    /// @notice Idempotency anti-replay: keccak256(key) → consumed.
    mapping(bytes32  => bool)         public usedKeys;

    uint256 public maxTxPerHour = 500;

    struct Transaction {
        address  agent;
        uint256  amount;
        string   productType;
        string   providerId;
        uint256  timestamp;
        TxStatus status;
        string   country;
    }

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(address usdc, address _treasury) {
        USDC     = IERC20(usdc);
        treasury = _treasury;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(OPERATOR_ROLE,      msg.sender);
        _grantRole(ORACLE_ROLE,        msg.sender);
        _grantRole(COMPLIANCE_ROLE,    msg.sender);

        commissionRates["ID"] = 100;   // 1.00 %
        commissionRates["PK"] = 120;   // 1.20 %
        commissionRates["NG"] = 130;   // 1.30 %
        commissionRates["BR"] = 110;   // 1.10 %
        commissionRates["KE"] = 120;   // 1.20 %
        commissionRates["EG"] = 115;   // 1.15 %
    }

    // ── Deposit ───────────────────────────────────────────────────────────────
    /// @notice Operator deposits USDC on behalf of an agent (fiat top-up flow).
    function topUp(
        address agent,
        uint256 usdcAmount,
        string calldata fiatRef,
        string calldata country
    ) external override onlyRole(OPERATOR_ROLE) whenNotPaused {
        require(agent != address(0), "BPC: invalid agent");
        require(usdcAmount > 0,      "BPC: amount must be > 0");

        bool ok = USDC.transferFrom(msg.sender, address(this), usdcAmount);
        require(ok, "BPC: USDC transfer failed");

        agentBalance[agent] += usdcAmount;
        emit TopUp(agent, usdcAmount, fiatRef, country);
    }

    // ── Execute PPOB (4-step validation) ──────────────────────────────────────
    /// @notice Input struct used by executePPOB to avoid stack-too-deep.
    struct PPOBRequest {
        address agent;
        uint256 usdcAmount;
        string  tier;
        string  country;
        string  productCode;
        bytes32 idempotencyKey;
    }

    /// @notice Full PPOB execution path:
    ///   1. Idempotency anti-replay  — reject duplicate keys on-chain
    ///   2. Balance check            — agent must hold ≥ usdcAmount
    ///   3. Rules module gate        — call IRules.checkLimit if a module is registered
    ///   4. Circuit breaker          — cap txs per agent per hour
    function executePPOB(
        address         agent,
        uint256         usdcAmount,
        string calldata tier,
        string calldata country,
        string calldata productCode,
        bytes32         idempotencyKey
    ) external override onlyRole(ORACLE_ROLE) whenNotPaused nonReentrant returns (bytes32 txId) {
        PPOBRequest memory req = PPOBRequest({
            agent:          agent,
            usdcAmount:     usdcAmount,
            tier:           tier,
            country:        country,
            productCode:    productCode,
            idempotencyKey: idempotencyKey
        });
        return _executePPOB(req);
    }

    function _executePPOB(PPOBRequest memory req) internal returns (bytes32 txId) {
        // Step 1 — idempotency anti-replay
        require(!usedKeys[req.idempotencyKey], "BPC: duplicate idempotency key");
        usedKeys[req.idempotencyKey] = true;

        // Step 2 — sufficient agent balance
        require(agentBalance[req.agent] >= req.usdcAmount, "BPC: insufficient balance");

        // Step 3 — country rules module (if registered)
        address module = rulesModules[req.country];
        if (module != address(0)) {
            require(
                IRules(module).checkLimit(req.tier, req.usdcAmount),
                "BPC: amount exceeds country rules limit"
            );
        }

        // Step 4 — circuit breaker
        require(_checkCircuitBreaker(req.agent), "BPC: circuit breaker triggered");

        // ── Debit & commission ──────────────────────────────────────────────
        txId = keccak256(abi.encodePacked(
            req.agent, block.timestamp, block.prevrandao, req.productCode, req.idempotencyKey
        ));

        agentBalance[req.agent] -= req.usdcAmount;

        if (commissionRates[req.country] > 0) {
            uint256 commission = (req.usdcAmount * commissionRates[req.country]) / 10_000;
            agentBalance[req.agent] += commission;
            emit CommissionPaid(req.agent, commission);
        }

        transactions[txId] = Transaction({
            agent:       req.agent,
            amount:      req.usdcAmount,
            productType: req.productCode,
            providerId:  req.tier,
            timestamp:   block.timestamp,
            status:      TxStatus.PENDING,
            country:     req.country
        });

        emit PPOBExecuted(txId, req.agent, req.country, req.tier, req.usdcAmount, req.idempotencyKey);
    }

    // ── Legacy oracle settlement ───────────────────────────────────────────────
    /// @notice Kept for backward compatibility with existing oracle integrations.
    function settlePPOB(
        address agent,
        uint256 usdcAmount,
        string calldata productType,
        string calldata providerId,
        string calldata country
    ) external override onlyRole(ORACLE_ROLE) whenNotPaused nonReentrant returns (bytes32 txId) {
        require(agentBalance[agent] >= usdcAmount, "BPC: insufficient balance");
        require(_checkCircuitBreaker(agent), "BPC: circuit breaker triggered");

        txId = keccak256(abi.encodePacked(agent, block.timestamp, block.prevrandao, providerId));

        agentBalance[agent] -= usdcAmount;

        if (commissionRates[country] > 0) {
            uint256 commission = (usdcAmount * commissionRates[country]) / 10_000;
            agentBalance[agent] += commission;
            emit CommissionPaid(agent, commission);
        }

        transactions[txId] = Transaction({
            agent:       agent,
            amount:      usdcAmount,
            productType: productType,
            providerId:  providerId,
            timestamp:   block.timestamp,
            status:      TxStatus.PENDING,
            country:     country
        });

        emit PPOBSettled(txId, agent, productType, usdcAmount, false);
    }

    function updateTxStatus(bytes32 txId, bool success) external override onlyRole(ORACLE_ROLE) {
        Transaction storage tx_ = transactions[txId];
        require(tx_.agent != address(0), "BPC: transaction not found");
        require(tx_.status == TxStatus.PENDING, "BPC: already finalized");

        tx_.status = success ? TxStatus.SUCCESS : TxStatus.FAILED;
        if (!success) agentBalance[tx_.agent] += tx_.amount;

        emit PPOBSettled(txId, tx_.agent, tx_.productType, tx_.amount, success);
    }

    // ── Hot-swap rules module ─────────────────────────────────────────────────
    /// @notice Register or replace the rules module for a country.
    ///         Only DEFAULT_ADMIN_ROLE can call this.
    function setRulesModule(string memory country, address moduleAddress)
        external override onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(moduleAddress != address(0), "BPC: invalid module address");
        rulesModules[country] = moduleAddress;
        emit RulesModuleUpdated(country, moduleAddress);
    }

    /// @notice Returns the country() value reported by the active rules module.
    ///         Returns "" if no module is registered for `country`.
    function getActiveCountry(string calldata country)
        external view override returns (string memory)
    {
        address module = rulesModules[country];
        if (module == address(0)) return "";
        return IRules(module).country();
    }

    // ── Circuit breaker (internal) ────────────────────────────────────────────
    function _checkCircuitBreaker(address agent) internal returns (bool) {
        if (block.timestamp > hourStart[agent] + 3600) {
            hourStart[agent]       = block.timestamp;
            txCountThisHour[agent] = 0;
        }
        txCountThisHour[agent]++;
        if (txCountThisHour[agent] > maxTxPerHour) {
            emit CircuitBreakerTriggered(agent, "exceeded max tx per hour");
            return false;
        }
        return true;
    }

    // ── Compliance ────────────────────────────────────────────────────────────
    function flagForCompliance(address agent, string calldata reason)
        external override onlyRole(COMPLIANCE_ROLE)
    {
        emit ComplianceFlag(agent, reason, block.timestamp);
    }

    // ── Emergency stop (OpenZeppelin Pausable) ────────────────────────────────
    function emergencyPause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
        emit SystemPaused(msg.sender);
    }

    function unpause() external override onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
        emit SystemUnpaused(msg.sender);
    }

    // ── Views ─────────────────────────────────────────────────────────────────
    function getBalance(address agent) external view override returns (uint256) {
        return agentBalance[agent];
    }

    function setCommissionRate(string calldata country, uint256 basisPoints)
        external override onlyRole(DEFAULT_ADMIN_ROLE)
    {
        require(basisPoints <= 1000, "BPC: rate too high (max 10%)");
        commissionRates[country] = basisPoints;
    }

    function getTransaction(bytes32 txId) external view returns (Transaction memory) {
        return transactions[txId];
    }
}
