# 0x-multichain-quote-sketch
WIP code to fetch 0x trade quotes for SetProtocol set components

### Setup

Create a `.env` file with:
```
INFURA_TOKEN=...
PRIVATE_KEY=...
ZERO_EX_API_KEY=...
```

Run `yarn`

### Run

```
# Get trade quote while impersonating DPI manager account
yarn dpi:forked

# These require code modifications to work around issues
yarn dpi:mainnet # comment out estimate logic and fake estimate
yarn bud:polygon # rewire to fake total supply numbers...
```

