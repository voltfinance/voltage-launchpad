const { ethers, network } = require("hardhat");
const { expect } = require("chai");
const { HARDHAT_FORK_CURRENT_PARAMS } = require("./utils/hardhat");
const {
  getWavax,
  getJoeFactory,
  deployRocketFactory,
  createLaunchEvent,
} = require("./utils/contracts");

describe("launch event contract initialisation", function () {
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
    
    this.launchEvent = await this.LaunchEvent.deploy()
    this.launchEventFactory = await this.LaunchEventFactory.deploy()

    await this.launchEventFactory.initialize(
      this.launchEvent.address,
      this.veVolt.address,
      this.volt.address,
      this.dev.address,
      this.router.address,
      this.factory.address
    )

    // Keep a reference to the current block.
    this.block = await ethers.provider.getBlock();

    // Send the tokens used to the issuer and approve spending to the factory.
    await this.AUCTOK.connect(this.dev).mint(
      this.dev.address,
      ethers.utils.parseEther("110")
    );
    await this.AUCTOK.connect(this.dev).approve(
      this.launchEventFactory.address,
      ethers.utils.parseEther("110")
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
      _maxUnstakedUserAllocation: 100,
      _maxStakedUserAllocation: 10,
      _userTimelock: 60 * 60 * 24 * 7,
      _issuerTimelock: 60 * 60 * 24 * 8,
    };
  });

  describe("initialising the contract", function () {
    it("should emit event when token added", async function () {
      await this.factory.createPair(this.AUCTOK.address, this.volt.address);
      await expect(
        this.launchEventFactory.createLaunchEvent({
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
      )
        .to.emit(this.launchEventFactory, "IssuingTokenDeposited")
        .withArgs(this.AUCTOK.address, this.validParams._tokenAmount)
        .to.emit(this.launchEventFactory, "LaunchEventCreated")
        .withArgs(
          await this.launchEventFactory.getLaunchEvent(this.AUCTOK.address),
          this.issuer.address,
          this.AUCTOK.address,
          this.validParams._auctionStart,
          this.validParams._auctionStart + 60 * 60 * 24 * 2,
          this.validParams._auctionStart + 60 * 60 * 24 * 3,
          this.veVolt.address,
          ethers.utils.parseEther("100")
        )
        .to.emit(
          await ethers.getContractAt(
            "LaunchEvent",
            await this.launchEventFactory.getLaunchEvent(this.AUCTOK.address)
          ),
          "LaunchEventInitialized"
        )
        .withArgs(
          this.validParams._tokenIncentivesPercent,
          this.validParams._floorPrice,
          this.validParams._maxWithdrawPenalty,
          this.validParams._fixedWithdrawPenalty,
          this.validParams._maxUnstakedUserAllocation,
          this.validParams._maxStakedUserAllocation,
          this.validParams._userTimelock,
          this.validParams._issuerTimelock,
          ethers.utils.parseEther("100"),
          ethers.utils.parseEther("5")
        );
    });

    it("should create a launch event if pair created with no liquidity", async function () {
      await this.factory.createPair(this.AUCTOK.address, this.volt.address);
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
      });
    });

    const testReverts = async (factory, args, message) => {
      await expect(
        factory.createLaunchEvent({
          issuer: args._issuer,
          phaseOneStartTime: args._auctionStart,
          token: args._token,
          tokenAmountIncludingIncentives: args._tokenAmount,
          tokenIncentivesPercent: args._tokenIncentivesPercent,
          floorPrice: args._floorPrice,
          maxWithdrawPenalty: args._maxWithdrawPenalty,
          fixedWithdrawPenalty: args._fixedWithdrawPenalty,
          maxUnstakedUserAllocation: args._maxUnstakedUserAllocation,
          maxStakedUserAllocation: args._maxStakedUserAllocation,
          userTimelock: args._userTimelock,
          issuerTimelock: args._issuerTimelock
        })
      ).to.be.revertedWith(message);
    };

    it("should revert if issuer address is 0", async function () {
      const args = {
        ...this.validParams,
        _issuer: ethers.constants.AddressZero,
      };
      await testReverts(
        this.launchEventFactory,
        args,
        "LaunchEventFactory: issuer can't be 0 address"
      );
    });

    it("should revert if token address is 0", async function () {
      const args = {
        ...this.validParams,
        _token: ethers.constants.AddressZero,
      };
      await testReverts(
        this.launchEventFactory,
        args,
        "LaunchEventFactory: token can't be 0 address"
      );
    });

    it("should revert if incentives percent too high", async function () {
      const args = {
        ...this.validParams,
        _tokenIncentivesPercent: ethers.utils.parseEther("1"),
      };
      await testReverts(
        this.launchEventFactory,
        args,
        "LaunchEvent: token incentives too high"
      );
    });

    it("should revert if startime has elapsed", async function () {
      const args = {
        ...this.validParams,
        _auctionStart: this.block.timestamp - 1,
      };
      await testReverts(
        this.launchEventFactory,
        args,
        "LaunchEvent: start of phase 1 cannot be in the past"
      );
    });

    it("should revert if token is volt", async function () {
      const args = {
        ...this.validParams,
        _token: this.volt.address,
      };
      await testReverts(
        this.launchEventFactory,
        args,
        "LaunchEventFactory: token can't be volt"
      );
    });

    it("should revert initialisation if launch pair already exists (USDC)", async function () {
      await this.volt.connect(this.dev).mint(
        this.dev.address,
        ethers.utils.parseEther("100")
      );

      await this.factory.createPair(this.AUCTOK.address, this.volt.address)

      const pairAddress = this.factory.getPair(this.AUCTOK.address, this.volt.address)
      const pair = await ethers.getContractAt("contracts/interfaces/IVoltagePair.sol:IVoltagePair", pairAddress)

      await this.volt.connect(this.dev).transfer(pairAddress, ethers.utils.parseEther("1"))
      await this.AUCTOK.connect(this.dev).transfer(pairAddress, ethers.utils.parseEther("1"))

      await pair.mint(this.dev.address)

      await testReverts(
        this.launchEventFactory,
        this.validParams,
        "LaunchEventFactory: liquid pair already exists"
      );
    });

    it("should revert if max withdraw penalty is too high", async function () {
      const args = {
        ...this.validParams,
        _maxWithdrawPenalty: ethers.utils.parseEther("0.5").add("1"),
      };
      await testReverts(
        this.launchEventFactory,
        args,
        "LaunchEvent: maxWithdrawPenalty too big"
      );
    });

    it("should revert if fixed withdraw penalty is too high", async function () {
      const args = {
        ...this.validParams,
        _fixedWithdrawPenalty: ethers.utils.parseEther("0.5").add("1"),
      };
      await testReverts(
        this.launchEventFactory,
        args,
        "LaunchEvent: fixedWithdrawPenalty too big"
      );
    });

    it("should revert initialisation if user timelock is too long", async function () {
      const args = {
        ...this.validParams,
        _userTimelock: 60 * 60 * 24 * 7 + 1,
      };
      await testReverts(
        this.launchEventFactory,
        args,
        "LaunchEvent: can't lock user LP for more than 7 days"
      );
    });

    it("should revert initialisation if issuer timelock is before user", async function () {
      const args = {
        ...this.validParams,
        _userTimelock: 60 * 60 * 24 * 7,
        _issuerTimelock: 60 * 60 * 24 * 7 - 1,
      };
      await testReverts(
        this.launchEventFactory,
        args,
        "LaunchEvent: issuer can't withdraw before users"
      );
    });

    it("should deploy with correct paramaters", async function () {
      expect(
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
      );
    });

    it("should revert if initialised twice", async function () {
      expect(
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
      );
      LaunchEvent = await ethers.getContractAt(
        "LaunchEvent",
        this.launchEventFactory.getLaunchEvent(this.AUCTOK.address)
      );

      expect(
        LaunchEvent.initialize(
          this.launchEvent.address,
          this.veVolt.address,
          this.volt.address,
          this.dev.address,
          this.router.address,
          this.factory.address
        )
      ).to.be.revertedWith("LaunchEvent: already initialized");
    });

    it("should report it is in the correct phase", async function () {
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
      });
      LaunchEvent = await ethers.getContractAt(
        "LaunchEvent",
        this.launchEventFactory.getLaunchEvent(this.AUCTOK.address)
      );
      expect((await LaunchEvent.currentPhase()) == 0);
    });
  });

  after(async function () {
    await network.provider.request({
      method: "hardhat_reset",
      params: [],
    });
  });
});
