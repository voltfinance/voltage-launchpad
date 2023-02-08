const { ethers, network } = require("hardhat");
const { expect } = require("chai");
const { advanceTimeAndBlock, duration } = require("./utils/time");
const { createLaunchEvent } = require("./utils/contracts");

describe("launch event contract phase three", function () {
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
    
    this.ERC20Token6Decimals = await ethers.getContractFactory("ERC20Token6decimals")

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
      _floorPrice: ethers.utils.parseEther("1"),
      _maxWithdrawPenalty: ethers.utils.parseEther("0.5"),
      _fixedWithdrawPenalty: ethers.utils.parseEther("0.4"),
      _maxUnstakedUserAllocation: ethers.utils.parseEther("100"),
      _maxStakedUserAllocation: ethers.utils.parseEther("150"),
      _userTimelock: 60 * 60 * 24 * 7,
      _issuerTimelock: 60 * 60 * 24 * 8,
    };
  });

  describe("interacting with phase three", function () {
    beforeEach(async function () {
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

      await this.volt.connect(this.dev).mint(
        this.dev.address,
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
      
      await advanceTimeAndBlock(duration.days(3));
    });

    it("should revert if try to withdraw liquidity", async function () {
      await expect(
        this.launchEvent.connect(this.participant).withdrawLiquidity()
      ).to.be.revertedWith(
        "LaunchEvent: can't withdraw before user's timelock"
      );
    });

    it("should revert if try do withdraw Volt", async function () {
      await expect(
        this.launchEvent.connect(this.participant).withdraw(
          ethers.utils.parseEther("1")
        )
      ).to.be.revertedWith("LaunchEvent: unable to withdraw");
    });

    it("should revert if deposited", async function () {
      await expect(
        this.launchEvent.connect(this.participant).deposit(
          ethers.utils.parseEther("1")
        )
      ).to.be.revertedWith("LaunchEvent: wrong phase");
    });

    it("should revert when withdraw liquidity if pair not created", async function () {
      await advanceTimeAndBlock(duration.days(8));
      await expect(
        this.launchEvent.connect(this.participant).withdrawLiquidity()
      ).to.be.revertedWith("LaunchEvent: pair not created");
    });

    it("should emit an event when it creates a VoltagePair", async function () {
      await expect(this.launchEvent.connect(this.participant).createPair())
        .to.emit(this.launchEvent, "LiquidityPoolCreated")
        .withArgs(
          await this.factory.getPair(this.volt.address, this.AUCTOK.address),
          this.AUCTOK.address,
          this.volt.address,
          ethers.utils.parseEther("1"), // This is 1 as floor price is set to 1
          ethers.utils.parseEther("1")
        );
    });

    it("should allow user to withdraw incentives if floor price is not met, and refund issuer", async function () {
      const tokenSentToLaunchEvent = await this.AUCTOK.balanceOf(
        this.launchEvent.address
      );

      await this.launchEvent.connect(this.participant).createPair();

      const tokenSentToPair = tokenSentToLaunchEvent.sub(
        await this.AUCTOK.balanceOf(this.launchEvent.address)
      );

      await expect(
        this.launchEvent.connect(this.participant).withdrawIncentives()
      )
        .to.emit(this.launchEvent, "IncentiveTokenWithdraw")
        .withArgs(
          this.participant.address,
          this.AUCTOK.address,
          ethers.utils.parseEther("0.05")
        );

      const userIncentives = await this.AUCTOK.balanceOf(
        this.participant.address
      );
      expect(userIncentives).to.be.equal(ethers.utils.parseEther("0.05"));

      await expect(this.launchEvent.connect(this.issuer).withdrawIncentives())
        .to.emit(this.launchEvent, "IncentiveTokenWithdraw")
        .withArgs(
          this.issuer.address,
          this.AUCTOK.address,
          ethers.utils.parseEther("103.95")
        );

      const issuerRefund = await this.AUCTOK.balanceOf(this.issuer.address);
      expect(issuerRefund).to.be.equal(ethers.utils.parseEther("103.95"));

      expect(userIncentives.add(issuerRefund).add(tokenSentToPair)).to.be.equal(
        tokenSentToLaunchEvent
      );
    });

    it("should revert if VoltagePair already created with liquidity", async function () {
      await this.launchEvent.connect(this.participant).createPair();
      await expect(
        this.launchEvent.connect(this.participant).createPair()
      ).to.be.revertedWith("LaunchEvent: liquid pair already exists");
    });

    it("should add liquidity on create pair if no supply", async function () {
      await this.factory.createPair(this.AUCTOK.address, this.volt.address);
      await this.launchEvent.connect(this.participant).createPair();
    });

    it("should add liquidity to pair where token0 balance > 0 and token1 balance == 0", async function () {
      await this.factory.createPair(this.volt.address, this.AUCTOK.address);
      const pairAddress = await this.factory.getPair(
        this.volt.address,
        this.AUCTOK.address
      );

      await this.volt
        .connect(this.dev)
        .transfer(pairAddress, ethers.utils.parseEther("1"));

      const pairBalance = await this.volt.balanceOf(pairAddress);
      await expect(pairBalance).to.equal(ethers.utils.parseEther("1"));

      const pair = await ethers.getContractAt("contracts/interfaces/IVoltagePair.sol:IVoltagePair", pairAddress);
      await pair.sync();
      await this.launchEvent.connect(this.participant).createPair();
    });

    it("should add liquidity to pair where token0 balance > 0 and token1 balance > 0", async function () {
      await this.factory.createPair(this.volt.address, this.AUCTOK.address);
      const pairAddress = await this.factory.getPair(
        this.volt.address,
        this.AUCTOK.address
      );

      this.volt
        .connect(this.dev)
        .transfer(pairAddress, ethers.utils.parseEther("1"));
      this.AUCTOK.connect(this.dev).mint(
        pairAddress,
        ethers.utils.parseEther("100")
      );

      const pair = await ethers.getContractAt("contracts/interfaces/IVoltagePair.sol:IVoltagePair", pairAddress);
      await pair.sync();
      await this.launchEvent.connect(this.participant).createPair();
    });

    it("should emit event when issuer withdraws liquidity", async function () {
      await this.launchEvent.connect(this.participant).createPair();
      await advanceTimeAndBlock(duration.days(8));

      await expect(this.launchEvent.connect(this.issuer).withdrawLiquidity())
        .to.emit(this.launchEvent, "IssuerLiquidityWithdrawn")
        .withArgs(
          this.issuer.address,
          await this.factory.getPair(this.volt.address, this.AUCTOK.address),
          ethers.utils.parseEther("0.4999999999999995")
        ); // Uniswap burns small amount of pair so not 0.5
    });

    it("should emit event when user withdraws liquidity", async function () {
      await this.launchEvent.connect(this.participant).createPair();
      await advanceTimeAndBlock(duration.days(8));

      await expect(
        this.launchEvent.connect(this.participant).withdrawLiquidity()
      )
        .to.emit(this.launchEvent, "UserLiquidityWithdrawn")
        .withArgs(
          this.participant.address,
          await this.factory.getPair(this.volt.address, this.AUCTOK.address),
          ethers.utils.parseEther("0.4999999999999995")
        ); // Uniswap burns small amount of pair so not 0.5
    });

    it("should revert if issuer tries to withdraw liquidity more than once", async function () {
      await this.launchEvent.connect(this.participant).createPair();

      // increase time to allow issuer to withdraw liquidity
      await advanceTimeAndBlock(duration.days(8));

      // issuer withdraws liquidity
      await this.launchEvent.connect(this.issuer).withdrawLiquidity();

      await expect(
        this.launchEvent.connect(this.issuer).withdrawLiquidity()
      ).to.be.revertedWith("LaunchEvent: caller has no liquidity to claim");
    });

    it("should report it is in the correct phase", async function () {
      expect((await this.launchEvent.currentPhase()) === 3);
    });
  });

  describe("withdrawing liquidity in phase three", async function () {
    beforeEach(async function () {

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
        ethers.utils.parseEther("200")
      );

      await this.volt.connect(this.dev).mint(
        this.dev.address,
        ethers.utils.parseEther("200")
      );

      await this.volt.connect(this.participant).approve(
        this.launchEvent.address,
        ethers.utils.parseEther("200")
      )

      await this.volt.connect(this.dev).mint(
        this.signers[4].address,
        ethers.utils.parseEther("200")
      );

      await this.volt.connect(this.signers[4]).approve(
        this.launchEvent.address,
        ethers.utils.parseEther("200")
      )
    });

    it("should not create pair when no volt deposited", async function () {
      await advanceTimeAndBlock(duration.days(4));
      await expect(
        this.launchEvent.connect(this.participant).createPair()
      ).to.be.revertedWith("LaunchEvent: no volt balance");
    });

    it("should evenly distribute liquidity and incentives to issuer and participant", async function () {
      await advanceTimeAndBlock(duration.seconds(120));

      // Participant buys all the pool at floor price.
      await this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("100.0"));
      await advanceTimeAndBlock(duration.days(3));
      await this.launchEvent.createPair();

      await advanceTimeAndBlock(duration.days(8));

      const pairAddress = await this.factory.getPair(
        this.volt.address,
        this.AUCTOK.address
      );
      const pair = await ethers.getContractAt("contracts/interfaces/IVoltagePair.sol:IVoltagePair", pairAddress);

      const totalSupply = await pair.totalSupply();
      expect(totalSupply).to.equal(ethers.utils.parseEther("100"));

      const MINIMUM_LIQUIDITY = await pair.MINIMUM_LIQUIDITY();

      expect(await pair.balanceOf(this.launchEvent.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY)
      );

      await this.launchEvent.connect(this.participant).withdrawLiquidity();
      await this.launchEvent.connect(this.issuer).withdrawLiquidity();

      expect(await pair.balanceOf(this.participant.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY).div(2)
      );

      expect(await pair.balanceOf(this.issuer.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY).div(2)
      );

      await this.launchEvent.connect(this.participant).withdrawIncentives();
      await expect(
        this.launchEvent.connect(this.issuer).withdrawIncentives()
      ).to.be.revertedWith("LaunchEvent: caller has no incentive to claim");

      expect(await this.AUCTOK.balanceOf(this.participant.address)).to.equal(
        ethers.utils.parseEther("5")
      );
    });

    it("should evenly distribute liquidity and incentives to issuer and participant if emergencyWithdraw is called bypassing the timelocks", async function () {
      await advanceTimeAndBlock(duration.seconds(120));

      // Participant buys all the pool at floor price.
      await this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("100.0"));
      await advanceTimeAndBlock(duration.days(3));

      await this.launchEvent.createPair();
      await this.launchEvent.allowEmergencyWithdraw();

      const pairAddress = await this.factory.getPair(
        this.volt.address,
        this.AUCTOK.address
      );
      const pair = await ethers.getContractAt("contracts/interfaces/IVoltagePair.sol:IVoltagePair", pairAddress);

      const totalSupply = await pair.totalSupply();
      expect(totalSupply).to.equal(ethers.utils.parseEther("100"));

      const MINIMUM_LIQUIDITY = await pair.MINIMUM_LIQUIDITY();

      expect(await pair.balanceOf(this.launchEvent.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY)
      );

      await this.launchEvent.connect(this.participant).emergencyWithdraw();
      await this.launchEvent.connect(this.issuer).emergencyWithdraw();

      expect(await pair.balanceOf(this.participant.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY).div(2)
      );

      expect(await pair.balanceOf(this.issuer.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY).div(2)
      );

      await this.launchEvent.connect(this.participant).withdrawIncentives();
      expect(await this.AUCTOK.balanceOf(this.participant.address)).to.equal(
        ethers.utils.parseEther("5")
      );
      await expect(
        this.launchEvent.connect(this.issuer).withdrawIncentives()
      ).to.be.revertedWith("LaunchEvent: caller has no incentive to claim");
    });

    it("should refund tokens if floor not met and distribute incentives", async function () {
      await advanceTimeAndBlock(duration.seconds(120));

      // Participant buys half the pool, floor price not met.
      // There should be a refund of 50 tokens to issuer.
      await this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("50.0"));
      await advanceTimeAndBlock(duration.days(3));
      await this.launchEvent.createPair();

      await advanceTimeAndBlock(duration.days(8));
      const pairAddress = await this.factory.getPair(
        this.volt.address,
        this.AUCTOK.address
      );
      const pair = await ethers.getContractAt("contracts/interfaces/IVoltagePair.sol:IVoltagePair", pairAddress);

      const totalSupply = await pair.totalSupply();
      expect(totalSupply).to.equal(ethers.utils.parseEther("50"));

      const MINIMUM_LIQUIDITY = await pair.MINIMUM_LIQUIDITY();

      expect(await pair.balanceOf(this.launchEvent.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY)
      );

      await this.launchEvent.connect(this.participant).withdrawLiquidity();

      const tokenBalanceBefore = await this.AUCTOK.balanceOf(
        this.issuer.address
      );
      await this.launchEvent.connect(this.issuer).withdrawLiquidity();

      expect(await pair.balanceOf(this.participant.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY).div(2)
      );
      expect(await pair.balanceOf(this.issuer.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY).div(2) 
      );

      await this.launchEvent.connect(this.participant).withdrawIncentives();
      await this.launchEvent.connect(this.issuer).withdrawIncentives();

      expect(await this.AUCTOK.balanceOf(this.participant.address)).to.equal(
        ethers.utils.parseEther("2.5")
      );

      expect(await this.AUCTOK.balanceOf(this.issuer.address)).to.equal(
        tokenBalanceBefore.add(ethers.utils.parseEther("52.5"))
      );
    });

    it("should evenly distribute liquidity and incentives to issuer and participants if overly subscribed", async function () {
      this.participant2 = this.signers[4];
      await advanceTimeAndBlock(duration.seconds(120));

      // Participant buys all the pool at floor price.
      await this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("100.0"));
      await this.launchEvent.connect(this.participant2).deposit(ethers.utils.parseEther("100.0"));

      await advanceTimeAndBlock(duration.days(3));
      await this.launchEvent.createPair();
      await advanceTimeAndBlock(duration.days(8));

      const pairAddress = await this.factory.getPair(
        this.volt.address,
        this.AUCTOK.address
      );
      const pair = await ethers.getContractAt("contracts/interfaces/IVoltagePair.sol:IVoltagePair", pairAddress);

      const totalSupply = await pair.totalSupply();
      expect(totalSupply).to.equal(
        "141421356237309504880" // sqrt ( volt * token)
      );

      const MINIMUM_LIQUIDITY = await pair.MINIMUM_LIQUIDITY();

      expect(await pair.balanceOf(this.launchEvent.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY)
      );

      await this.launchEvent.connect(this.participant).withdrawLiquidity();
      await this.launchEvent.connect(this.participant2).withdrawLiquidity();
      await this.launchEvent.connect(this.issuer).withdrawLiquidity();

      expect(await pair.balanceOf(this.participant.address)).to.equal(
        totalSupply.div(4).sub(MINIMUM_LIQUIDITY.div(4))
      );
      expect(await pair.balanceOf(this.participant2.address)).to.equal(
        totalSupply.div(4).sub(MINIMUM_LIQUIDITY.div(4))
      );
      expect(await pair.balanceOf(this.issuer.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY).div(2)
      );

      await this.launchEvent.connect(this.participant).withdrawIncentives();
      await this.launchEvent.connect(this.participant2).withdrawIncentives();
      await expect(
        this.launchEvent.connect(this.issuer).withdrawIncentives()
      ).to.be.revertedWith("LaunchEvent: caller has no incentive to claim");

      expect(await this.AUCTOK.balanceOf(this.participant.address)).to.equal(
        ethers.utils.parseEther("2.5")
      );
      expect(await this.AUCTOK.balanceOf(this.participant2.address)).to.equal(
        ethers.utils.parseEther("2.5")
      );
    });
  });
  describe("withdrawing liquidity in phase three, with a token using 6 decimals", async function () {
    beforeEach(async function () {
      this.participant2 = this.signers[4]

      this.AUCTOK6D = await this.ERC20Token6Decimals.deploy();
      await this.AUCTOK6D.connect(this.dev).mint(
        this.dev.address,
        ethers.utils.parseEther("105")
      );
      await this.AUCTOK6D.connect(this.dev).approve(
        this.launchEventFactory.address,
        ethers.utils.parseEther("105")
      );

      await this.launchEventFactory.createLaunchEvent({
        issuer: this.validParams._issuer,
        phaseOneStartTime: this.validParams._auctionStart,
        token: this.AUCTOK6D.address,
        tokenAmountIncludingIncentives: "105000000",
        tokenIncentivesPercent: this.validParams._tokenIncentivesPercent,
        floorPrice: this.validParams._floorPrice,
        maxWithdrawPenalty: this.validParams._maxWithdrawPenalty,
        fixedWithdrawPenalty: this.validParams._fixedWithdrawPenalty,
        maxUnstakedUserAllocation: this.validParams._maxUnstakedUserAllocation,
        maxStakedUserAllocation: this.validParams._maxStakedUserAllocation,
        userTimelock: this.validParams._userTimelock,
        issuerTimelock: this.validParams._issuerTimelock
      })

      const launchEventAddress = await this.launchEventFactory.getLaunchEvent(this.AUCTOK6D.address);
      this.launchEvent = await ethers.getContractAt('LaunchEvent', launchEventAddress)

      await this.volt.connect(this.dev).mint(
        this.participant.address,
        ethers.utils.parseEther("200")
      );

      await this.volt.connect(this.dev).mint(
        this.dev.address,
        ethers.utils.parseEther("200")
      );

      await this.volt.connect(this.participant).approve(
        this.launchEvent.address,
        ethers.utils.parseEther("200")
      )

      await this.volt.connect(this.dev).mint(
        this.signers[4].address,
        ethers.utils.parseEther("200")
      );

      await this.volt.connect(this.signers[4]).approve(
        this.launchEvent.address,
        ethers.utils.parseEther("200")
      )
    });

    it("should not create pair when no volt deposited", async function () {
      await advanceTimeAndBlock(duration.days(4));
      await expect(
        this.launchEvent.connect(this.participant).createPair()
      ).to.be.revertedWith("LaunchEvent: no volt balance");
    });

    it("should evenly distribute liquidity and incentives to issuer and participant", async function () {
      await advanceTimeAndBlock(duration.seconds(120));

      // Participant buys all the pool at floor price.
      await this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("100.0"));
      await advanceTimeAndBlock(duration.days(3));

      await this.launchEvent.createPair();

      await advanceTimeAndBlock(duration.days(8));

      const pairAddress = await this.factory.getPair(
        this.volt.address,
        this.AUCTOK6D.address
      );

      const pair = await ethers.getContractAt("contracts/interfaces/IVoltagePair.sol:IVoltagePair", pairAddress);

      const totalSupply = await pair.totalSupply();
      expect(totalSupply).to.equal(ethers.utils.parseUnits("100", 12));

      const MINIMUM_LIQUIDITY = await pair.MINIMUM_LIQUIDITY();

      expect(await pair.balanceOf(this.launchEvent.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY)
      );

      await this.launchEvent.connect(this.participant).withdrawLiquidity();
      await this.launchEvent.connect(this.issuer).withdrawLiquidity();

      expect(await pair.balanceOf(this.participant.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY).div(2)
      );

      expect(await pair.balanceOf(this.issuer.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY).div(2)
      );

      await this.launchEvent.connect(this.participant).withdrawIncentives();
      await expect(
        this.launchEvent.connect(this.issuer).withdrawIncentives()
      ).to.be.revertedWith("LaunchEvent: caller has no incentive to claim");

      expect(await this.AUCTOK6D.balanceOf(this.participant.address)).to.equal(
        ethers.utils.parseUnits("5", 6)
      );
    });
    it("should evenly distribute liquidity and incentives to issuer and participant if emergencyWithdraw is called bypassing the timelocks", async function () {
      await advanceTimeAndBlock(duration.seconds(120));

      // Participant buys all the pool at floor price.
      await this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("100.0"));
      await advanceTimeAndBlock(duration.days(3));

      await this.launchEvent.createPair();
      await this.launchEvent.allowEmergencyWithdraw();

      const pairAddress = await this.factory.getPair(
        this.volt.address,
        this.AUCTOK6D.address
      );
      const pair = await ethers.getContractAt("contracts/interfaces/IVoltagePair.sol:IVoltagePair", pairAddress);

      const totalSupply = await pair.totalSupply();
      expect(totalSupply).to.equal(ethers.utils.parseUnits("100", 12));

      const MINIMUM_LIQUIDITY = await pair.MINIMUM_LIQUIDITY();

      expect(await pair.balanceOf(this.launchEvent.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY)
      );

      await this.launchEvent.connect(this.participant).emergencyWithdraw();
      await this.launchEvent.connect(this.issuer).emergencyWithdraw();

      expect(await pair.balanceOf(this.participant.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY).div(2)
      );

      expect(await pair.balanceOf(this.issuer.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY).div(2)
      );

      await this.launchEvent.connect(this.participant).withdrawIncentives();
      expect(await this.AUCTOK6D.balanceOf(this.participant.address)).to.equal(
        ethers.utils.parseUnits("5", 6)
      );
      await expect(
        this.launchEvent.connect(this.issuer).withdrawIncentives()
      ).to.be.revertedWith("LaunchEvent: caller has no incentive to claim");
    });

    it("should refund tokens if floor not met and distribute incentives", async function () {
      await advanceTimeAndBlock(duration.seconds(120));

      // Participant buys half the pool, floor price not met.
      // There should be a refund of 50 tokens to issuer.
      await this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("50.0"));
      await advanceTimeAndBlock(duration.days(3));
      await this.launchEvent.createPair();

      await advanceTimeAndBlock(duration.days(8));
      const pairAddress = await this.factory.getPair(
        this.volt.address,
        this.AUCTOK6D.address
      );
      const pair = await ethers.getContractAt("contracts/interfaces/IVoltagePair.sol:IVoltagePair", pairAddress);

      const totalSupply = await pair.totalSupply();
      expect(totalSupply).to.equal(ethers.utils.parseUnits("50", 12));

      const MINIMUM_LIQUIDITY = await pair.MINIMUM_LIQUIDITY();

      expect(await pair.balanceOf(this.launchEvent.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY)
      );

      await this.launchEvent.connect(this.participant).withdrawLiquidity();

      const tokenBalanceBefore = await this.AUCTOK6D.balanceOf(
        this.issuer.address
      );
      await this.launchEvent.connect(this.issuer).withdrawLiquidity();

      expect(await pair.balanceOf(this.participant.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY).div(2)
      );
      expect(await pair.balanceOf(this.issuer.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY).div(2)
      );

      await this.launchEvent.connect(this.participant).withdrawIncentives();
      await this.launchEvent.connect(this.issuer).withdrawIncentives();

      expect(await this.AUCTOK6D.balanceOf(this.participant.address)).to.equal(
        ethers.utils.parseUnits("2.5", 6)
      );

      expect(await this.AUCTOK6D.balanceOf(this.issuer.address)).to.equal(
        tokenBalanceBefore.add(ethers.utils.parseUnits("52.5", 6))
      );
    });

    it("should evenly distribute liquidity and incentives to issuer and participants if overly subscribed", async function () {
      this.participant2 = this.signers[4];
      
      await advanceTimeAndBlock(duration.seconds(120));

      // Participant buys all the pool at floor price.
      await this.launchEvent.connect(this.participant).deposit(ethers.utils.parseEther("100.0"));
      await this.launchEvent.connect(this.participant2).deposit(ethers.utils.parseEther("100.0"));

      await advanceTimeAndBlock(duration.days(3));
      await this.launchEvent.createPair();
      await advanceTimeAndBlock(duration.days(8));

      const pairAddress = await this.factory.getPair(
        this.volt.address,
        this.AUCTOK6D.address
      );
      const pair = await ethers.getContractAt("contracts/interfaces/IVoltagePair.sol:IVoltagePair", pairAddress);

      const totalSupply = await pair.totalSupply();
      expect(totalSupply).to.equal(
        "141421356237309" // sqrt ( volt * token)
      );

      const MINIMUM_LIQUIDITY = await pair.MINIMUM_LIQUIDITY();

      expect(await pair.balanceOf(this.launchEvent.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY)
      );

      await this.launchEvent.connect(this.participant).withdrawLiquidity();
      await this.launchEvent.connect(this.participant2).withdrawLiquidity();
      await this.launchEvent.connect(this.issuer).withdrawLiquidity();

      expect(await pair.balanceOf(this.participant.address)).to.equal(
        totalSupply.div(4).sub(MINIMUM_LIQUIDITY.div(4))
      );
      expect(await pair.balanceOf(this.participant2.address)).to.equal(
        totalSupply.div(4).sub(MINIMUM_LIQUIDITY.div(4))
      );
      expect(await pair.balanceOf(this.issuer.address)).to.equal(
        totalSupply.sub(MINIMUM_LIQUIDITY).div(2)
      );

      await this.launchEvent.connect(this.participant).withdrawIncentives();
      await this.launchEvent.connect(this.participant2).withdrawIncentives();
      await expect(
        this.launchEvent.connect(this.issuer).withdrawIncentives()
      ).to.be.revertedWith("LaunchEvent: caller has no incentive to claim");

      expect(await this.AUCTOK6D.balanceOf(this.participant.address)).to.equal(
        ethers.utils.parseUnits("2.5", 6)
      );
      expect(await this.AUCTOK6D.balanceOf(this.participant2.address)).to.equal(
        ethers.utils.parseUnits("2.5", 6)
      );
    });
  });

  after(async function () {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
  });
});
