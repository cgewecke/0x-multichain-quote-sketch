# 0x-multichain-quote-sketch
WIP code to fetch 0x trade quotes for SetProtocol set components

### Run

```
# Run trade quote while impersonating DPI manager account
yarn dpi:forked

# Require code modifications to work around issues
yarn dpi:mainnet # comment out estimate logic and fake estimate
yarn bud:polygon # rewire to fake total supply numbers...
```

