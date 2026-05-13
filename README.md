# BranchlessPay Smart Contract Audit — Code4rena Submission

## Protocol Overview

BranchlessPay is a multi-country PPOB (Payment Point Online Bank) settlement infrastructure built on Monad Testnet. It enables unbanked agent networks across emerging markets (Indonesia, Pakistan, Nigeria, Brazil, Kenya, Egypt) to settle digital payments (mobile airtime, electricity tokens, e-wallets) on-chain using USDC as collateral.

## Architecture

```
BranchlessPayCore (main)
 ├── MockUSDC          — ERC-20 test token (6 decimals)
 ├── AgentRegistry     — Agent KYC profile + lifecycle management
 ├── ComplianceReporter — AML/KYC reporting (OJK, SBP, PPATK)
 └── PK_Rules          — Pakistan country rules module (hot-swappable via IRules)
```

### Contract Addresses (Monad Testnet)

| Contract           | Address |
|--------------------|---------|
| BranchlessPayCore  | `0x4886CDd0B95Cb8a247C0F4c62329B8D4a43b3FE6` |
| MockUSDC           | `0x5B894D3A8eD4615800A7ec632ebC19C923c4DCba` |
| ComplianceReporter | `0xFa37524cD3a8ACdA2fD269Bcd598DFADc090adCB` |
| AgentRegistry      | `0xC593Aa879379D5EEE196E03Dea8c3BBCcC82481d` |

Explorer: https://testnet.monadvision.com
Contract Verified: Yes ✅ (Monad Testnet Explorer — MonadVision)
Verification URL: https://testnet.monadvision.com/address/0x4886CDd0B95Cb8a247C0F4c62329B8D4a43b3FE6

---

## Scope

### Files in Scope

| File | Lines | Description |
|------|-------|-------------|
| `contracts/BranchlessPayCore.sol` | 275 | Core settlement engine — PPOB execution, balances, commission |
| `contracts/AgentRegistry.sol` | 87 | Agent KYC profile registry |
| `contracts/ComplianceReporter.sol` | 101 | AML/regulatory report submission |
| `contracts/PK_Rules.sol` | 34 | Pakistan SBP/FIA/FBR rules module |
| `contracts/interfaces/IBranchlessPayCore.sol` | 51 | Core interface |
| `contracts/interfaces/IRules.sol` | 17 | Country rules module interface |
| `contracts/interfaces/IAgentRegistry.sol` | 29 | Registry interface |

### Files Out of Scope

- `contracts/MockUSDC.sol` — test token only, not deployed to production

---

## Key Design Patterns & Attack Surface

### 1. PPOB Execution — `executePPOB()` (4-step validation)
```
Step 1: Idempotency anti-replay  → keccak256(key) consumed flag
Step 2: Agent balance check       → agentBalance[agent] >= amount
Step 3: Country rules gate        → IRules.checkLimit(tier, amount)
Step 4: Circuit breaker           → max 500 tx/agent/hour
```

### 2. Hot-Swap Rules Modules
`setRulesModule(country, address)` lets DEFAULT_ADMIN replace country rules contracts at runtime. Each module implements `IRules` (checkLimit, getDailyLimit, country).

### 3. Commission Model
Commission = `(usdcAmount * commissionRates[country]) / 10_000`
The commission is **credited back to the agent** (not to treasury), serving as a rebate incentive.

### 4. Circuit Breaker
Per-agent rolling hourly window (3600s). State: `txCountThisHour[agent]` and `hourStart[agent]`. Resets on first tx after window expires.

### 5. Role System (OpenZeppelin AccessControl)
| Role | Capabilities |
|------|-------------|
| `DEFAULT_ADMIN_ROLE` | Grant/revoke roles, set commission rates, set rules modules, pause/unpause |
| `OPERATOR_ROLE` | topUp (fiat → on-chain) |
| `ORACLE_ROLE` | executePPOB, settlePPOB, updateTxStatus |
| `COMPLIANCE_ROLE` | flagForCompliance |
| `REPORTER_ROLE` (ComplianceReporter) | submitReport, updateKYC, fileSAR, blacklistAgent |

