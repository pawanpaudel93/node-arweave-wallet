# node-arweave-wallet

[![npm version][npm-version-src]][npm-version-href]
[![npm downloads][npm-downloads-src]][npm-downloads-href]
[![bundle][bundle-src]][bundle-href]
[![JSDocs][jsdocs-src]][jsdocs-href]
[![License][license-src]][license-href]

Use Arweave browser wallets ([Wander](https://wander.app) or any other compatible wallet) from Node.js applications. Perfect for CLI tools and scripts that need secure wallet interactions without exposing private keys.

## ✨ Features

- 🔐 **Full Arweave Wallet API Support** - Complete implementation of the arweaveWallet API
- 🌐 **Browser-Based Security** - Uses your existing browser wallet (Wander or any other compatible wallet), keeping keys secure
- 🔌 **@permaweb/aoconnect Compatible** - Works seamlessly with `@permaweb/aoconnect`

## 📦 Installation

```bash
npm install node-arweave-wallet
# or
pnpm add node-arweave-wallet
# or
yarn add node-arweave-wallet
```

## 🚀 Quick Start

```typescript
import Arweave from 'arweave'
import { NodeArweaveWallet } from 'node-arweave-wallet'

const arweave = new Arweave({
  host: 'arweave.net',
  port: 443,
  protocol: 'https',
})

// Create wallet instance
const wallet = new NodeArweaveWallet({
  port: 3737, // Optional: defaults to 3737, use 0 for random port
})

// Initialize - opens browser for wallet connection
await wallet.initialize()

// Connect with required permissions
await wallet.connect(['ACCESS_ADDRESS', 'SIGN_TRANSACTION'])

// Get wallet address
const address = await wallet.getActiveAddress()
console.log('Connected wallet:', address)

// Sign a transaction
const tx = await arweave.createTransaction({ data: 'Hello Arweave!' })
await wallet.sign(tx)

// Submit the transaction
const response = await arweave.transactions.post(tx)
console.log(response.status)

// Clean up when done
await wallet.close('success')
```

## 📖 API Reference

### Initialization & Connection

#### `new NodeArweaveWallet(config?)`

Creates a new wallet instance.

```typescript
const wallet = new NodeArweaveWallet({
  port: 3737,              // Optional: port number (default: 3737, use 0 for random)
  freePort: false,         // Optional: auto-free port if in use (default: false)
  requestTimeout: 300000,  // Optional: request timeout in ms (default: 5 minutes)
  browser: 'chrome',       // Optional: specify browser (default: system default)
  browserProfile: 'Work',  // Optional: specify browser profile
})
```

See [Configuration](#️-configuration) for more information.

#### `wallet.initialize()`

Starts the local server and opens the browser for wallet connection.

```typescript
await wallet.initialize()
```

#### `wallet.close(status?)`

Closes the wallet connection and server. Optionally marks completion status.

```typescript
await wallet.close('success') // or 'failed'
```

### Wallet APIs

#### `wallet.connect(permissions, appInfo?, gateway?)`

Connects to the wallet with specified permissions, app info and gateway.

```typescript
await wallet.connect(['ACCESS_ADDRESS', 'SIGN_TRANSACTION'], {
  name: 'My App',
  logo: 'https://arweave.net/azW8iYR5A6bPXyS6WpMmw-qLTXNleS-vv4LJDR9Hf-s',
})
```

**Available Permissions:**

- `ACCESS_ADDRESS` - Get active wallet address
- `ACCESS_PUBLIC_KEY` - Get public key
- `ACCESS_ALL_ADDRESSES` - Get all wallet addresses
- `SIGN_TRANSACTION` - Sign Arweave transactions
- `ENCRYPT` - Encrypt data
- `DECRYPT` - Decrypt data
- `SIGNATURE` - Sign arbitrary data
- `ACCESS_ARWEAVE_CONFIG` - Get Arweave gateway config
- `DISPATCH` - Sign and dispatch transactions
- `ACCESS_TOKENS` - Access tokens & token balances

#### `wallet.disconnect()`

Disconnects from the wallet.

```typescript
await wallet.disconnect()
```

#### `wallet.getActiveAddress()`

Gets the currently active wallet address.

```typescript
const address = await wallet.getActiveAddress()
// Returns: "xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

#### `wallet.getAllAddresses()`

Gets all addresses in the wallet.

```typescript
const addresses = await wallet.getAllAddresses()
// Returns: ["address1", "address2", ...]
```

#### `wallet.getWalletNames()`

Gets wallet names mapped to addresses.

```typescript
const names = await wallet.getWalletNames()
// Returns: { "address1": "Wallet 1", "address2": "Wallet 2" }
```

#### `wallet.getActivePublicKey()`

Gets the public key of the active wallet.

```typescript
const publicKey = await wallet.getActivePublicKey()
// Returns: base64 encoded public key
```

#### `wallet.getPermissions()`

Gets currently granted permissions.

```typescript
const permissions = await wallet.getPermissions()
// Returns: ["ACCESS_ADDRESS", "SIGN_TRANSACTION", ...]
```

#### `wallet.getArweaveConfig()`

Gets the Arweave gateway configuration.

```typescript
const config = await wallet.getArweaveConfig()
// Returns: { host: "arweave.net", port: 443, protocol: "https" }
```

#### `wallet.sign(transaction, options?)`

Signs an Arweave transaction.

```typescript
import Arweave from 'arweave'

const arweave = new Arweave({
  host: 'arweave.net',
  port: 443,
  protocol: 'https',
})

const tx = await arweave.createTransaction({
  data: 'Hello Arweave!',
})

await wallet.sign(tx)
```

#### `wallet.dispatch(transaction, options?)`

Signs and dispatches a transaction to the network.

```typescript
const tx = await arweave.createTransaction({
  data: 'Hello Arweave!',
})
tx.addTag('Content-Type', 'text/plain')

const result = await wallet.dispatch(tx)
console.log('Transaction ID:', result.id)
// Returns: { id: "transaction_id", type?: "BASE" | "BUNDLED" }
```

#### `wallet.signDataItem(dataItem, options?)`

Signs a single data item for ANS-104 bundling.

```typescript
const signedDataItem = await wallet.signDataItem({
  data: 'Hello from data item!',
  tags: [
    { name: 'Content-Type', value: 'text/plain' },
    { name: 'App-Name', value: 'MyApp' },
  ],
  target: 'target_address'
})

// Returns: Uint8Array of signed data item
```

#### `wallet.batchSignDataItem(dataItems, options?)`

Signs multiple data items in a batch.

```typescript
const results = await wallet.batchSignDataItem([
  {
    data: 'First item',
    tags: [{ name: 'Type', value: 'Test1' }],
  },
  {
    data: 'Second item',
    tags: [{ name: 'Type', value: 'Test2' }],
  },
])

// Returns: Array<{ id: string, raw: Uint8Array }>
```

#### `wallet.encrypt(data, options)`

Encrypts data using the wallet's public key.

```typescript
const encrypted = await wallet.encrypt('Secret message', {
  algorithm: 'RSA-OAEP',
  hash: 'SHA-256',
})

// Returns: Uint8Array
```

#### `wallet.decrypt(data, options)`

Decrypts data using the wallet's private key.

```typescript
const decrypted = await wallet.decrypt(encrypted, {
  algorithm: 'RSA-OAEP',
  hash: 'SHA-256',
})

const text = new TextDecoder().decode(decrypted)
// Returns: "Secret message"
```

#### `wallet.signMessage(data, options?)`

Signs a message with the wallet's private key.

```typescript
const data = new TextEncoder().encode('Message to sign')
const signature = await wallet.signMessage(data, {
  hashAlgorithm: 'SHA-256', // or 'SHA-384', 'SHA-512'
})

// Returns: Uint8Array signature
```

#### `wallet.verifyMessage(data, signature, publicKey?, options?)`

Verifies a message signature.

```typescript
const isValid = await wallet.verifyMessage(
  data,
  signature,
  publicKey, // optional
  { hashAlgorithm: 'SHA-256' },
)

// Returns: boolean
```

#### `wallet.signature(data, algorithm)`

Signs arbitrary data with custom algorithm.

```typescript
const data = new TextEncoder().encode('Data to sign')
const signature = await wallet.signature(data, {
  name: 'RSA-PSS',
  saltLength: 32,
})

// Returns: Uint8Array
```

#### `wallet.privateHash(data, options?)`

Creates a hash using the wallet's private key.

```typescript
const data = new TextEncoder().encode('Data to hash')
const hash = await wallet.privateHash(data, {
  hashAlgorithm: 'SHA-256',
})

// Returns: Uint8Array
```

#### `wallet.tokenBalance(id)`

Gets the balance for a specific token.

```typescript
const balance = await wallet.tokenBalance('7GoQfmSOct_aUOWKM4xbKGg6DzAmOgdKwg8Kf-CbHm4')
// Returns: string (balance as string representation)

// Convert to number if needed
const numericBalance = Number(balance)
```

#### `wallet.userTokens(options?)`

Gets all tokens owned by the user.

```typescript
// Get tokens without balance
const tokens = await wallet.userTokens({ fetchBalance: false })

// Get tokens with balance
const tokensWithBalance = await wallet.userTokens({ fetchBalance: true })

// Returns: Array<TokenInfo>
// TokenInfo: {
//  id?: string
//  Name?: string
//  Ticker?: string
//  Logo?: string
//  Denomination: number
//  processId: string
//  lastUpdated?: string | null
//  type?: 'asset' | 'collectible'
//  hidden?: boolean
//  balance?: string
// }
```

#### `wallet.getWanderTierInfo()`

Gets Wander wallet tier information (Wander wallet specific feature).

```typescript
const tierInfo = await wallet.getWanderTierInfo()

// Returns: {
//   tier: 'Prime' | 'Edge' | 'Reserve' | 'Select' | 'Core'
//   balance: string
//   rank: '' | number
//   progress: number  // 0 to 1
//   snapshotTimestamp: number
//   totalHolders: number
// }

console.log(`Tier: ${tierInfo.tier}`)
console.log(`Progress: ${tierInfo.progress.toFixed(2)}%`)
console.log(`Total Holders: ${tierInfo.totalHolders}`)
```

## 🛠️ Configuration

### Port Configuration

The package uses a local HTTP server to communicate with the browser. You can configure the port:

```typescript
// Default port (3737)
const wallet = new NodeArweaveWallet()

// Custom port
const wallet = new NodeArweaveWallet({ port: 8080 })

// Random available port (useful for testing or avoiding conflicts)
const wallet = new NodeArweaveWallet({ port: 0 })
```

### Automatic Port Freeing

If your desired port is already in use, you can enable automatic port freeing to free it up and retry:

```typescript
const wallet = new NodeArweaveWallet({ freePort: true })
```

### Request Timeout Configuration

You can configure how long the wallet will wait for user responses before timing out. This is useful if you need more time to review transactions or if you want faster failures:

```typescript
// Default timeout (5 minutes = 300000ms)
const wallet = new NodeArweaveWallet()

// Custom timeout (10 minutes)
const wallet = new NodeArweaveWallet({ 
  requestTimeout: 600000 // 10 minutes in milliseconds
})

// Shorter timeout (1 minute) for faster failures
const wallet = new NodeArweaveWallet({ 
  requestTimeout: 60000 // 1 minute in milliseconds
})

// All options together
const wallet = new NodeArweaveWallet({
  port: 3737,
  freePort: true,
  requestTimeout: 300000, // 5 minutes
})
```

**Note:** The timeout applies to individual wallet operations (signing, encrypting, etc.). If the user doesn't respond within this time, the operation will fail with a timeout error.

**Browser Options:**

You can specify which browser to open for wallet connection:

```typescript
// Use a specific browser by name
const wallet = new NodeArweaveWallet({ browser: 'chrome' })    // Google Chrome
const wallet = new NodeArweaveWallet({ browser: 'firefox' })   // Firefox
const wallet = new NodeArweaveWallet({ browser: 'edge' })      // Microsoft Edge
const wallet = new NodeArweaveWallet({ browser: 'brave' })     // Brave Browser
const wallet = new NodeArweaveWallet({ browser: 'opera' })     // Opera

// Disable auto-opening (you'll need to open the URL manually)
const wallet = new NodeArweaveWallet({ browser: false })
```

**Browser Profile Options:**

You can also specify a browser profile to use:

```typescript
// Chromium-based browsers (Chrome, Edge, Brave, Opera, Vivaldi)
// Use profile directory name OR display name (auto-resolved)
const wallet = new NodeArweaveWallet({ 
  browser: 'chrome',
  browserProfile: 'Profile 1'  // or 'Default', 'Profile 2', 'Work', 'Personal', etc.
})

// Firefox-based browsers (Firefox, Zen)
// Use profile name exactly as shown in profile manager
const wallet = new NodeArweaveWallet({ 
  browser: 'firefox',
  browserProfile: 'dev-edition-default'  // or your custom profile name
})

// Opera (Note: Opera doesn't support profile arguments, profile option is ignored)
const wallet = new NodeArweaveWallet({ 
  browser: 'opera'
  // browserProfile is not supported for Opera
})
```

**Important:** The library automatically resolves display names to directory names for some Chromium-based browsers!

- **Chrome/Edge/Brave/Vivaldi:** You can use either the display name ("Work") or directory name ("Profile 2")
- **Firefox/Zen:** Use the profile name exactly as shown in the profile manager
- **Opera:** Profile selection is not supported (profile option is ignored)

**How to find your profile name:**

1. **Chrome/Edge/Brave/Vivaldi:**
   - Open `chrome://version/` (or `edge://version/`, `brave://version/`, `vivaldi://version/`)
   - Look for "Profile Path"
   - You can use either:
     - The display name shown in the browser UI: `'Work'`, `'Personal'`
     - The directory name (last part of path): `'Default'`, `'Profile 1'`, `'Profile 2'`

2. **Firefox/Zen:**
   - Run `firefox -P` (or `zen -P`) to open the profile manager
   - Use the exact profile name shown (e.g., `'default-release'`, `'dev-edition-default'`)

3. **Opera:**
   - Profile selection is not supported by Opera's command-line interface

## 💡 Usage Examples

### CLI Tool Example

```typescript
#!/usr/bin/env node
import fs from 'node:fs'
import process from 'node:process'
import Arweave from 'arweave'
import { NodeArweaveWallet } from 'node-arweave-wallet'

async function deployFile(filePath: string) {
  const wallet = new NodeArweaveWallet()

  try {
    console.log('🚀 Initializing wallet...')
    await wallet.initialize()

    await wallet.connect(['ACCESS_ADDRESS', 'SIGN_TRANSACTION', 'DISPATCH'])

    const address = await wallet.getActiveAddress()
    console.log(`✅ Connected: ${address}`)

    const arweave = new Arweave({
      host: 'arweave.net',
      port: 443,
      protocol: 'https',
    })

    const data = fs.readFileSync(filePath)
    const tx = await arweave.createTransaction({ data })
    tx.addTag('Content-Type', 'text/plain')

    console.log('📝 Signing and deploying...')
    const result = await wallet.dispatch(tx)

    console.log(`✅ Deployed! TX: ${result.id}`)
    console.log(`🔗 https://arweave.net/${result.id}`)

    await wallet.close('success')
  } catch (error) {
    console.error('❌ Error:', error.message)
    await wallet.close('failed')
    process.exit(1)
  }
}

deployFile(process.argv[2])
```

### AO Process Example

```typescript
import { message, result } from '@permaweb/aoconnect'
import { createDataItemSigner, NodeArweaveWallet } from 'node-arweave-wallet'

async function sendAOMessage() {
  const wallet = new NodeArweaveWallet()
  await wallet.initialize()
  await wallet.connect(['ACCESS_ADDRESS', 'SIGN_TRANSACTION'])

  const signer = createDataItemSigner(wallet)

  const messageId = await message({
    process: 'PROCESS_ID',
    signer,
    tags: [{ name: 'Action', value: 'Balance' }],
  })

  console.log('Message sent:', messageId)

  const { Messages } = await result({
    message: messageId,
    process: 'PROCESS_ID',
  })

  console.log('Response:', Messages[0].Data)

  await wallet.close('success')
}
```

### Batch Data Item Example

```typescript
import fs from 'node:fs'
import path from 'node:path'
import { NodeArweaveWallet } from 'node-arweave-wallet'

async function batchUpload(files: string[]) {
  const wallet = new NodeArweaveWallet()
  await wallet.initialize()
  await wallet.connect(['ACCESS_ADDRESS', 'SIGN_TRANSACTION'])

  const dataItems = files.map(file => ({
    data: fs.readFileSync(file),
    tags: [
      { name: 'Content-Type', value: 'application/octet-stream' },
      { name: 'File-Name', value: path.basename(file) },
    ],
  }))

  console.log(`📝 Signing ${files.length} files...`)
  const signed = await wallet.batchSignDataItem(dataItems)

  console.log('✅ All files signed!')
  signed.forEach((item, i) => {
    console.log(`   ${i + 1}. ${item.id}`)
  })

  await wallet.close('success')
}
```

### Token, Balance & Tier Example

```typescript
import { NodeArweaveWallet } from 'node-arweave-wallet'

async function manageTokens() {
  const wallet = new NodeArweaveWallet()
  await wallet.initialize()
  await wallet.connect(['ACCESS_ADDRESS', 'ACCESS_TOKENS'])

  // Get token balance
  const tokenId = '7GoQfmSOct_aUOWKM4xbKGg6DzAmOgdKwg8Kf-CbHm4' // WNDR token
  const balance = await wallet.tokenBalance(tokenId)
  console.log(`Balance: ${balance}`)

  // Get all user tokens
  const tokens = await wallet.userTokens({ fetchBalance: true })
  console.log(`\n📊 Your tokens (${tokens.length}):`)
  tokens.forEach(token => {
    console.log(`  • ${token.Name || token.Ticker || token.id}`)
    console.log(`    Denomination: ${token.Denomination}`)
  })

  // Get Wander tier info (Wander wallet only)
  try {
    const tierInfo = await wallet.getWanderTierInfo()
    console.log(`\n🏆 Wander Tier: ${tierInfo.tier}`)
    console.log(`   Progress: ${tierInfo.progress.toFixed(2)}%`)
    console.log(`   Rank: ${tierInfo.rank || 'N/A'}`)
    console.log(`   Total Holders: ${tierInfo.totalHolders}`)
  } catch (error) {
    console.log('Wander tier info not available')
  }

  await wallet.close('success')
}
```

## 🔒 Security

- **No Private Keys in Node.js** - Your private keys never leave the browser wallet
- **Browser Extension Security** - Leverages battle-tested browser wallet security
- **Local-Only Server** - Server only listens on `127.0.0.1` (localhost)
- **Permission-Based** - Request only the permissions you need

## 🤝 Browser Wallet Compatibility

Works with any arweaveWallet compatible browser wallet:

- ✅ [Wander](https://wander.app) (Recommended)
- ✅ Any wallet implementing the arweaveWallet API

## 🐛 Troubleshooting

### Port Already in Use

If port 3737 is already in use:

```typescript
// Use a different port
const wallet = new NodeArweaveWallet({ port: 8080 })

// Or let the system choose an available port
const wallet = new NodeArweaveWallet({ port: 0 })
```

### Browser Doesn't Open Automatically

The URL will be printed to the console. Open it manually:

```sh
http://localhost:3737
```

### Request Timeout

Keep the browser tab open while signing transactions. The package has a default 5-minute timeout for each wallet operation (configurable via `requestTimeout` option). If you need more time to review transactions, increase the timeout:

```typescript
const wallet = new NodeArweaveWallet({ 
  requestTimeout: 600000 // 10 minutes
})
```

**Note:** Closing the browser tab will immediately interrupt operations regardless of the timeout setting.

## 📄 License

[MIT](./LICENSE.md) License © [Pawan Paudel](https://github.com/pawanpaudel93)

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
