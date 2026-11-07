const { expect } = require("chai");
const { ethers } = require("hardhat");
const h = (s) => ethers.sha256(ethers.toUtf8Bytes(s));

describe("ModelRegistry", () => {
  let reg, owner, other, id;
  beforeEach(async () => {
    [owner, other] = await ethers.getSigners();
    reg = await (await ethers.getContractFactory("ModelRegistry")).deploy();
    await reg.registerModel("VoiceNet", "1.0.0", h("a1"), h("m1"), "cid1");
    id = await reg.computeModelId(owner.address, "VoiceNet");
  });

  it("registers a model with first version and emits events", async () => {
    const m = await reg.getModel(id);
    expect(m.owner).to.equal(owner.address);
    expect(m.versionCount).to.equal(1n);
    expect(await reg.modelCount()).to.equal(1n);
    const v = await reg.getVersion(id, 1);
    expect(v.parent).to.equal(0n);
    expect(v.artifactHash).to.equal(h("a1"));
    await expect(reg.registerModel("Other", "1", h("a"), h("m"), "c")).to.emit(reg, "ModelRegistered");
  });

  it("rejects duplicate model (same owner+name); other owner may reuse the name", async () => {
    await expect(reg.registerModel("VoiceNet", "9", h("x"), h("y"), "c")).to.be.revertedWithCustomError(reg, "ModelAlreadyExists");
    await reg.connect(other).registerModel("VoiceNet", "1.0.0", h("x"), h("y"), "c");
    expect(await reg.modelCount()).to.equal(2n);
  });

  it("registers versions referencing predecessor; history preserved", async () => {
    await expect(reg.registerVersion(id, 1, "1.1.0", h("a2"), h("m2"), "cid2")).to.emit(reg, "VersionRegistered");
    const hist = await reg.getVersionHistory(id);
    expect(hist.length).to.equal(2);
    expect(hist[1].parent).to.equal(1n);
    expect(hist[0].artifactHash).to.equal(h("a1"));
  });

  it("enforces owner-only, correct parent, unique labels, existing model, non-empty hashes", async () => {
    await expect(reg.connect(other).registerVersion(id, 1, "2", h("a"), h("m"), "c")).to.be.revertedWithCustomError(reg, "NotOwner");
    await expect(reg.registerVersion(id, 0, "2", h("a"), h("m"), "c")).to.be.revertedWithCustomError(reg, "WrongParent");
    await expect(reg.registerVersion(id, 1, "1.0.0", h("a"), h("m"), "c")).to.be.revertedWithCustomError(reg, "DuplicateLabel");
    await expect(reg.registerVersion(ethers.ZeroHash, 0, "2", h("a"), h("m"), "c")).to.be.revertedWithCustomError(reg, "UnknownModel");
    await expect(reg.registerVersion(id, 1, "2", ethers.ZeroHash, h("m"), "c")).to.be.revertedWithCustomError(reg, "EmptyField");
  });

  it("verifyModel returns hash refs (0 = latest) and rejects unknown versions", async () => {
    await reg.registerVersion(id, 1, "1.1.0", h("a2"), h("m2"), "cid2");
    const latest = await reg.verifyModel(id, 0);
    expect(latest.artifactHash).to.equal(h("a2"));
    expect(latest.resolvedVersion).to.equal(2n);
    const first = await reg.verifyModel(id, 1);
    expect(first.artifactHash).to.equal(h("a1"));
    expect(first.cid).to.equal("cid1");
    await expect(reg.verifyModel(id, 5)).to.be.revertedWithCustomError(reg, "UnknownVersion");
  });

  it("paginates model ids", async () => {
    await reg.registerModel("B", "1", h("a"), h("m"), "c");
    expect((await reg.listModelIds(0, 10)).length).to.equal(2);
    expect((await reg.listModelIds(1, 10)).length).to.equal(1);
    expect((await reg.listModelIds(5, 10)).length).to.equal(0);
  });
});
