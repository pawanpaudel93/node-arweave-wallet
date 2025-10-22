# node-arweave-wallet

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![License][license-src]][license-href]

Use Arweave browser wallets (Wander) from Node.js applications. Perfect for CLI tools and scripts that need wallet interactions.

## Installation

```bash
npm install node-arweave-wallet
# or
pnpm add node-arweave-wallet
# or
yarn add node-arweave-wallet
```

## Quick Start

```typescript
import { NodeArweaveWallet } from 'node-arweave-wallet'

// Create wallet instance with optional port configuration
const wallet = new NodeArweaveWallet({
  port: 3737 // Optional: defaults to 3737, use 0 for random port
})

// Initialize and open browser for wallet connection
await wallet.initialize()

// Connect with permissions
await wallet.connect([
  'ACCESS_ADDRESS',
  'SIGN_TRANSACTION'
])

// Get wallet address
const address = await wallet.getActiveAddress()
console.log('Connected wallet:', address)

// Clean up when done
await wallet.close()
```

## Configuration

### Port Configuration

You can configure the local server port when creating the wallet instance:

```typescript
// Use default port (3737)
const wallet = new NodeArweaveWallet()

// Use a specific port
const wallet = new NodeArweaveWallet({ port: 8080 })

// Use a random available port
const wallet = new NodeArweaveWallet({ port: 0 })
```

The consistent port ensures your application always runs on the same port, which is useful for:

- Development workflows
- Firewall configurations
- Browser extensions that whitelist specific ports
- Testing and debugging

## Features

- 🔐 Full Arweave Wallet API support
- 📱 Works with Wander, and compatible wallets
- 🚀 Simple async/await interface
- 📦 TypeScript support
- 🔄 Transaction signing and dispatch
- 📝 Data item signing (ANS-104)
- 🔒 Encryption/decryption support
- ✍️ Message signing and verification

## License

[MIT](./LICENSE) License © [Pawan Paudel](https://github.com/pawanpaudel93)

<!-- Badges -->

[npm-version-src]: https://img.shields.io/npm/v/node-arweave-wallet?style=flat&colorA=080f12&colorB=1fa669
[npm-version-href]: https://npmjs.com/package/node-arweave-wallet
[npm-downloads-src]: https://img.shields.io/npm/dm/node-arweave-wallet?style=flat&colorA=080f12&colorB=1fa669
[npm-downloads-href]: https://npmjs.com/package/node-arweave-wallet
[bundle-src]: https://img.shields.io/bundlephobia/minzip/node-arweave-wallet?style=flat&colorA=080f12&colorB=1fa669&label=minzip
[bundle-href]: https://bundlephobia.com/result?p=node-arweave-wallet
[license-src]: https://img.shields.io/github/license/pawanpaudel93/node-arweave-wallet.svg?style=flat&colorA=080f12&colorB=1fa669
[license-href]: https://github.com/pawanpaudel93/node-arweave-wallet/blob/main/LICENSE
[jsdocs-src]: https://img.shields.io/badge/jsdocs-reference-080f12?style=flat&colorA=080f12&colorB=1fa669
[jsdocs-href]: https://www.jsdocs.io/package/node-arweave-wallet
