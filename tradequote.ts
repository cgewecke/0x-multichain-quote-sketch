require("dotenv").config();

import axios from "axios";
import { BigNumber, FixedNumber, providers, Wallet } from "ethers";

import {
  CoinGeckoDataService,
  CoinGeckoCoinPrices,
  CoinGeckoTokenMap,
  USD_CURRENCY_CODE
} from "./coingecko";

import {
  GasOracleService
} from "./gasOracle";

import {
  ZeroExTradeQuoter
} from "./zeroex"

import Set from "set.js";

import {inspect} from "util";
const hre = require("hardhat");
const ethers = hre.ethers;
const network = hre.network;

const { TradeModule__factory } = require("@setprotocol/set-protocol-v2/dist/typechain/factories/TradeModule__factory");
// @ts-ignore
let tradeModule;

type Address = string;

const ExchangeTypes = {
  "ZERO_EX": "zeroex",
  "UNISWAP": "uniswap",
  "SUSHISWAP": "sushiswap",
  "QUICKSWAP": "quickswap",
}

const SCALE = BigNumber.from(10).pow(18);
const ETHEREUM_WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";

// Note: this WETH bridges "0xEeeeEE....";
const POLYGON_WETH_ADDRESS = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";

const UNSIWAPV2_ADAPTER_NAME = "UniswapV2ExchangeAdapter";
const SUSHISWAP_ADAPTER_NAME = "SushiswapExchangeAdapter";
const QUICKSWAP_ADAPTER_NAME = "QuickswapExchangeAdapter";
const ZERO_EX_ADAPTER_NAME = "ZeroExApiAdapterV3";
const UNKNOWN_ADAPTER_NAME = "Unknown";

export type QuoteOptions = {
  fromToken: Address,
  toToken: Address,
  rawAmount: string,
  fromAddress: Address,
  isFirm?: boolean,
  exchangeType?: string,
  chainId?: number,
}

export type ZeroExQuote = {
  fromTokenAmount: BigNumber,
  fromUnits: BigNumber,
  toTokenAmount: BigNumber
  toUnits: BigNumber,
  calldata: string
}

export type TokenResponse = {
  symbol: string,
  name: string,
  address: Address,
  decimals: number
}

export type TradeQuote = {
  from: Address,
  fromTokenAddress: Address,
  toTokenAddress: Address,
  exchangeAdapterName: string,
  calldata: string,
  gas: string,
  gasPrice: string,
  slippagePercentage: string,
  fromTokenAmount: string,
  toTokenAmount: string,
  display: {
    inputAmountRaw: string,
    inputAmount: string,
    quoteAmount: string,
    fromTokenDisplayAmount: string,
    toTokenDisplayAmount: string,
    fromTokenPriceUsd: string,
    toTokenPriceUsd: string,
    toToken: TokenResponse,
    fromToken: TokenResponse,
    gasCostsUsd: string,
    gasCostsChainCurrency: string,
    feePercentage: string,
    slippage: string
  }
}

export type TradeQuoteGeneratorOptions = {
  feePercentage: number,
  slippagePercentage: number,
  setjs: Set
  tokenMap: CoinGeckoTokenMap,
  coinPrices? : CoinGeckoCoinPrices,
  zeroExApiKey? : string
}

class TradeQuoteGenerator {
  private feePercentage: number;
  private slippagePercentage: number;
  private coinGecko: CoinGeckoDataService;
  private tokenMap: CoinGeckoTokenMap;
  private coinPrices: CoinGeckoCoinPrices | undefined;
  private cachedTokenListRepository: string;
  private setjs: Set;
  private zeroExClient: string;
  private cachedExchangeGasCostRepository: string;
  private tradeQuoteGasBuffer: number = 10;
  private exchangeTypeOverride: string = "zeroex";
  private zeroExApiKey: string;

  constructor(options: TradeQuoteGeneratorOptions){
    this.feePercentage = options.feePercentage;
    this.slippagePercentage = options.slippagePercentage;
    this.tokenMap = options.tokenMap;
    this.coinPrices = options.coinPrices;
    this.setjs = options.setjs;
    this.zeroExApiKey = options.zeroExApiKey || "";
  }

