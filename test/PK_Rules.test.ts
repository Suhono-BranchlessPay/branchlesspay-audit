import { expect } from "chai";
import { ethers } from "hardhat";
import { PK_Rules } from "../typechain-types";

describe("PK_Rules", function () {
  let pkRules: PK_Rules;

  const BASIC_LIMIT    = 25_000n  * 1_000_000n;
  const STANDARD_LIMIT = 100_000n * 1_000_000n;
  const PREMIUM_LIMIT  = 150_000n * 1_000_000n;

  beforeEach(async function () {
    const PK_Rules = await ethers.getContractFactory("PK_Rules");
    pkRules = await PK_Rules.deploy();
  });

  describe("country", function () {
    it("should return PK", async function () {
      expect(await pkRules.country()).to.equal("PK");
    });
  });

  describe("getRegulators", function () {
    it("should return SBP,FIA,FBR", async function () {
      expect(await pkRules.getRegulators()).to.equal("SBP,FIA,FBR");
    });
  });

  describe("getDailyLimit", function () {
    it("should return 25,000 USDC for BASIC tier", async function () {
      expect(await pkRules.getDailyLimit("BASIC")).to.equal(BASIC_LIMIT);
    });

    it("should return 100,000 USDC for STANDARD tier", async function () {
      expect(await pkRules.getDailyLimit("STANDARD")).to.equal(STANDARD_LIMIT);
    });

    it("should return 150,000 USDC for PREMIUM tier", async function () {
      expect(await pkRules.getDailyLimit("PREMIUM")).to.equal(PREMIUM_LIMIT);
    });

    it("should return 0 for unknown tier", async function () {
      expect(await pkRules.getDailyLimit("UNKNOWN")).to.equal(0n);
    });
  });

  describe("checkLimit", function () {
    it("should return true when amount is within BASIC limit", async function () {
      expect(await pkRules.checkLimit("BASIC", BASIC_LIMIT)).to.equal(true);
    });

    it("should return false when amount exceeds BASIC limit", async function () {
      expect(await pkRules.checkLimit("BASIC", BASIC_LIMIT + 1n)).to.equal(false);
    });

    it("should return true when amount is within STANDARD limit", async function () {
      expect(await pkRules.checkLimit("STANDARD", STANDARD_LIMIT)).to.equal(true);
    });

    it("should return false when amount exceeds STANDARD limit", async function () {
      expect(await pkRules.checkLimit("STANDARD", STANDARD_LIMIT + 1n)).to.equal(false);
    });

    it("should return true when amount is within PREMIUM limit", async function () {
      expect(await pkRules.checkLimit("PREMIUM", PREMIUM_LIMIT)).to.equal(true);
    });

    it("should return false when amount exceeds PREMIUM limit", async function () {
      expect(await pkRules.checkLimit("PREMIUM", PREMIUM_LIMIT + 1n)).to.equal(false);
    });

    it("should return false for unknown tier with non-zero amount", async function () {
      expect(await pkRules.checkLimit("UNKNOWN", 1n)).to.equal(false);
    });

    it("should return true for unknown tier with zero amount", async function () {
      expect(await pkRules.checkLimit("UNKNOWN", 0n)).to.equal(true);
    });
  });
});
