import { BigNumber } from "ethers";
import axios from "axios";
import { inspect } from "util";

type Address = string;

export type ZeroExTradeQuoterOptions = {
  chainId: number,
  zeroExApiKey: string,
}

export type ZeroExQueryParams = {
  sellToken: Address,
  buyToken: Address,
  sellAmount: string,
  slippagePercentage: number,
  takerAddress: Address,
  excludedSources: string,
  skipValidation: boolean,
  feeRecipient: Address,
  buyTokenPercentageFee: number
  affiliateAddress: Address,
  intentOnFilling: boolean
}

export type ZeroExTradeQuote = {
  guaranteedPrice: number,
  price: number,
  sellAmount: BigNumber,
  buyAmount: BigNumber,
  calldata: string
}

export class ZeroExTradeQuoter {
  private chainId: number;
  private host: string;
  private zeroExApiKey: string;

  private swapQuoteRoute = "/swap/v1/quote";
  private feePercentage: number = 0;
  private feeRecipientAddress: Address = "0xD3D555Bb655AcBA9452bfC6D7cEa8cC7b3628C55";
  private affiliateAddress: Address = "0xD3D555Bb655AcBA9452bfC6D7cEa8cC7b3628C55";

  private excludedSources: string[] = ["Kyber","Eth2Dai","Uniswap","Mesh"];

  // TODO: check this number
  private slippagePercentage: number = 0.00;
  private skipValidation: boolean = true;

  constructor(options: ZeroExTradeQuoterOptions){
    this.validateChainId(options.chainId);
    this.chainId = options.chainId;
    this.host = this.getHostForChain(options.chainId) as string;
    this.zeroExApiKey = options.zeroExApiKey;
  }

  async fetchTradeQuote(
    sellTokenAddress: Address,
    buyTokenAddress: Address,
    sellAmount: BigNumber,
    takerAddress: Address,
    isFirm: boolean) : Promise<ZeroExTradeQuote>
  {
    const url = `${this.host}${this.swapQuoteRoute}`;

    const params: ZeroExQueryParams = {
      sellToken: sellTokenAddress,
      buyToken: buyTokenAddress,
      slippagePercentage: this.slippagePercentage,
      sellAmount: sellAmount.toString(),
      takerAddress,
      excludedSources: this.excludedSources.join(","),
      skipValidation: this.skipValidation,
      feeRecipient: this.feeRecipientAddress,
      buyTokenPercentageFee: this.feePercentage,
      affiliateAddress: this.affiliateAddress,
      intentOnFilling: isFirm
    };

    try {
      const response = await axios.get(url, {
        params: params,
        headers: {
          "0x-api-key": this.zeroExApiKey,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
      });

      return {
        guaranteedPrice: parseFloat(response.data.guaranteedPrice),
        price: parseFloat(response.data.price),
        sellAmount: BigNumber.from(response.data.sellAmount),
        buyAmount: BigNumber.from(response.data.buyAmount),
        calldata: response.data.data
      }
    } catch(error) {
      throw new Error("ZeroEx quote request failed: " + error);
    }
  }

  private validateChainId(chainId: number) {
    if ( chainId === 1 || chainId === 137) return;
    throw new Error(`chainId ${chainId} is not supported`);
  }

  private getHostForChain(chainId: number){
    switch(chainId) {
      case 1: return "https://api.0x.org";
      case 137: return "https://polygon.api.0x.org";
    }
  }
}

/*async function main(){
  const zeroex = new ZeroExTradeQuoter({
    chainId: 137,
    zeroExApiKey: "ffc8bd0b-7faf-470f-b2ee-4611f44d422c"
  });

  let res = await zeroex.getQuote(
    "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2",
    "0x0bc529c00c6401aef6d220be8c6ea1667f6ad93e",
    BigNumber.from("999999061786586788130"),
    "0x0DEa6d942a2D8f594844F973366859616Dd5ea50",
    false
  );


  console.log('res --> ' + inspect(res));
}



main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(e);
    process.exit(1);
  })*/

/*
# Parameter List
    #
    # sellToken             The ERC20 token address or symbol of the token you want to send.
    #                           "ETH" can be provided as a valid sellToken.
    #
    # buyToken              The ERC20 token address or symbol of the token you want to receive.
    #                           "ETH" can be provided as a valid buyToken
    #
    # sellAmount            (Optional) The amount of sellToken (in sellToken base units) you want
    #                           to send.
    #
    # buyAmount             (Optional) The amount of buyToken (in buyToken base units) you want
    #                           to receive.
    #
    # slippagePercentage    (Optional) The maximum acceptable slippage in % of the buyToken amount
    #                           if sellAmount is provided, the maximum acceptableslippage in % of
    #                           the sellAmount amount if buyAmount is provided. This parameter will
    #                           change over time with market conditions.
    #
    # gasPrice              (Optional, defaults to ethgasstation "fast") The target gas price
    #                           (in wei) for the swap transaction. If the price is too low to
    #                           achieve the quote, an error will be returned.
    #
    # takerAddress          (Optional) The address which will fill the quote. When provided the gas
    #                           will be estimated and returned. An eth_call will also be performed.
    #                           If this fails a Revert Error will be returned in the response.
    #
    # excludedSources       (Optional) Liquidity sources (Eth2Dai, Uniswap, Kyber, 0x,
    #                           LiquidityProvider etc) that will not be included in the provided
    #                           quote. Ex: excludedSources=Uniswap,Kyber,Eth2Dai. See here for a
    #                           full list of sources
    #
    # includedSources       (Optional) For now only supports RFQT, which should be used when the
    #                           integrator only wants RFQT liquidity without any other DEX orders.
    #                           Requires a particular agreement with the 0x integrations team.
    #                           This parameter cannot be combined with excludedSources.
    #
    # skipValidation        (Optional) Normally, whenever a takerAddress is provided, the API will
    #                           validate the quote for the user. (For more details, see "How does
    #                           takerAddress help with catching issues?".) When this parameter is
    #                           set to true, that validation will be skipped. See also here.
    #
    # intentOnFilling       (Optional) Used to enable RFQ-T liquidity. For more details see the
    #                           guide Understanding RFQ-T and the 0x API.
    #
    # feeRecipient          (Optional) The ETH address that should receive affiliate fees specified
    #                           with buyTokenPercentageFee.
    #
    # buyTokenPercentageFee (Optional) The percentage (between 0 - 1.0) of the buyAmount that should
    #                           be attributed to feeRecipient as affiliate fees. Note that this
    #                           requires that the feeRecipient parameter is also specified in the request.
    #
    # affiliateAddress      (Optional) affiliateAddress for tracking
*/