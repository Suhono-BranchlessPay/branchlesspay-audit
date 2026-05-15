import { expect } from "chai";
import { ethers } from "hardhat";
import { ComplianceReporter } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("ComplianceReporter", function () {
  let compliance: ComplianceReporter;
  let admin: HardhatEthersSigner;
  let reporter: HardhatEthersSigner;
  let agent: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  const REPORTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("REPORTER_ROLE"));

  beforeEach(async function () {
    [admin, reporter, agent, stranger] = await ethers.getSigners();

    const ComplianceReporter = await ethers.getContractFactory("ComplianceReporter");
    compliance = await ComplianceReporter.deploy();

    await compliance.grantRole(REPORTER_ROLE, reporter.address);
  });

  const sampleHash = () => ethers.keccak256(ethers.toUtf8Bytes("report_data_" + Date.now()));

  describe("submitReport", function () {
    it("should store hash correctly and return reportId", async function () {
      const dataHash = sampleHash();
      const now = Math.floor(Date.now() / 1000);

      const tx = await compliance.connect(reporter).submitReport(
        "DAILY_TX", "ID", "OJK", dataHash, now - 86400, now
      );
      const receipt = await tx.wait();

      expect(receipt?.status).to.equal(1);
      expect(await compliance.reportCount()).to.equal(1n);

      const report = await compliance.reports(0n);
      expect(report.dataHash).to.equal(dataHash);
      expect(report.reportType).to.equal("DAILY_TX");
    });

    it("should emit ReportSubmitted event", async function () {
      const dataHash = sampleHash();
      const now = Math.floor(Date.now() / 1000);

      await expect(
        compliance.connect(reporter).submitReport("SAR", "PK", "SBP", dataHash, now - 86400, now)
      ).to.emit(compliance, "ReportSubmitted");
    });

    it("should assign sequential reportIds", async function () {
      const now = Math.floor(Date.now() / 1000);
      await compliance.connect(reporter).submitReport("DAILY_TX", "ID", "OJK", sampleHash(), now - 86400, now);
      await compliance.connect(reporter).submitReport("MONTHLY", "PK", "SBP", sampleHash(), now - 2592000, now);
      expect(await compliance.reportCount()).to.equal(2n);

      const r0 = await compliance.reports(0n);
      const r1 = await compliance.reports(1n);
      expect(r0.reportType).to.equal("DAILY_TX");
      expect(r1.reportType).to.equal("MONTHLY");
    });

    it("should revert if caller does not have REPORTER_ROLE", async function () {
      const now = Math.floor(Date.now() / 1000);
      await expect(
        compliance.connect(stranger).submitReport("DAILY_TX", "ID", "OJK", sampleHash(), now - 86400, now)
      ).to.be.reverted;
    });
  });

  describe("updateKYC", function () {
    it("should update status and tier correctly", async function () {
      await compliance.connect(reporter).updateKYC(agent.address, 2, "STANDARD");

      const [status, tier] = await compliance.getAgentCompliance(agent.address);
      expect(status).to.equal(2n);
      expect(tier).to.equal("STANDARD");
    });

    it("should emit KYCUpdated event", async function () {
      await expect(
        compliance.connect(reporter).updateKYC(agent.address, 2, "STANDARD")
      ).to.emit(compliance, "KYCUpdated").withArgs(agent.address, 2n, "STANDARD");
    });

    it("should update all KYCStatus enum values", async function () {
      for (let status = 0; status <= 4; status++) {
        await compliance.connect(reporter).updateKYC(agent.address, status, "BASIC");
        const [s] = await compliance.getAgentCompliance(agent.address);
        expect(s).to.equal(BigInt(status));
      }
    });

    it("should revert if caller does not have REPORTER_ROLE", async function () {
      await expect(
        compliance.connect(stranger).updateKYC(agent.address, 2, "STANDARD")
      ).to.be.reverted;
    });
  });

  describe("fileSAR", function () {
    it("should emit SARFiled event with correct data", async function () {
      const tx = await compliance.connect(reporter).fileSAR(agent.address, "Suspicious activity detected");
      const receipt = await tx.wait();
      const block = await ethers.provider.getBlock(receipt!.blockNumber);
      await expect(tx)
        .to.emit(compliance, "SARFiled")
        .withArgs(agent.address, "Suspicious activity detected", block!.timestamp);
    });

    it("should revert if caller does not have REPORTER_ROLE", async function () {
      await expect(
        compliance.connect(stranger).fileSAR(agent.address, "reason")
      ).to.be.reverted;
    });
  });

  describe("blacklistAgent", function () {
    it("should update blacklist mapping", async function () {
      await compliance.connect(reporter).blacklistAgent(agent.address, "Fraud detected");

      const [, , isBlacklisted] = await compliance.getAgentCompliance(agent.address);
      expect(isBlacklisted).to.equal(true);
    });

    it("should emit AgentBlacklisted event", async function () {
      await expect(
        compliance.connect(reporter).blacklistAgent(agent.address, "AML violation")
      ).to.emit(compliance, "AgentBlacklisted").withArgs(agent.address, "AML violation");
    });

    it("should revert if caller does not have REPORTER_ROLE", async function () {
      await expect(
        compliance.connect(stranger).blacklistAgent(agent.address, "unauthorized")
      ).to.be.reverted;
    });
  });

  describe("getAgentCompliance", function () {
    it("should return defaults for unknown agent", async function () {
      const [status, tier, isBlacklisted] = await compliance.getAgentCompliance(stranger.address);
      expect(status).to.equal(0n);
      expect(tier).to.equal("");
      expect(isBlacklisted).to.equal(false);
    });
  });
});