---

## Areas of Concern for Auditors

1. **Re-entrancy** — `executePPOB` and `settlePPOB` are `nonReentrant`. Verify this covers all USDC transfer paths.
2. **txId uniqueness** — txId uses `keccak256(agent, block.timestamp, block.prevrandao, productCode/providerId, idempotencyKey)`. Assess collision risk on Monad.
3. **Commission rebate logic** — commission is rebated to the agent, not the treasury. Intended or error?
4. **Circuit breaker reset** — window resets on ANY tx after 3600s including the one that triggers reset. Is first-tx-in-window intentionally uncounted?
5. **Legacy `settlePPOB`** — no idempotency key; txId derived from `block.prevrandao`. Assess uniqueness guarantees.
6. **Rules module trust** — `DEFAULT_ADMIN_ROLE` can point `rulesModules["XX"]` to any address. A malicious module could drain agent balances.
7. **Pause scope** — `emergencyPause` blocks `topUp`, `executePPOB`, and `settlePPOB`. `updateTxStatus` and compliance functions remain live while paused.

---

## Test Coverage

Measured with `solidity-coverage v0.8.17` — 33 test cases across 3 test suites.

| Contract | Stmts | Branch | Funcs | Lines |
|----------|-------|--------|-------|-------|
| **BranchlessPayCore.sol** | **100%** | **71.43%** | **100%** | **100%** |
| **AgentRegistry.sol** | **94.44%** | **60%** | **87.5%** | **96%** |
| **ComplianceReporter.sol** | **100%** | **50%** | **100%** | **100%** |
| PK_Rules.sol | 33.33% | 100% | 50% | 66.67% |
| MockUSDC.sol | 66.67% | 100% | 66.67% | 66.67% |
| **All in-scope** | **95.18%** | **67.35%** | **88.89%** | **96.69%** |

Branch coverage gaps: `ComplianceReporter` branch 50% (unhappy paths for role-gated functions only hit one side); `AgentRegistry` line 85 (`getTotalAgents` not called in tests).

**PK_Rules.sol (33% stmt):** Small country module — only `checkLimit()` happy path tested. `getDailyLimit()` and `getRegulators()` are pure view functions with no branching logic; their low coverage does not indicate untested business logic.

---

## Setup & Running Tests

### Prerequisites
- Node.js 18+
- pnpm

### Install
```bash
pnpm install
```

### Compile
```bash
npx hardhat compile
npx hardhat typechain
```

### Test
```bash
pnpm test
# or directly:
TS_NODE_TRANSPILE_ONLY=true NODE_OPTIONS='--require ts-node/register' \
  npx hardhat test test/BranchlessPayCore.test.ts test/AgentRegistry.test.ts test/ComplianceReporter.test.ts
```

### Coverage
```bash
pnpm coverage
# or directly:
TS_NODE_TRANSPILE_ONLY=true NODE_OPTIONS='--require ts-node/register' \
  npx hardhat coverage --testfiles 'test/*.test.ts'
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | Solidity ^0.8.24 |
| Network | Monad Testnet (chainId: 10143) |
| Token | USDC (ERC-20, 6 decimals) |
| Libraries | OpenZeppelin Contracts v5 (AccessControl, ReentrancyGuard, Pausable) |
| Dev Framework | Hardhat 2.x |
| Optimizer | enabled, 200 runs, viaIR: true |

---

## Known Limitations / Non-Issues

- `MockUSDC.mint()` is unrestricted — **by design** (testnet only, not in prod scope).
- `PK_Rules.getDailyLimit` and `getRegulators` are read-only helpers with no access control — intentional.
- `block.prevrandao` is used for txId entropy on Monad (post-merge). Monad's consensus may differ from Ethereum; auditors should assess entropy guarantees.

---

*BranchlessPay LLC, Delaware USA | PT Antar Cepat Abadi, Indonesia*
*Audit prepared: 2026-05-13*
