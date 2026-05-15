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
  let agent2: HardhatEthersSigner;
  let stranger: HardhatEthersSigner;

  const OPERATOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("OPERATOR_ROLE"));
  const ORACLE_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORACLE_ROLE"));

  beforeEach(async function () {
    [admin, operator, oracle, agent, agent2, stranger] = await ethers.getSigners();

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

    it("should revert on zero address wallet", async function () {
      await expect(
        registry.connect(operator).registerAgent(ethers.ZeroAddress, "AGENT-003", "ID", "BASIC")
      ).to.be.revertedWith("AgentRegistry: invalid wallet");
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

    it("should emit AgentUpgraded event", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");
      await expect(
        registry.connect(operator).upgradeAgentTier(agent.address, "PREMIUM")
      ).to.emit(registry, "AgentUpgraded").withArgs(agent.address, "BASIC", "PREMIUM");
    });

    it("should revert for unregistered wallet", async function () {
      await expect(
        registry.connect(operator).upgradeAgentTier(stranger.address, "PREMIUM")
      ).to.be.revertedWith("AgentRegistry: not registered");
    });

    it("should revert if caller is not operator", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");
      await expect(
        registry.connect(stranger).upgradeAgentTier(agent.address, "PREMIUM")
      ).to.be.reverted;
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

    it("should emit AgentActivityRecorded event", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");
      await expect(
        registry.connect(oracle).recordActivity(agent.address, 500n)
      ).to.emit(registry, "AgentActivityRecorded").withArgs(agent.address, 1n, 500n);
    });

    it("should revert for unregistered wallet", async function () {
      await expect(
        registry.connect(oracle).recordActivity(stranger.address, 100n)
      ).to.be.revertedWith("AgentRegistry: not registered");
    });

    it("should revert if caller is not oracle", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");
      await expect(
        registry.connect(stranger).recordActivity(agent.address, 100n)
      ).to.be.reverted;
    });
  });

  describe("deactivateAgent", function () {
    it("should set isActive to false", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");
      await registry.connect(operator).deactivateAgent(agent.address, "KYC failed");

      expect(await registry.isActiveAgent(agent.address)).to.equal(false);
    });

    it("should emit AgentDeactivated event", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");
      await expect(
        registry.connect(operator).deactivateAgent(agent.address, "Fraud detected")
      ).to.emit(registry, "AgentDeactivated").withArgs(agent.address, "Fraud detected");
    });

    it("should revert for unregistered wallet", async function () {
      await expect(
        registry.connect(operator).deactivateAgent(stranger.address, "not registered")
      ).to.be.revertedWith("AgentRegistry: not registered");
    });

    it("should revert if caller is not operator", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");
      await expect(
        registry.connect(stranger).deactivateAgent(agent.address, "unauthorized")
      ).to.be.reverted;
    });
  });

  describe("getAgent", function () {
    it("should revert for unregistered wallet", async function () {
      await expect(
        registry.getAgent(stranger.address)
      ).to.be.revertedWith("AgentRegistry: not registered");
    });
  });

  describe("isActiveAgent", function () {
    it("should return false for unregistered wallet", async function () {
      expect(await registry.isActiveAgent(stranger.address)).to.equal(false);
    });

    it("should return true for registered active agent", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");
      expect(await registry.isActiveAgent(agent.address)).to.equal(true);
    });

    it("should return false after deactivation", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");
      await registry.connect(operator).deactivateAgent(agent.address, "test");
      expect(await registry.isActiveAgent(agent.address)).to.equal(false);
    });
  });

  describe("getTotalAgents", function () {
    it("should return 0 before any registration", async function () {
      expect(await registry.getTotalAgents()).to.equal(0n);
    });

    it("should increment after each registration", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");
      expect(await registry.getTotalAgents()).to.equal(1n);

      await registry.connect(operator).registerAgent(agent2.address, "AGENT-002", "PK", "STANDARD");
      expect(await registry.getTotalAgents()).to.equal(2n);
    });

    it("should not change after deactivation", async function () {
      await registry.connect(operator).registerAgent(agent.address, "AGENT-001", "ID", "BASIC");
      await registry.connect(operator).deactivateAgent(agent.address, "test");
      expect(await registry.getTotalAgents()).to.equal(1n);
    });
  });
});