  async generate(options: QuoteOptions): Promise<TradeQuote> {
    const isFirm = options.isFirm || false;
    const exchangeType = options.exchangeType || this.exchangeTypeOverride;
    const chainId = options.chainId || 1;
    const exchangeAdapterName = this.getExchangeAdapterName(exchangeType);

    const {
      fromTokenAddress,
      toTokenAddress,
      fromAddress
    } = this.sanitizeAddress(options.fromToken, options.toToken, options.fromAddress);

    const amount = this.sanitizeAmount(fromTokenAddress, options.rawAmount);

    const setOnChainDetails = await this.setjs.setToken.fetchSetDetailsAsync(
      fromAddress, [fromTokenAddress, toTokenAddress]
    );

    const fromTokenRequestAmount = this.calculateFromTokenAmount(
      setOnChainDetails,
      fromTokenAddress,
      amount
    );

    const {
      fromTokenAmount,
      fromUnits,
      toTokenAmount,
      toUnits,
      calldata
    } = await this.fetchZeroExQuote( // fetchQuote (and switch...)
      fromTokenAddress,
      toTokenAddress,
      fromTokenRequestAmount,
      setOnChainDetails.manager,
      (setOnChainDetails as any).totalSupply, // Typings incorrect,
      chainId
    );

    // Sanity check response from quote APIs
    this.validateQuoteValues(
      setOnChainDetails,
      fromTokenAddress,
      toTokenAddress,
      fromUnits,
      toUnits
    );

    const gas = await this.estimateGasCost(
      fromTokenAddress,
      fromUnits,
      toTokenAddress,
      toUnits,
      exchangeAdapterName,
      fromAddress,
      calldata,
      setOnChainDetails.manager
    );

    const coinGecko = new CoinGeckoDataService(chainId);
    const coinPrices = await coinGecko.fetchCoinPrices({
      contractAddresses: [this.chainCurrencyAddress(chainId), fromTokenAddress, toTokenAddress],
      vsCurrencies: [ USD_CURRENCY_CODE, USD_CURRENCY_CODE, USD_CURRENCY_CODE ]
    });

    const gasOracle = new GasOracleService(chainId);
    const gasPrice = await gasOracle.fetchGasPrice();

    return {
      from: fromAddress,
      fromTokenAddress,
      toTokenAddress,
      exchangeAdapterName,
      calldata,
      gas: gas.toString(),
      gasPrice: gasPrice.toString(),
      slippagePercentage: this.formatAsPercentage(this.slippagePercentage),
      fromTokenAmount: fromUnits.toString(),
      toTokenAmount: toUnits.toString(),
      display: {
        inputAmountRaw: options.rawAmount,
        inputAmount: amount.toString(),
        quoteAmount: fromTokenRequestAmount.toString(),
        fromTokenDisplayAmount: this.tokenDisplayAmount(fromTokenAmount, fromTokenAddress),
        toTokenDisplayAmount: this.tokenDisplayAmount(toTokenAmount, toTokenAddress),
        fromTokenPriceUsd: this.tokenPriceUsd(fromTokenAmount, fromTokenAddress, coinPrices),
        toTokenPriceUsd: this.tokenPriceUsd(toTokenAmount, toTokenAddress, coinPrices),
        toToken: this.tokenResponse(toTokenAddress),
        fromToken: this.tokenResponse(fromTokenAddress),
        gasCostsUsd: this.gasCostsUsd(gasPrice, gas, coinPrices, chainId),
        gasCostsChainCurrency: this.gasCostsChainCurrency(gasPrice, gas, chainId),
        feePercentage: this.formatAsPercentage(this.feePercentage),
        slippage: this.calculateSlippage(
          fromTokenAmount,
          toTokenAmount,
          fromTokenAddress,
          toTokenAddress,
          coinPrices
        )
      }
    };
  }

  private getExchangeAdapterName(exchangeType: string) {
    switch (exchangeType) {
      case ExchangeTypes.ZERO_EX: return ZERO_EX_ADAPTER_NAME;
      case ExchangeTypes.UNISWAP: return UNSIWAPV2_ADAPTER_NAME;
      case ExchangeTypes.SUSHISWAP: return SUSHISWAP_ADAPTER_NAME;
      case ExchangeTypes.QUICKSWAP: return QUICKSWAP_ADAPTER_NAME;
      default: return UNKNOWN_ADAPTER_NAME;
    }
  }

  private sanitizeAddress(fromToken: Address, toToken: Address, fromAddress: Address) {
    return {
      fromTokenAddress: fromToken.toLowerCase(),
      toTokenAddress: toToken.toLowerCase(),
      fromAddress: fromAddress.toLowerCase()
    };
  }

