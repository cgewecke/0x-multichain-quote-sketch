import axios from "axios";
const pageResults = require("graph-results-pager");
import {inspect} from "util";

export type CurrencyCodePriceMap = {
  [key: string]: number
}
export type CoinGeckoCoinPrices = {
  [key: string]: CurrencyCodePriceMap
}

export type CoinGeckoTokenData = {
  chainId: number,
  address: string,
  name: string,
  symbol: string,
  decimals: number,
  logoURI?: string,
}

export type SushiswapTokenData = CoinGeckoTokenData & {
  volumeUSD: number
}

export type CoinGeckoTokenMap = {
  [key: string]: CoinGeckoTokenData
}

export type CoinPricesParams = {
  contractAddresses: string[],
  vsCurrencies: string[]
}

type PolygonMappedTokenData = {
  [key: string]: string,
};

export const USD_CURRENCY_CODE = 'usd';
export const ETH_CURRENCY_CODE = 'eth';

const ETHEREUM_WETH_ADDRESS = "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2";
const POLYGON_WETH_ADDRESS = "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619";

export class CoinGeckoDataService {
  chainId: number;
  private coinPrices: CoinGeckoCoinPrices;
  private tokenList: CoinGeckoTokenData[] | undefined;
  private tokenMap: CoinGeckoTokenMap | undefined;


  constructor(chainId: number) {
    this.validateChainId(chainId);
    this.chainId = chainId;
  }

  async fetchCoinPrices(params: CoinPricesParams): Promise<CoinGeckoCoinPrices> {
    const platform = this.getPlatform();
    const endpoint = `https://api.coingecko.com/api/v3/simple/token_price/${platform}?`;
    const contractAddressParams = `contract_addresses=${params.contractAddresses.join(",")}`;
    const vsCurrenciesParams = `vs_currencies=${params.vsCurrencies.join(",")}`;

    const url = `${endpoint}${contractAddressParams}&${vsCurrenciesParams}`;

    const response = await axios.get(url);

    return response.data;
  }

  async fetchTokenList(): Promise<CoinGeckoTokenData[]> {
    if (this.tokenList !== undefined) return this.tokenList;

    switch(this.chainId) {
      case 1:
        this.tokenList = await this.fetchEthereumTokenList();
        break;
      case 137:
        this.tokenList = await this.fetchPolygonTokenList();
        break;
    }
    this.tokenMap = this.convertTokenListToAddressMap(this.tokenList);

    return this.tokenList!;
  }

  async fetchTokenMap(): Promise<CoinGeckoTokenMap> {
    if (this.tokenMap !== undefined) return this.tokenMap;

    this.tokenList = await this.fetchTokenList();
    this.tokenMap = this.convertTokenListToAddressMap(this.tokenList);

    return this.tokenMap;
  }

  private async fetchEthereumTokenList(): Promise<CoinGeckoTokenData[]> {
    const url = "https://tokens.coingecko.com/uniswap/all.json";
    const response = await axios.get(url);
    return response.data.tokens;
  }

  private async fetchPolygonTokenList(): Promise<CoinGeckoTokenData[]> {
    const coingeckoEthereumTokens = await this.fetchEthereumTokenList();
    const polygonMappedTokens = await this.fetchPolygonMappedTokenList();
    const sushiPolygonTokenList = await this.fetchSushiPolygonTokenList();
    const quickswapPolygonTokenList = await this.fetchQuickswapPolygonTokenList();

    for (const token of sushiPolygonTokenList) {
      const quickswapToken = quickswapPolygonTokenList.find(t => t.address.toLowerCase() === token.address);

      if (quickswapToken) {
        token.logoURI = quickswapToken.logoURI;
        continue;
      }

      const ethereumAddress = polygonMappedTokens[token.address];

      if (ethereumAddress !== undefined) {
        let ethereumToken = coingeckoEthereumTokens.find(t => t.address.toLowerCase() === ethereumAddress);

        if (ethereumToken) {
          token.logoURI = ethereumToken.logoURI;
        }
      }
    }

    return sushiPolygonTokenList;
  }

  private async fetchSushiPolygonTokenList() {
    let tokens: SushiswapTokenData[] = [];
    const url = "https://api.thegraph.com/subgraphs/name/sushiswap/matic-exchange";
    const properties = [
      'id',
      'symbol',
      'name',
      'decimals',
      'volumeUSD'
    ];

    const response = await pageResults({
      api: url,
      query: {
        entity: 'tokens',
        properties: properties
      },
    })

    for (const token of response) {
      tokens.push({
        chainId: 137,
        address: token.id,
        symbol: token.symbol,
        name: token.name,
        decimals: parseInt(token.decimals),
        volumeUSD: parseFloat(token.volumeUSD),
      });
    }

    // Sort by volume and filter out untraded tokens
    tokens.sort((a, b) => b.volumeUSD - a.volumeUSD);
    tokens = tokens.filter(t => t.volumeUSD > 0);

    return tokens;
  }

  private async fetchPolygonMappedTokenList() : Promise<PolygonMappedTokenData> {
    let offset = 0;
    const tokens: PolygonMappedTokenData = {};

    const url = "https://tokenmapper.api.matic.today/api/v1/mapping?";
    const params = "map_type=[%22POS%22]&chain_id=137&limit=200&offset=";

    while (true) {
      const response = await axios.get(`${url}${params}${offset}`);

      if (response.data.message === "success"){
        for (const token of response.data.data.mapping) {
          tokens[token.child_token.toLowerCase()] = token.root_token.toLowerCase();
        }

        if (response.data.data.has_next_page === true) {
          offset += 200;
          continue;
        }
      }
      break;
    }

    return tokens;
  }

  private async fetchQuickswapPolygonTokenList() : Promise<CoinGeckoTokenData[]> {
    const url = "https://raw.githubusercontent.com/sameepsi/" +
                "quickswap-default-token-list/master/src/tokens/mainnet.json";

    const data = (await axios.get(url)).data;
    return data;
  }

  private convertTokenListToAddressMap(list: CoinGeckoTokenData[] = []): CoinGeckoTokenMap {
    const tokenMap: CoinGeckoTokenMap = {};

    for (const entry of list) {
      tokenMap[entry.address] = Object.assign({}, entry);
    }

    return tokenMap;
  }

  private getPlatform(): string {
    switch(this.chainId) {
      case 1: return "ethereum";
      case 137: return "polygon-pos";
      default: return ""
    }
  }

  private validateChainId(chainId: number) {
    if ( chainId === 1 || chainId === 137) return;
    throw new Error(`chainId ${chainId} is not supported`);
  }
}

/*async function main(){
  const service = new CoinGeckoDataService(52);
  const res = await service.fetchCoinPrices()
  console.log(inspect(res));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(e);
    process.exit(1);
  })*/
