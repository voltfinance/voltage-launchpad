# Voltage LaunchPad

_Voltage LaunchPad_ is a token launch platform where participants bid to provide liquidity for newly issued tokens. The platform enables price discovery and token distribution over a period of time before tokens are issued to public market, while discouraging front-running by bots. In addition, it improves liquidity sustainability by allowing issuing protocols to acquire its own token liquidity.

## How It Works

- LaunchEvent is created with a fixed amount of tokens to be issued.
- Users can deposit VOLT into the LaunchEvent contract. The amount of VOLT that can be deposited depends on whether the user has
staked veVolt or not. The amount of VOLT that can be deposited by users who have staked VeVolt is dictated by the parameter `veVoltPerVolt` and the amount that can be deposited by non vevolt stakers is determined by the `maxUnstakedUserAllocation`. The values for these params will vary from launch event to launch event.
- Users can also withdraw VOLT (if they think the price of TOKEN/VOLT is too high), but a withdrawal penalty may be incurred depending on which phase the launch event is at:

| Phase One  |                                   | Phase Two   | Phase Three                                |
| ---------- | --------------------------------- | ----------- | ------------------------------------------ |
| 0-24 hrs   | 24-48 hrs                         | 48-72 hrs   | Additional 0-7 days                        |
| 0% penalty | 0-50% penalty (linear increasing) | 20% penalty | LPs are locked + bonus incentives received |

- **Phase One**:
  - 0-24 hrs: Users can deposit and withdraw VOLT without any penalty.
  - 24-72 hrs: Users can continue to deposit and withdraw VOLT, but must incur a withdrawal penalty that increases linearly from 0-50% (the maximum is configurable).
- **Phase Two**: Users can _only_ withdraw VOLT with a 20% penalty (this parameter is also configurable).
- **Phase Three**: Initial liquidity is seeded, but the LP tokens are locked for an additional 0-7 days. As an incentive for locking, participants receive a bonus percentage of tokens once phase three starts. After this phase, both user and issuer are free to claim their LP tokens.

###### LaunchEventFactory

Creates individual LaunchEvent contracts. Also sets `veVoltPerVolt`.

###### LaunchEvent

Contract in which price discovery and token distribution takes place. Issuer deposits the issued tokens and users deposit and/or withdraw VOLT during a 72 hour period. The final amount of VOLT at the end of this period dictates the TOKEN/VOLT price which will be used to the seed initial liquidity on the Voltage Finance.

## Installation

The first things you need to do are cloning this repository and installing its
dependencies:

```sh
git clone https://github.com/volt-finance/voltage-launchpad.git
cd voltage-launchpad
yarn
```

## Testing

To run the tests run:

```sh
make test
```

There is a pending bug with `solidity-coverage`. To get around this bug, you must manually edit `node_modules/solidity-coverage/plugins/hardhat.plugin.js` according to these [edits](https://github.com/sc-forks/solidity-coverage/pull/667/files).

Then to run coverage:

```sh
make coverage
```

The coverage report will then be found in `coverage/`.

## Deployment

### Rinkeby

To deploy to the [rinkeby network](https://www.rinkeby.io/) you need to set appropriate environment variables. The file [.env.example](.env.example) contains examples of the variables you need to set. For convenience you can copy this file to a file name _.env_ and use a tool like [direnv](https://direnv.net/) to automatically load it.

You could then deploy to rinkeby by using [hardhat-deploy](https://github.com/wighawag/hardhat-deploy) with this command `yarn hardhat deploy --network rinkeby`.

After the deploy is complete you should commit the _deployments_ directory to this repo.

### Verifying contracts

To verify the contracts on rinkeby you will need an etherscan API key, see [.env.example](.env.example). To verify a contract on you will need the deployed contracts address, run

```
yarn hardhat verify --network rinkeby "${contract_address}"
```

## License

[MIT](LICENSE)