  private sanitizeAmount(fromTokenAddress: Address, rawAmount: string): BigNumber {
    const decimals = this.tokenMap[fromTokenAddress].decimals;
    return ethers.utils.parseUnits(rawAmount, decimals);
  }

  private async fetchZeroExQuote(
    fromTokenAddress: Address,
    toTokenAddress: Address,
    fromTokenRequestAmount: BigNumber,
    manager: Address,
    setTotalSupply: BigNumber,
    chainId: number,
  ) {
    const zeroEx = new ZeroExTradeQuoter({
      chainId: chainId,
      zeroExApiKey: this.zeroExApiKey
    });

    const isFirmQuote = false; // TODO: MAKE TRUE!!!

    const quote = await zeroEx.fetchTradeQuote(
      fromTokenAddress,
      toTokenAddress,
      fromTokenRequestAmount,
      manager,
      isFirmQuote
    );

    const fromTokenAmount = quote.sellAmount;
    const fromUnits = (fromTokenAmount.mul(SCALE)).div(setTotalSupply);

    const toTokenAmount = quote.buyAmount;

    // BigNumber does not do fixed point math & FixedNumber underflows w/ numbers less than 1
    // Multiply the slippage by a factor and divide the end result by same...
    const percentMultiplier = 1000;
    const slippageToleranceBN = percentMultiplier * this.outputSlippageTolerance();
    const toTokenAmountMinusSlippage = toTokenAmount.mul(slippageToleranceBN).div(percentMultiplier);

    const toUnits = toTokenAmountMinusSlippage.mul(SCALE).div(setTotalSupply)

    return {
      fromTokenAmount,
      fromUnits,
      toTokenAmount,
      toUnits,
      calldata: quote.calldata
    }
  }

  private validateQuoteValues(
    setOnChainDetails: any,
    fromTokenAddress: Address,
    toTokenAddress: Address,
    quoteFromRemainingUnits: BigNumber,
    quoteToUnits: BigNumber
  ) {
    // fromToken
    const positionForFromToken = setOnChainDetails
      .positions
      .find((p: any) => p.component.toLowerCase() === fromTokenAddress.toLowerCase());

    const currentPositionUnits = BigNumber.from(positionForFromToken.unit);
    const remainingPositionUnits = currentPositionUnits.sub(quoteFromRemainingUnits);
    const remainingPositionUnitsTooSmall = remainingPositionUnits.gt(0) && remainingPositionUnits.lt(50);

    if (remainingPositionUnitsTooSmall){
      throw new Error("Remaining units too small, incorrectly attempting max");
    }

    // toToken
    const positionForToToken = setOnChainDetails
      .positions
      .find((p: any) => p.component.toLowerCase() === toTokenAddress.toLowerCase());

    const newToPositionUnits = (positionForToToken !== undefined)
      ? positionForToToken.unit.add(quoteToUnits)
      : quoteToUnits;

    const newToUnitsTooSmall = newToPositionUnits.gt(0) && newToPositionUnits.lt(50);

    if (newToUnitsTooSmall) {
      throw new Error("Receive units too small");
    }
  }

  private calculateFromTokenAmount(
    setOnChainDetails: any,
    fromTokenAddress: Address,
    amount: BigNumber
  ): BigNumber {
    const positionForFromToken = setOnChainDetails
      .positions
      .find((p: any) => p.component.toLowerCase() === fromTokenAddress.toLowerCase());

    if (positionForFromToken === undefined) {
      throw new Error("Invalid fromToken input");
    }

    const totalSupply = setOnChainDetails.totalSupply;
    const impliedMaxNotional = positionForFromToken.unit.mul(totalSupply).div(SCALE); // .floor;
    const isGreaterThanMax = amount.gt(impliedMaxNotional);
    const isMax = amount.eq(impliedMaxNotional);

    if (isGreaterThanMax) {
      throw new Error("Amount is greater than quantity of component in Set");
    } else if (isMax) {
      return impliedMaxNotional.toString();
    } else {
      // ((amount * SCALE / totalsupply).floor * totalsupply / SCALE).floor
      const amountMulScaleOverTotalSupply = amount.mul(SCALE).div(totalSupply); // .floor;
      const totalSupplyOverScale = totalSupply.div(SCALE);
      return amountMulScaleOverTotalSupply.mul(totalSupplyOverScale); // .floor;
    }
  }

  private tokenDisplayAmount(amount: BigNumber, address: Address): string {
    return this.normalizeTokenAmount(amount, address).toString()
  }

