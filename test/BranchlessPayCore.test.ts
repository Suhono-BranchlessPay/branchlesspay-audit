import { expect } from "chai";
import { ethers } from "hardhat";
import { BranchlessPayCore, MockUSDC } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const USDC_6 = (n: number) => BigInt(Math.round(n * 1_000_000));

describe("BranchlessPayCore", function () {
  let core: BranchlessPayCore;
  let usdc: MockUSDC;
  let admin: HardhatEthersSigner;
  let operator: HardhatEthersSigner;
  let oracle: HardhatEthersSigner;
  let agent: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));
  const COMPLIANCE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("COMPLIANCE_ROLE"));

  beforeEach(async function () {
    [admin, operator, oracle, agent, stranger] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const Core = await ethers.getContractFactory("BranchlessPayCore");
    core = await Core.deploy(await usdc.getAddress(), admin.address);

    await core.grantRole(OPERATOR_ROLE, operator.address);
    await core.grantRole(ORACLE_ROLE, oracle.address);
    await core.grantRole(COMPLIANCE_ROLE, oracle.address);

    await usdc.mint(operator.address, USDC_6(10000));
    await usdc.connect(operator).approve(await core.getAddress(), USDC_6(10000));
  });

  describe("topUp", function () {
    it("should top up agent balance successfully", async function () {
      await core.connect(operator).topUp(agent.address, USDC_6(100), "XENDIT_001", "ID");
      expect(await core.getBalance(agent.address)).to.equal(USDC_6(100));
    });

    it("should emit TopUp event", async function () {
      await expect(
        core.connect(operator).topUp(agent.address, USDC_6(50), "XENDIT_002", "PK")
      )
        .to.emit(core, "TopUp")
        .withArgs(agent.address, USDC_6(50), "XENDIT_002", "PK");
    });

    it("should revert if caller is not operator", async function () {
      await expect(
        core.connect(stranger).topUp(agent.address, USDC_6(100), "XENDIT_003", "ID")
      ).to.be.reverted;
    });
  });

  describe("settlePPOB", function () {
    beforeEach(async function () {
      await core.connect(operator).topUp(agent.address, USDC_6(100), "XENDIT_001", "ID");
    });

    it("should settle and deduct balance with commission", async function () {
      const balanceBefore = await core.getBalance(agent.address);
      await core.connect(oracle).settlePPOB(agent.address, USDC_6(10), "PULSA", "TELKOM-50K", "ID");
      const balanceAfter = await core.getBalance(agent.address);

      const commission = USDC_6(10) * 100n / 10000n;
      const expected = balanceBefore - USDC_6(10) + commission;
      expect(balanceAfter).to.equal(expected);
    });

    it("should revert if balance is insufficient", async function () {
      await expect(
        core.connect(oracle).settlePPOB(agent.address, USDC_6(200), "PULSA", "TELKOM-50K", "ID")
      ).to.be.revertedWith("BPC: insufficient balance");
    });

    it("should revert if caller is not oracle", async function () {
      await expect(
        core.connect(stranger).settlePPOB(agent.address, USDC_6(10), "PULSA", "TELKOM-50K", "ID")
      ).to.be.reverted;
    });

    it("should trigger circuit breaker after maxTxPerHour", async function () {
      await core.connect(admin).setCommissionRate("ID", 0);
      await usdc.mint(operator.address, USDC_6(1000000));
      await usdc.connect(operator).approve(await core.getAddress(), USDC_6(1000000));
      await core.connect(operator).topUp(agent.address, USDC_6(1000000), "XENDIT_BIG", "ID");

      let lastTx;
      for (let i = 0; i < 500; i++) {
        lastTx = await core.connect(oracle).settlePPOB(agent.address, 1n, "PULSA", `p${i}`, "ID");
      }
      await lastTx!.wait();

      await expect(
        core.connect(oracle).settlePPOB(agent.address, 1n, "PULSA", "pFinal", "ID")
      ).to.be.revertedWith("BPC: circuit breaker triggered");
    });
  });

  describe("updateTxStatus", function () {
    let txId: string;

    beforeEach(async function () {
      await core.connect(operator).topUp(agent.address, USDC_6(100), "XENDIT_001", "ID");
      const tx = await core.connect(oracle).settlePPOB(agent.address, USDC_6(10), "PLN", "PLN-100K", "ID");
      const receipt = await tx.wait();
      const iface = core.interface;
      for (const log of receipt!.logs) {
        try {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (parsed?.name === "PPOBSettled") {
            txId = parsed.args[0];
            break;
          }
        } catch {}
      }
    });

    it("should set status to SUCCESS", async function () {
      await core.connect(oracle).updateTxStatus(txId, true);
      const tx = await core.getTransaction(txId);
      expect(tx.status).to.equal(1n);
    });

    it("should refund balance on FAILED", async function () {
      const balanceBefore = await core.getBalance(agent.address);
      await core.connect(oracle).updateTxStatus(txId, false);
      const balanceAfter = await core.getBalance(agent.address);
      expect(balanceAfter).to.be.gt(balanceBefore);
    });
  });

  describe("emergencyPause", function () {
    it("should block topUp when paused", async function () {
      await core.connect(admin).emergencyPause();
      await expect(
        core.connect(operator).topUp(agent.address, USDC_6(100), "XENDIT_001", "ID")
      ).to.be.revertedWithCustomError(core, "EnforcedPause");
    });

    it("should allow topUp after unpause", async function () {
      await core.connect(admin).emergencyPause();
      await core.connect(admin).unpause();
      await expect(
        core.connect(operator).topUp(agent.address, USDC_6(100), "XENDIT_001", "ID")
      ).to.not.be.reverted;
    });
  });

  describe("executePPOB", function () {
    const idKey = () => ethers.keccak256(ethers.toUtf8Bytes("key-" + Date.now() + Math.random()));

    beforeEach(async function () {
      await core.connect(operator).topUp(agent.address, USDC_6(500), "XENDIT_001", "ID");
    });

    it("should execute and emit PPOBExecuted event", async function () {
      const key = idKey();
      await expect(
        core.connect(oracle).executePPOB(agent.address, USDC_6(10), "BASIC", "ID", "PULSA-50K", key)
      ).to.emit(core, "PPOBExecuted");
    });

    it("should debit balance with commission", async function () {
      const key = idKey();
      const before = await core.getBalance(agent.address);
      await core.connect(oracle).executePPOB(agent.address, USDC_6(10), "BASIC", "ID", "PULSA-50K", key);
      const after = await core.getBalance(agent.address);
      const commission = USDC_6(10) * 100n / 10000n;
      expect(after).to.equal(before - USDC_6(10) + commission);
    });

    it("should reject duplicate idempotency key", async function () {
      const key = idKey();
      await core.connect(oracle).executePPOB(agent.address, USDC_6(10), "BASIC", "ID", "P1", key);
      await expect(
        core.connect(oracle).executePPOB(agent.address, USDC_6(10), "BASIC", "ID", "P2", key)
      ).to.be.revertedWith("BPC: duplicate idempotency key");
    });

    it("should reject if balance insufficient", async function () {
      await expect(
        core.connect(oracle).executePPOB(agent.address, USDC_6(9999), "BASIC", "ID", "P1", idKey())
      ).to.be.revertedWith("BPC: insufficient balance");
    });

    it("should enforce country rules module when registered", async function () {
      const PK_Rules = await ethers.getContractFactory("PK_Rules");
      const pkRules = await PK_Rules.deploy();
      await core.connect(admin).setRulesModule("PK", await pkRules.getAddress());
      await usdc.mint(operator.address, USDC_6(200000));
      await usdc.connect(operator).approve(await core.getAddress(), USDC_6(200000));
      await core.connect(operator).topUp(agent.address, USDC_6(200000), "XENDIT_PK", "PK");

      await expect(
        core.connect(oracle).executePPOB(agent.address, USDC_6(200000), "BASIC", "PK", "TOPUP", idKey())
      ).to.be.revertedWith("BPC: amount exceeds country rules limit");
    });

    it("getActiveCountry should return country from rules module", async function () {
      const PK_Rules = await ethers.getContractFactory("PK_Rules");
      const pkRules = await PK_Rules.deploy();
      await core.connect(admin).setRulesModule("PK", await pkRules.getAddress());
      expect(await core.getActiveCountry("PK")).to.equal("PK");
      expect(await core.getActiveCountry("XX")).to.equal("");
    });

    it("flagForCompliance should emit ComplianceFlag", async function () {
      await expect(
        core.connect(oracle).flagForCompliance(agent.address, "suspicious activity")
      ).to.emit(core, "ComplianceFlag");
    });

    it("setCommissionRate should revert if over 10%", async function () {
      await expect(
        core.connect(admin).setCommissionRate("ID", 1001)
      ).to.be.revertedWith("BPC: rate too high (max 10%)");
    });
  });

  describe("commissionRates", function () {
    it("should calculate correct commission for each country", async function () {
      const countries = [
        { code: "ID", bps: 100n },
        { code: "PK", bps: 120n },
        { code: "NG", bps: 130n },
        { code: "BR", bps: 110n },
        { code: "KE", bps: 120n },
        { code: "EG", bps: 115n },
      ];

      for (const country of countries) {
        const rate = await core.commissionRates(country.code);
        expect(rate).to.equal(country.bps, `Mismatch for ${country.code}`);
      }
    });
  });
});
