import axios from "axios";
import { BigNumber } from "ethers";

import {inspect} from "util";

export type EthGasStationData = {
  average: number,
  fast: number,
  fastest: number
}

export type GasOracleSpeed = "average" | "fast" | "fastest";

export class GasOracleService {
  chainId: number;

  static AVERAGE: GasOracleSpeed = "average";
  static FAST: GasOracleSpeed = "fast";
  static FASTEST: GasOracleSpeed = "fastest";

  constructor(chainId: number) {
    this.validateChainId(chainId);
    this.chainId = chainId;
  }

  async fetchGasPrice(speed?: GasOracleSpeed): Promise<number> {
    switch(this.chainId) {
      case 1: return this.getEthereumGasPrice(speed);
      case 137: return this.getPolygonGasPrice(speed);

      // This case should never run because chainId is validated
      // Necessary to silence TS complaints about return sig
      default: return 0;
    }
  }

  private async getEthereumGasPrice(speed: GasOracleSpeed = "fast"): Promise<number> {
    const url = "https://ethgasstation.info/json/ethgasAPI.json"

    const data: EthGasStationData = (await axios.get(url)).data;

    // EthGasStation returns gas price in x10 Gwei (divite by 10 to convert it to gwei)
    switch(speed) {
      case GasOracleService.AVERAGE: return data.average / 10;
      case GasOracleService.FAST:    return data.fast / 10;
      case GasOracleService.FASTEST: return data.fastest / 10;
      default: throw new Error("speed: ${speed} is not supported");
    }
  }

  private async getPolygonGasPrice(speed: GasOracleSpeed = "fast"): Promise<number> {
    const url = "https://gasstation-mainnet.matic.network";

    const data = (await axios.get(url)).data;
    switch(speed) {
      case GasOracleService.AVERAGE: return data.standard;
      case GasOracleService.FAST:    return data.fast;
      case GasOracleService.FASTEST: return data.fastest;
      default: throw new Error("speed: ${speed} is not supported");
    }
  }

  private validateChainId(chainId: number) {
    if ( chainId === 1 || chainId === 137) return;
    throw new Error(`chainId ${chainId} is not supported`);
  }
}


/*async function main(){
  const service1 = new GasOracleService(1);
  let res = await service1.fetchGasPrice(GasOracleService.AVERAGE)
  console.log('ethereum --> ' + inspect(res));

  const service137 = new GasOracleService(137);
  res = await service137.fetchGasPrice();
  console.log('matic --> ' + inspect(res));
}



main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.log(e);
    process.exit(1);
  })*/