  private tokenResponse(address: Address) : TokenResponse {
    const tokenEntry = this.tokenMap[address];
    return {
      symbol: tokenEntry.symbol,
      name: tokenEntry.name,
      address,
      decimals: tokenEntry.decimals
    }
  }

  private chainCurrencyAddress(chainId: number): Address {
    switch(chainId) {
      case 1:   return "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"; // WETH
      case 137: return "0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270"; // WMATIC
      default: throw new Error(`chainId: ${chainId} is not supported`);
    }
  }

  private normalizeTokenAmount(amount: BigNumber, address: Address): number {
    const tokenScale = BigNumber.from(10).pow(this.tokenMap[address].decimals);
    return FixedNumber.from(amount).divUnsafe(FixedNumber.from(tokenScale)).toUnsafeFloat();
  }

  private tokenPriceUsd(amount: BigNumber, address: Address, coinPrices: CoinGeckoCoinPrices): string {
    const coinPrice = coinPrices[address][USD_CURRENCY_CODE];
    const normalizedAmount = this.normalizeTokenAmount(amount, address) * coinPrice;
    return new Intl.NumberFormat('en-US', {style: 'currency', currency: 'USD'}).format(normalizedAmount);
  }

  private formatAsPercentage(percentage: number): string {
    return percentage.toFixed(2)+"%";
  }

  private totalGasCost(gasPrice: number, gas: number): number {
    return (gasPrice / 1e9) * gas;
  }

  private gasCostsUsd(
    gasPrice: number,
    gas: number,
    coinPrices: CoinGeckoCoinPrices,
    chainId: number
  ): string {
    const totalGasCost = this.totalGasCost(gasPrice, gas);
    const chainCurrencyAddress = this.chainCurrencyAddress(chainId);
    const coinPrice = coinPrices[chainCurrencyAddress][USD_CURRENCY_CODE];
    const cost = totalGasCost * coinPrice;
    const maximumSignificantDigits = (chainId === 137) ? 7 : 2;

    return new Intl.NumberFormat(
      'en-US',
      {style: 'currency', currency: 'USD', maximumSignificantDigits }
    ).format(cost);
  }

  private gasCostsChainCurrency(gasPrice: number, gas: number, chainId: number): string {
    const chainCurrency = this.chainCurrency(chainId);
    const totalGasCostText = this.totalGasCost(gasPrice, gas).toFixed(7).toString();
    return `${totalGasCostText} ${chainCurrency}`;
  }

  private chainCurrency(chainId: number): string {
    switch(chainId) {
      case 1:   return "ETH";
      case 137: return "MATIC";
      default:  return "";
    }
  }

  private async estimateGasCost(
    fromTokenAddress: Address,
    fromTokenUnits: BigNumber,
    toTokenAddress: Address,
    toTokenUnits: BigNumber,
    adapterName: string,
    fromAddress: Address,
    calldata: string,
    managerAddress: Address
  ) : Promise<number> {
    try {
      // This method needs to be added to the trade API at set.js
      // @ts-ignore
      const gas = await tradeModule.estimateGas.trade(
        fromAddress,
        adapterName,
        fromTokenAddress,
        fromTokenUnits,
        toTokenAddress,
        toTokenUnits,
        calldata,
        //managerAddress
      );

      const gasCostBuffer = (100 + this.tradeQuoteGasBuffer) / 100;
      return Math.floor(gas * gasCostBuffer);
    } catch (e) {
      console.log('e --> ' + e);
      throw new Error("Unable to fetch gas cost estimate for trade");
    }
  }

  private calculateSlippage(
    fromTokenAmount: BigNumber,
    toTokenAmount: BigNumber,
    fromTokenAddress: Address,
    toTokenAddress: Address,
    coinPrices: CoinGeckoCoinPrices
  ) : string {
    const fromTokenPriceUsd = coinPrices[fromTokenAddress][USD_CURRENCY_CODE];
    const toTokenPriceUsd = coinPrices[toTokenAddress][USD_CURRENCY_CODE];

    const fromTokenTotalUsd = this.normalizeTokenAmount(fromTokenAmount, fromTokenAddress) * fromTokenPriceUsd;
    const toTokenTotalUsd = this.normalizeTokenAmount(toTokenAmount, toTokenAddress) * toTokenPriceUsd;

    const slippageRaw = (fromTokenTotalUsd - toTokenTotalUsd) / fromTokenTotalUsd;
    return this.formatAsPercentage(slippageRaw * 100);
  }

