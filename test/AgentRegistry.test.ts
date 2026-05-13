import { expect } from "chai";
import { ethers } from "hardhat";
import { AgentRegistry } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("AgentRegistry", function () {
  let registry: AgentRegistry;
  let admin: HardhatEthersSigner;
  let operator: HardhatEthersSigner;
  let oracle: HardhatEthersSigner;
  let agent: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));

  beforeEach(async function () {
    [admin, operator, oracle, agent, stranger] = await ethers.getSigners();

    const AgentRegistry = await ethers.getContractFactory("AgentRegistry");
    registry = await AgentRegistry.deploy();

    await registry.grantRole(OPERATOR_ROLE, operator.address);
    await registry.grantRole(ORACLE_ROLE, oracle.address);
  });

  describe("registerAgent", function () {
    it("should create agent profile correctly", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");

      const profile = await registry.getAgent(agent.address);
      expect(profile.wallet).to.equal(agent.address);
      expect(profile.agentId).to.equal("AGENT-001");
      expect(profile.country).to.equal("ID");
      expect(profile.kycTier).to.equal("BASIC");
      expect(profile.isActive).to.equal(true);
      expect(profile.totalTxCount).to.equal(0n);
      expect(profile.totalVolume).to.equal(0n);
    });

    it("should emit AgentRegistered event", async function () {
      await expect(
        registry.connect(operator).registerAgent(agent.address, "AGENT-001", "PK", "STANDARD")
      )
        .to.emit(registry, "AgentRegistered")
        .withArgs(agent.address, "AGENT-001", "PK");
    });

    it("should revert on duplicate wallet", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");
      await expect(
        registry.connect(operator).registerAgent(agent.address, "AGENT-002", "ID", "BASIC")
      ).to.be.revertedWith("AgentRegistry: already registered");
    });

    it("should revert if caller is not operator", async function () {
      await expect(
        registry.connect(stranger).registerAgent(agent.address, "AGENT-001", "ID", "BASIC")
      ).to.be.reverted;
    });
  });

  describe("upgradeAgentTier", function () {
    it("should update tier correctly", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");
      await registry.connect(operator).upgradeAgentTier(agent.address, "PREMIUM");

      const profile = await registry.getAgent(agent.address);
      expect(profile.kycTier).to.equal("PREMIUM");
    });
  });

  describe("recordActivity", function () {
    it("should accumulate tx count and volume", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");
      await registry.connect(oracle).recordActivity(agent.address, 100n);
      await registry.connect(oracle).recordActivity(agent.address, 200n);

      const profile = await registry.getAgent(agent.address);
      expect(profile.totalTxCount).to.equal(2n);
      expect(profile.totalVolume).to.equal(300n);
    });
  });

  describe("deactivateAgent", function () {
    it("should set isActive to false", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");
      await registry.connect(operator).deactivateAgent(agent.address, "KYC failed");

      expect(await registry.isActiveAgent(agent.address)).to.equal(false);
    });
  });
});
