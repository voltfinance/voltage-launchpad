const { ethers, network } = require("hardhat");
const { expect } = require("chai");
const { advanceTimeAndBlock, duration } = require("./utils/time");
const { deployRocketFactory, createLaunchEvent } = require("./utils/contracts");

describe("launch event contract phase two", function () {
  before(async function () {
    this.signers = await ethers.getSigners();
    this.dev = this.signers[0];
    this.penaltyCollector = this.signers[1];
    this.issuer = this.signers[2];
    this.participant = this.signers[3];

  });

  beforeEach(async function () {
    // Deploy the tokens used for tests.
    this.Volt = await ethers.getContractFactory("Volt")
    this.VeVolt = await ethers.getContractFactory("VeVolt")
    this.ERC20Token = await ethers.getContractFactory("ERC20Token");
    this.WETH9 = await ethers.getContractFactory("WETH9");

    this.weth = await this.WETH9.deploy()
    this.volt = await this.Volt.deploy()
    this.veVolt = await this.VeVolt.deploy(
      this.volt.address, 
      "Vote Escrow Volt", 
      "veVolt", 
      this.dev.address,
      '0x0000000000000000000000000000000000000000' 
    )

    this.AUCTOK = await this.ERC20Token.deploy();

    // Deploy dex
    this.Router = await ethers.getContractFactory("VoltageRouter")
    this.Factory = await ethers.getContractFactory("VoltageFactory")

    
    this.factory = await this.Factory.deploy(this.dev.address)
    this.router = await this.Router.deploy(this.factory.address, this.weth.address)

    // create launch event factory
    this.LaunchEvent = await ethers.getContractFactory("LaunchEvent");
    this.LaunchEventFactory = await ethers.getContractFactory('LaunchEventFactory');
    
    this.launchEventClone = await this.LaunchEvent.deploy()
    this.launchEventFactory = await this.LaunchEventFactory.deploy()

    await this.launchEventFactory.initialize(
      this.launchEventClone.address,
      this.veVolt.address,
      this.volt.address,
      this.penaltyCollector.address,
      this.router.address,
      this.factory.address
    )

    // Keep a reference to the current block.
    this.block = await ethers.provider.getBlock();

    // Send the tokens used to the issuer and approve spending to the factory.
    await this.AUCTOK.connect(this.dev).mint(
      this.dev.address,
      ethers.utils.parseEther("105")
    );
    await this.AUCTOK.connect(this.dev).approve(
      this.launchEventFactory.address,
      ethers.utils.parseEther("105")
    );

    // Valid initialization parameters for `createRJLaunchEvent` used as
    // base arguments when we want to check reversions for specific values.
    this.validParams = {
      _issuer: this.issuer.address,
      _auctionStart: this.block.timestamp + 60,
      _token: this.AUCTOK.address,
      _tokenAmount: ethers.utils.parseEther("105"),
      _tokenIncentivesPercent: ethers.utils.parseEther("0.05"),
      _floorPrice: 1,
      _maxWithdrawPenalty: ethers.utils.parseEther("0.5"),
      _fixedWithdrawPenalty: ethers.utils.parseEther("0.4"),
      _maxUnstakedUserAllocation: ethers.utils.parseEther("2"),
      _maxStakedUserAllocation: ethers.utils.parseEther("10"),
      _userTimelock: 60 * 60 * 24 * 7,
      _issuerTimelock: 60 * 60 * 24 * 8,
    };

    await this.launchEventFactory.createLaunchEvent({
      issuer: this.validParams._issuer,
      phaseOneStartTime: this.validParams._auctionStart,
      token: this.validParams._token,
      tokenAmountIncludingIncentives: this.validParams._tokenAmount,
      tokenIncentivesPercent: this.validParams._tokenIncentivesPercent,
      floorPrice: this.validParams._floorPrice,
      maxWithdrawPenalty: this.validParams._maxWithdrawPenalty,
      fixedWithdrawPenalty: this.validParams._fixedWithdrawPenalty,
      maxUnstakedUserAllocation: this.validParams._maxUnstakedUserAllocation,
      maxStakedUserAllocation: this.validParams._maxStakedUserAllocation,
      userTimelock: this.validParams._userTimelock,
      issuerTimelock: this.validParams._issuerTimelock
    })

    const launchEventAddress = await this.launchEventFactory.getLaunchEvent(this.validParams._token);
    this.launchEvent = await ethers.getContractAt('LaunchEvent', launchEventAddress)

    await this.volt.connect(this.dev).mint(
      this.participant.address,
      ethers.utils.parseEther("100")
    );
    await this.volt.connect(this.participant).approve(
      this.launchEvent.address,
      ethers.utils.parseEther("100")
    )

    await advanceTimeAndBlock(duration.seconds(120));
    await this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("1.0"));
    expect(
      this.launchEvent.getUserInfo(this.participant.address).amount
    ).to.equal(ethers.utils.parseEther("1.0").number);

    await advanceTimeAndBlock(duration.days(2));
  });

  describe("interacting with phase two", function () {
    it("should revert if withdraw liquidity", async function () {
      expect(
        this.launchEvent.connect(this.participant).withdrawLiquidity()
      ).to.be.revertedWith(
        "LaunchEvent: can't withdraw before user's timelock"
      );
    });

    it("should revert if issuer withdraw liquidity", async function () {
      expect(
        this.launchEvent.connect(this.issuer).withdrawLiquidity()
      ).to.be.revertedWith(
        "LaunchEvent: can't withdraw before issuer's timelock"
      );
    });

    it("should revert if deposited", async function () {
      expect(
        this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("1.0"))
      ).to.be.revertedWith("LaunchEvent: wrong phase");
    });

    it("should revert try to create pool", async function () {
      expect(
        this.launchEvent.connect(this.participant).createPair()
      ).to.be.revertedWith("LaunchEvent: wrong phase");
    });

    it("should charge a fixed withdraw penalty", async function () {
      await this.launchEvent.connect(this.participant).withdraw(
        ethers.utils.parseEther("1.0")
      );
      // 40% withdraw fee in tests, 10000 starting balance.
      expect(await this.volt.balanceOf(this.penaltyCollector.address)).to.equal(
        ethers.utils.parseEther("0.4")
      );
    });

    it("should report it is in the correct phase", async function () {
      await expect(this.launchEvent.currentPhase() == 2);
    });

    it("should allow emergency withdraw to issuer when stopped", async function () {
      await expect(
        this.launchEvent.connect(this.issuer).emergencyWithdraw()
      ).to.be.revertedWith("LaunchEvent: is still running");
      await this.launchEvent.connect(this.dev).allowEmergencyWithdraw();
      await expect(await this.AUCTOK.balanceOf(this.issuer.address)).to.equal(
        0
      );
      await this.launchEvent.connect(this.issuer).emergencyWithdraw();
      await expect(
        await this.AUCTOK.balanceOf(this.launchEvent.address)
      ).to.equal(0);
      await expect(await this.AUCTOK.balanceOf(this.issuer.address)).to.equal(
        ethers.utils.parseEther("105.0")
      );
    });

    it("should emit event when issuer emergency withdraws", async function () {
      await this.launchEvent.connect(this.dev).allowEmergencyWithdraw();
      await expect(this.launchEvent.connect(this.issuer).emergencyWithdraw())
        .to.emit(this.launchEvent, "TokenEmergencyWithdraw")
        .withArgs(this.issuer.address, ethers.utils.parseEther("105"));
    });

    it("should emit event when user emergency withdraws", async function () {
      await this.launchEvent.connect(this.dev).allowEmergencyWithdraw();
      await expect(
        this.launchEvent.connect(this.participant).emergencyWithdraw()
      )
        .to.emit(this.launchEvent, "VoltEmergencyWithdraw")
        .withArgs(this.participant.address, ethers.utils.parseEther("1"));
    });

    it("should allow emergency withdraw to user when stopped", async function () {
      await expect(
        this.launchEvent.connect(this.participant).emergencyWithdraw()
      ).to.be.revertedWith("LaunchEvent: is still running");
      await this.launchEvent.connect(this.dev).allowEmergencyWithdraw();

      await this.launchEvent.connect(this.participant).emergencyWithdraw();
      // `closeTo` is used as an inaccurate approximation of gas fees.
      await expect(await this.volt.balanceOf(this.participant.address)).to.equal("100000000000000000000");
    });
  });

  after(async function () {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
  });
});