  private outputSlippageTolerance() : number {
    return (100 - this.slippagePercentage) / 100;
  }
}

// TODO:
// Do gas estimation....
// Port to set.js
// Comments
// Tests
// Publish

async function main(){
  const config = {
    ethersProvider: ethers.provider,
    basicIssuanceModuleAddress: "0xd8EF3cACe8b4907117a45B0b125c68560532F94D",
    controllerAddress: "0xa4c8d221d8BB851f83aadd0223a8900A6921A349",
    masterOracleAddress: "0xA60f9e1641747762aDE7FD5F881b90B691E92B0a",
    navIssuanceModuleAddress: "0xaB9a964c6b95fA529CA7F27DAc1E7175821f2334",
    protocolViewerAddress: "0x74391125304f1e4ce11bDb8aaAAABcF3A3Ae2f41",
    setTokenCreatorAddress: "0x8cb9e7bdd78926933fc9d19f5f69fefc2b737087",
    streamingFeeModuleAddress: "0x08f866c74205617B6F3903EF481798EcED10cDEC",
    tradeModuleAddress: "0x90F765F63E7DC5aE97d6c576BF693FB6AF41C129",
    governanceModuleAddress: "0x5C87b042494cDcebA44C541fbB3BC8bFF179d500",
    debtIssuanceModuleAddress: "0x39F024d621367C044BacE2bf0Fb15Fb3612eCB92",
  }

  const DPI_MANAGER = "0x0dea6d942a2d8f594844f973366859616dd5ea50";

  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [DPI_MANAGER],
  });

  tradeModule = TradeModule__factory.connect(
    config.tradeModuleAddress,
    ethers.provider.getSigner(DPI_MANAGER)
  );

  const setjs = new Set(config);
  const coingecko = new CoinGeckoDataService(1);

  const generator = new TradeQuoteGenerator({
    feePercentage: 0,
    slippagePercentage: 2,
    tokenMap: await coingecko.fetchTokenMap(),
    coinPrices: {},
    setjs,
    zeroExApiKey: process.env.ZERO_EX_API_KEY,
  });

  const quote = await generator.generate({
    fromToken: "0x9f8f72aa9304c8b593d555f12ef6589cc3a579a2", // MKR
    toToken: "0x0bc529c00C6401aEF6D220BE8C6Ea1667F6Ad93e", // YFI
    rawAmount: "1",
    fromAddress: "0x1494ca1f11d487c2bbe4543e90080aeba4ba3c2b", // DPI
    exchangeType: "zeroex",
    chainId: 1
  });

  // POLYGON....
  /*const config = {
    ethersProvider: ethers.provider,
    basicIssuanceModuleAddress: "0xE99447aBbD5A7730b26D2D16fCcB2086319e4bC3", //
    controllerAddress: "0x719E5B865dE407bf38647C1625D193E0CE42111D", //
    masterOracleAddress: "0x0000000000000000000000000000000000000000",
    navIssuanceModuleAddress: "0xb795Ef471e31610739FE9dab06E2D91024f4048E", //
    protocolViewerAddress: "0x84D5657347cC2beD0A4D6a82c0A6f3bE1a021cc6", //
    setTokenCreatorAddress: "0xCF786472d37f557A80fE6daFF6f2672bfDa728a3", //
    streamingFeeModuleAddress: "0x2f8FF0546a478DF380f975cA035B95DF82377721", //
    tradeModuleAddress: "0x4F70287526ea9Ba7e799D616ea86635CdAf0de4F",
    governanceModuleAddress: "0x0000000000000000000000000000000000000000",
    debtIssuanceModuleAddress: "0x0000000000000000000000000000000000000000", //
  }

  const setjs = new Set(config);
  const coingecko = new CoinGeckoDataService(137);

  const generator = new TradeQuoteGenerator({
    feePercentage: 1,
    slippagePercentage: 2,
    tokenMap: await coingecko.fetchTokenMap(),
    coinPrices: {},
    setjs,
    zeroExApiKey: "ffc8bd0b-7faf-470f-b2ee-4611f44d422c",
  });

  const quote = await generator.generate({
    fromToken: "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC
    toToken: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", // BTC
    rawAmount: "1",
    fromAddress: "0xD7Dc13984d4FE87F389E50067fB3Eedb3F704Ea0", // BUD
    exchangeType: "zeroex",
    chainId: 137
  });*/

  console.log(inspect(quote));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(e.stack);
    process.exit(1);
  })