const { ethers, network } = require("hardhat");
const { expect } = require("chai");
const { advanceTimeAndBlock, duration } = require("./utils/time");

describe("launch event contract phase one", function () {
  before(async function () {
    // The wallets taking part in tests.
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
  });

  describe("interacting with phase one", function () {
    describe("depositing in phase one", function () {
      it("should revert if issuer tries to participate", async function () {
        await advanceTimeAndBlock(duration.seconds(120));
        expect(
          this.launchEvent.connect(this.issuer).deposit(ethers.utils.parseEther("1.0"))
        ).to.be.revertedWith("LaunchEvent: issuer cannot participate");
      });

      it("should revert if sale has not started yet", async function () {
        expect(
          this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("1.0"))
        ).to.be.revertedWith("LaunchEvent: wrong phase");
      });

      it("should revert if withdraw zero", async function () {
        await advanceTimeAndBlock(duration.seconds(120));
        await expect(
          this.launchEvent.connect(this.participant).withdraw(0)
        ).to.be.revertedWith("LaunchEvent: invalid withdraw amount");
      });

      it("should be payable with Volt", async function () {
        await advanceTimeAndBlock(duration.seconds(120));
        await this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("1.0"));
        expect(
          this.launchEvent.getUserInfo(this.participant.address).amount
        ).to.equal(ethers.utils.parseEther("1.0").number);
      });

      it("should emit event on deposit", async function () {
        await advanceTimeAndBlock(duration.seconds(120));
        await expect(
          this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("1.0"))
        )
          .to.emit(this.launchEvent, "UserParticipated")
          .withArgs(
            this.participant.address,
            ethers.utils.parseEther("1.0")
          );
        await this.launchEvent.connect(this.participant).withdraw(
          ethers.utils.parseEther("1.0")
        );

        await expect(
          this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("1.0"))
        )
          .to.emit(this.launchEvent, "UserParticipated")
          .withArgs(
            this.participant.address,
            ethers.utils.parseEther("1.0")
          );
      });

      it("should emit event when stopped", async function () {
        await expect(
          this.launchEvent.connect(this.dev).allowEmergencyWithdraw()
        ).to.emit(this.launchEvent, "Stopped");
      });

      it("should revert on deposit if stopped", async function () {
        await advanceTimeAndBlock(duration.seconds(120));
        await this.launchEvent.connect(this.dev).allowEmergencyWithdraw();
        expect(
          this.launchEvent.connect(this.participant).deposit(6000)
        ).to.be.revertedWith("launchEvent: stopped");
      });

      it("should revert if Volt sent more than max allocation", async function () {
        await advanceTimeAndBlock(duration.seconds(120));
        expect(
          this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("6"))
        ).to.be.revertedWith("LaunchEvent: amount exceeds max allocation");
      });
    });

    describe("withdrawing in phase one", function () {
      beforeEach(async function () {
        await advanceTimeAndBlock(duration.seconds(120));
        await this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("1.0"));
      });

      it("should apply no fee if withdraw in first day", async function () {
        // Test the amount received
        const balanceBefore = await this.volt.balanceOf(this.participant.address);
        await this.launchEvent.connect(this.participant).withdraw(
          ethers.utils.parseEther("1.0")
        );
        expect(await this.volt.balanceOf(this.participant.address)).to.be.above(balanceBefore);
        // Check the balance of penalty collecter.
        expect(await this.volt.balanceOf(this.penaltyCollector.address)).to.equal("0");
      });

      it("should emit an event when user withdraws", async function () {
        const eventImplementation = await ethers.getContractAt(
          "LaunchEvent",
          await this.launchEventFactory.eventImplementation()
        );
        await expect(
          this.launchEvent.connect(this.participant).withdraw(
            ethers.utils.parseEther("1.0")
          )
        )
          .to.emit(await this.launchEvent, "UserWithdrawn")
          .withArgs(
            this.participant.address,
            ethers.utils.parseEther("1.0"),
            0
          );
      });

      it("should apply gradient fee if withdraw in second day", async function () {
        await advanceTimeAndBlock(duration.hours(36));

        await this.launchEvent.connect(this.participant).withdraw(
          ethers.utils.parseEther("1.0")
        );

        // Check the balance of penalty collecter.
        expect(
          await this.volt.balanceOf(this.penaltyCollector.address)
        ).to.be.equal("250387731481481481");
      });

      it("should keep allocation after withdraw", async function () {
        await advanceTimeAndBlock(duration.hours(36));
        const allocationBefore = this.launchEvent.getUserInfo(
          this.participant.address
        );
        await this.launchEvent.connect(this.participant).withdraw(
          ethers.utils.parseEther("1.0")
        );
        const allocation = this.launchEvent.getUserInfo(
          this.participant.address
        );
        expect(allocation.allocation).to.be.equal(allocationBefore.allocation);
      });

      it("can deposit when have excess allocation", async function () {
        await advanceTimeAndBlock(duration.hours(36));
        await this.launchEvent.connect(this.participant).withdraw(
          ethers.utils.parseEther("1.0")
        );
        await this.launchEvent.connect(this.participant).deposit(
          ethers.utils.parseEther("1.0")
        );
      });
    });

    it("should revert if not stopped by LaunchEventFactory owner", async function () {
      // issuer of the LaunchEvent
      await expect(
        this.launchEvent.connect(this.issuer).allowEmergencyWithdraw()
      ).to.be.revertedWith("LaunchEvent: caller is not LaunchEventFactory owner");

      // any user
      await expect(
        this.launchEvent.connect(this.participant).allowEmergencyWithdraw()
      ).to.be.revertedWith("LaunchEvent: caller is not LaunchEventFactory owner");
    });

    it("should revert try to create pool during phase one", async function () {
      await advanceTimeAndBlock(duration.seconds(120));
      expect(
        this.launchEvent.connect(this.dev).createPair()
      ).to.be.revertedWith("LaunchEvent: wrong phase");
    });

    it("should revert trying to send FUSE to the contract", async function () {
      await expect(
        this.participant.sendTransaction({
          to: this.launchEvent.address,
          value: ethers.utils.parseEther("1.0"),
        })
      ).to.be.revertedWith(
        "Transaction reverted: function selector was not recognized and there's no fallback nor receive function"
      );
    });

    it("should report it is in the correct phase", async function () {
      await expect(this.launchEvent.currentPhase() == 1);
    });
  });

  after(async function () {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
  });
});
