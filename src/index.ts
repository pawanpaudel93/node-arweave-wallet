import type { SignatureOptions } from 'arweave/node/lib/crypto/crypto-interface'
import type Transaction from 'arweave/node/lib/transaction'
import type {
  ActiveTier,
  AlgorithmIdentifier,
  AppInfo,
  DispatchResult,
  EcdsaParams,
  EncryptDecryptOptions,
  Gateway,
  NodeArweaveWalletConfig,
  PendingRequest,
  PermissionType,
  RsaPssParams,
  SignDataItemParams,
  SigningResponse,
  SignMessageOptions,
  TokenInfo,
  TokenType,
} from './types'
import { Buffer } from 'node:buffer'
import { existsSync, readFileSync } from 'node:fs'
import http from 'node:http'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { DataItem as ArBundlesDataItem } from '@dha-team/arbundles/node'
import killPort from 'kill-port'
import { nanoid } from 'nanoid'
import open, { apps } from 'open'
import {
  arweave,
  BROWSER_READY_DELAY,
  BROWSER_TIMEOUT,
  DEFAULT_HOST,
  DEFAULT_PORT,
  DEFAULT_REQUEST_TIMEOUT,
  SHUTDOWN_DELAY,
} from './constants'
import { base64ToBuffer, bufferToBase64 } from './utils'

/**
 * NodeArweaveWallet is a class that provides a local HTTP server for wallet interaction.
 * It allows applications to interact with Arweave wallets browser extension.
 *
 * @example
 * ```typescript
 * const wallet = new NodeArweaveWallet()
 * await wallet.initialize()
 * ```
 */
export class NodeArweaveWallet {
  private server: http.Server | null = null
  private port: number = 0
  private readonly config: NodeArweaveWalletConfig
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private sseClient: http.ServerResponse | null = null

  private address: string | null = null
  private browserConnected = false
  private complete = false

  constructor(config: NodeArweaveWalletConfig = {}) {
    this.config = {
      port: config.port ?? DEFAULT_PORT,
      freePort: config.freePort ?? false,
      requestTimeout: config.requestTimeout ?? DEFAULT_REQUEST_TIMEOUT,
      browser: config.browser,
      browserProfile: config.browserProfile,
    }
  }

  // ==================== Public API ====================
  /**
   * Initializes the wallet connection by starting a local HTTP server and opening the browser
   * for wallet authentication. This must be called before any other wallet operations.
   *
   * @returns A promise that resolves when the server is started and browser is opened
   * @throws {Error} If the port is already in use or server fails to start
   *
   * @example
   * ```typescript
   * const wallet = new NodeArweaveWallet()
   * await wallet.initialize()
   * ```
   */
  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      let hasRetried = false

      const startServer = () => {
        this.server = http.createServer((req, res) => this.handleRequest(req, res))

        this.server.listen(this.config.port, DEFAULT_HOST, async () => {
          const addr = this.server!.address() as any
          this.port = addr.port
          console.log(`\n🌐 Arweave wallet signer started at http://localhost:${this.port}`)
          console.log('📱 Opening browser for wallet connection...\n')

          await this.openBrowser(`http://localhost:${this.port}`)

          resolve()
        })

        this.server.on('error', async (error: any) => {
          if (error.code === 'EADDRINUSE') {
            // If port is 0 (random port), this shouldn't happen, but if it does, just reject
            if (this.config.port === 0) {
              reject(new Error('Failed to bind to a random port. This is unexpected.'))
              return
            }

            if (this.config.freePort && !hasRetried) {
              hasRetried = true
              console.log(`⚠️  Port ${this.config.port} is already in use. Attempting to free the port...`)
              try {
                await killPort(this.config.port!)
                console.log(`✅ Port ${this.config.port} has been freed. Waiting for port to be released...`)
                // Wait a bit for the port to be fully released by the OS
                await new Promise(resolve => setTimeout(resolve, 1000))
                console.log('🔄 Retrying server start...')
                // Retry starting the server
                startServer()
              } catch (freeError: any) {
                const errorMsg =
                  `Failed to free the port ${this.config.port}. ` +
                  `Please either:\n` +
                  `  1. Manually close the application using port ${this.config.port}, or\n` +
                  `  2. Use a different port: new NodeArweaveWallet({ port: 0 }) for automatic selection\n` +
                  `Error: ${freeError.message}`
                reject(new Error(errorMsg))
              }
            } else if (this.config.freePort && hasRetried) {
              reject(
                new Error(
                  `Failed to start server on port ${this.config.port} after retry. The port may still be in use.`,
                ),
              )
            } else {
              const errorMsg =
                `Port ${this.config.port} is already in use. ` +
                `Please either:\n` +
                `  1. Close the application using port ${this.config.port}, or\n` +
                `  2. Use a different port: new NodeArweaveWallet({ port: 0 }) for automatic selection, or\n` +
                `  3. Enable automatic port freeing: 
                new NodeArweaveWallet({ port: ${this.config.port}, freePort: true })`
              reject(new Error(errorMsg))
            }
          } else {
            reject(error)
          }
        })
      }

      startServer()
    })
  }

  /**
   * Requests a connection to the user's Arweave wallet with specified permissions.
   * This prompts the user to approve the connection in their browser wallet extension.
   *
   * @param permissions - Array of permission types to request from the wallet
   * @param appInfo - Optional application information (name and logo)
   * @param gateway - Optional custom Arweave gateway configuration
   * @returns A promise that resolves when the wallet connection is approved
   * @throws {Error} If the user rejects the connection or wallet is not available
   *
   * @example
   * ```typescript
   * await wallet.connect(
   *   ['ACCESS_ADDRESS', 'SIGN_TRANSACTION', 'DISPATCH'],
   *   { name: 'My App', logo: 'https://arweave.net/azW8iYR5A6bPXyS6WpMmw-qLTXNleS-vv4LJDR9Hf-s' }
   * )
   * ```
   */
  async connect(permissions: PermissionType[], appInfo?: AppInfo, gateway?: Gateway): Promise<void> {
    await this.waitForBrowserConnection()
    return this.makeWalletRequest<void>('connect', { permissions, appInfo, gateway })
  }

  /**
   * Retrieves the currently active wallet address.
   * Requires ACCESS_ADDRESS permission.
   *
   * @returns A promise that resolves to the active wallet address
   * @throws {Error} If permission is not granted or wallet is not connected
   *
   * @example
   * ```typescript
   * const address = await wallet.getActiveAddress()
   * console.log('Wallet address:', address)
   * ```
   */
  async getActiveAddress(): Promise<string> {
    if (this.address) return this.address

    this.address = await this.makeWalletRequest<string>('getActiveAddress', {})
    return this.address
  }

  /**
   * Disconnects the current wallet connection and revokes all permissions.
   *
   * @returns A promise that resolves when the wallet is disconnected
   *
   * @example
   * ```typescript
   * await wallet.disconnect()
   * ```
   */
  async disconnect(): Promise<void> {
    return this.makeWalletRequest<void>('disconnect', {})
  }

  /**
   * Retrieves all wallet addresses available in the connected wallet.
   * Requires ACCESS_ALL_ADDRESSES permission.
   *
   * @returns A promise that resolves to an array of wallet addresses
   * @throws {Error} If permission is not granted
   *
   * @example
   * ```typescript
   * const addresses = await wallet.getAllAddresses()
   * console.log('Available addresses:', addresses)
   * ```
   */
  async getAllAddresses(): Promise<string[]> {
    return this.makeWalletRequest<string[]>('getAllAddresses', {})
  }

  /**
   * Retrieves the names associated with wallet addresses.
   * Requires ACCESS_ALL_ADDRESSES permission.
   *
   * @returns A promise that resolves to an object mapping addresses to their names
   *
   * @example
   * ```typescript
   * const names = await wallet.getWalletNames()
   * // Returns: { "address1": "Main Wallet", "address2": "Trading Wallet" }
   * ```
   */
  async getWalletNames(): Promise<{ [address: string]: string }> {
    return this.makeWalletRequest<{ [address: string]: string }>('getWalletNames', {})
  }

  /**
   * Retrieves the list of permissions currently granted to the application.
   *
   * @returns A promise that resolves to an array of granted permission types
   *
   * @example
   * ```typescript
   * const permissions = await wallet.getPermissions()
   * console.log('Granted permissions:', permissions)
   * ```
   */
  async getPermissions(): Promise<PermissionType[]> {
    return this.makeWalletRequest<PermissionType[]>('getPermissions', {})
  }

  /**
   * Retrieves the Arweave gateway configuration used by the wallet.
   * Requires ACCESS_ARWEAVE_CONFIG permission.
   *
   * @returns A promise that resolves to the gateway configuration
   *
   * @example
   * ```typescript
   * const config = await wallet.getArweaveConfig()
   * // Returns: { host: "arweave.net", port: 443, protocol: "https" }
   * ```
   */
  async getArweaveConfig(): Promise<Gateway> {
    return this.makeWalletRequest<Gateway>('getArweaveConfig', {})
  }

  /**
   * Retrieves the public key of the currently active wallet.
   * Requires ACCESS_PUBLIC_KEY permission.
   *
   * @returns A promise that resolves to public key
   * @throws {Error} If permission is not granted
   *
   * @example
   * ```typescript
   * const publicKey = await wallet.getActivePublicKey()
   * ```
   */
  async getActivePublicKey(): Promise<string> {
    return this.makeWalletRequest<string>('getActivePublicKey', {})
  }

  /**
   * Signs arbitrary data with the wallet's private key using a specified algorithm.
   * Requires SIGNATURE permission.
   *
   * @param data - The data to sign as a Uint8Array
   * @param algorithm - The signing algorithm (e.g., RSA-PSS, ECDSA)
   * @returns A promise that resolves to the signature as a Uint8Array
   * @throws {Error} If permission is not granted or signing fails
   *
   * @example
   * ```typescript
   * const data = new TextEncoder().encode('Hello, Arweave!')
   * const signature = await wallet.signature(data, {
   *   name: 'RSA-PSS',
   *   saltLength: 32
   * })
   * ```
   */
  async signature(data: Uint8Array, algorithm: AlgorithmIdentifier | RsaPssParams | EcdsaParams): Promise<Uint8Array> {
    const dataBase64 = bufferToBase64(data)
    const result = await this.makeWalletRequest<string>('signature', {
      data: dataBase64,
      algorithm,
    })
    return base64ToBuffer(result)
  }

  /**
   * Signs an Arweave transaction with the wallet's private key.
   * Requires SIGN_TRANSACTION permission.
   *
   * @param transaction - The Arweave transaction to sign
   * @param options - Optional signature options
   * @returns A promise that resolves to the signed transaction
   * @throws {Error} If permission is not granted or signing fails
   *
   * @example
   * ```typescript
   * const tx = await arweave.createTransaction({ data: 'Hello Arweave!' })
   * const signedTx = await wallet.sign(tx)
   * await arweave.transactions.post(signedTx)
   * ```
   */
  async sign(transaction: Transaction, options?: SignatureOptions): Promise<Transaction> {
    const data = await this.makeWalletRequest<any>('sign', { transaction, options })
    const signedTx = arweave.transactions.fromRaw(data)
    transaction.setSignature({
      id: signedTx.id,
      owner: signedTx.owner,
      reward: signedTx.reward,
      tags: signedTx.tags,
      signature: signedTx.signature,
    })
    return transaction
  }

  /**
   * Signs and dispatches an Arweave transaction to the network in one operation.
   * Requires DISPATCH permission.
   *
   * @param transaction - The Arweave transaction to sign and dispatch
   * @param options - Optional signature options
   * @returns A promise that resolves to the dispatch result with transaction ID
   * @throws {Error} If permission is not granted or dispatch fails
   *
   * @example
   * ```typescript
   * const tx = await arweave.createTransaction({ data: 'Hello Arweave!' })
   * tx.addTag('Content-Type', 'text/plain')
   * const result = await wallet.dispatch(tx)
   * console.log('Transaction ID:', result.id)
   * ```
   */
  async dispatch(transaction: Transaction, options?: SignatureOptions): Promise<DispatchResult> {
    return this.makeWalletRequest<DispatchResult>('dispatch', { transaction, options })
  }

  /**
   * Encrypts data using the wallet's public key.
   * Requires ENCRYPT permission.
   *
   * @param data - The data to encrypt (string or Uint8Array)
   * @param options - Encryption algorithm parameters (RsaOaepParams, AesCtrParams, AesCbcParams, or AesGcmParams)
   * @returns A promise that resolves to the encrypted data as a Uint8Array
   * @throws {Error} If permission is not granted or encryption fails
   *
   * @see https://docs.wander.app/api/encrypt
   *
   * @example
   * ```typescript
   * // New API format (recommended)
   * const encrypted = await wallet.encrypt(
   *   new TextEncoder().encode('Secret message'),
   *   { name: 'RSA-OAEP' }
   * )
   *
   * // Old deprecated format (still supported)
   * const encrypted = await wallet.encrypt('Secret message', {
   *   algorithm: 'RSA-OAEP',
   *   hash: 'SHA-256'
   * })
   * ```
   */
  async encrypt(data: string | Uint8Array, options: EncryptDecryptOptions): Promise<Uint8Array> {
    const dataToEncrypt = typeof data === 'string' ? data : bufferToBase64(data)
    const result = await this.makeWalletRequest<string>('encrypt', { data: dataToEncrypt, options })
    return base64ToBuffer(result)
  }

  /**
   * Decrypts data using the wallet's private key.
   * Requires DECRYPT permission.
   *
   * @param data - The encrypted data as a Uint8Array
   * @param options - Decryption algorithm parameters (RsaOaepParams, AesCtrParams, AesCbcParams, or AesGcmParams)
   * @returns A promise that resolves to the decrypted data as a Uint8Array
   * @throws {Error} If permission is not granted or decryption fails
   *
   * @see https://docs.wander.app/api/decrypt
   *
   * @example
   * ```typescript
   * // New API format (recommended)
   * const decrypted = await wallet.decrypt(
   *   encryptedData,
   *   { name: 'RSA-OAEP' }
   * )
   * const text = new TextDecoder().decode(decrypted)
   *
   * // Old deprecated format (still supported)
   * const decrypted = await wallet.decrypt(encryptedData, {
   *   algorithm: 'RSA-OAEP',
   *   hash: 'SHA-256'
   * })
   * const text = new TextDecoder().decode(decrypted)
   * ```
   */
  async decrypt(data: Uint8Array, options: EncryptDecryptOptions): Promise<Uint8Array> {
    const dataBase64 = bufferToBase64(data)
    const result = await this.makeWalletRequest<string>('decrypt', { data: dataBase64, options })
    return base64ToBuffer(result)
  }

  /**
   * Creates a private hash of data using the wallet's private key.
   * Requires SIGNATURE permission.
   *
   * @param data - The data to hash (Uint8Array or ArrayBuffer)
   * @param options - Optional hash algorithm options (default: SHA-256)
   * @returns A promise that resolves to the hash as a Uint8Array
   * @throws {Error} If permission is not granted or hashing fails
   *
   * @example
   * ```typescript
   * const data = new TextEncoder().encode('Data to hash')
   * const hash = await wallet.privateHash(data, { hashAlgorithm: 'SHA-256' })
   * ```
   */
  async privateHash(data: Uint8Array | ArrayBuffer, options?: SignMessageOptions): Promise<Uint8Array> {
    const dataBase64 = bufferToBase64(data)
    const result = await this.makeWalletRequest<string>('privateHash', {
      data: dataBase64,
      options,
    })
    return base64ToBuffer(result)
  }

  /**
   * Adds a token to the wallet's token list.
   * Requires ACCESS_TOKENS permission.
   *
   * @param id - The token ID (process ID on Arweave)
   * @param type - The token type ('asset' or 'collectible')
   * @param gateway - Optional custom gateway configuration
   * @returns A promise that resolves when the token is added
   * @throws {Error} If permission is not granted or token addition fails
   *
   * @example
   * ```typescript
   * await wallet.addToken('7GoQfmSOct_aUOWKM4xbKGg6DzAmOgdKwg8Kf-CbHm4', 'asset')
   * ```
   */
  async addToken(id: string, type?: TokenType, gateway?: Gateway): Promise<void> {
    return this.makeWalletRequest<void>('addToken', { id, type, gateway })
  }

  /**
   * Checks if a token has been added to the wallet.
   * Requires ACCESS_TOKENS permission.
   *
   * @param id - The token ID to check
   * @returns A promise that resolves to true if the token is added, false otherwise
   * @throws {Error} If permission is not granted
   *
   * @example
   * ```typescript
   * const isAdded = await wallet.isTokenAdded('7GoQfmSOct_aUOWKM4xbKGg6DzAmOgdKwg8Kf-CbHm4')
   * console.log('Token added:', isAdded)
   * ```
   */
  async isTokenAdded(id: string): Promise<boolean> {
    return this.makeWalletRequest<boolean>('isTokenAdded', { id })
  }

  /**
   * Signs a data item for ANS-104 bundling.
   * Requires SIGN_TRANSACTION permission.
   *
   * @param dataItem - The data item to sign (data, tags, optional target and anchor)
   * @param options - Optional signature options
   * @returns A promise that resolves to the signed data item as a Uint8Array
   * @throws {Error} If permission is not granted or signing fails
   *
   * @example
   * ```typescript
   * const signedDataItem = await wallet.signDataItem({
   *   data: 'Hello from data item!',
   *   tags: [
   *     { name: 'Content-Type', value: 'text/plain' },
   *     { name: 'App-Name', value: 'MyApp' }
   *   ]
   * })
   * ```
   */
  async signDataItem(dataItem: SignDataItemParams, options?: SignatureOptions): Promise<Uint8Array> {
    const params = {
      data: typeof dataItem.data === 'string' ? dataItem.data : bufferToBase64(dataItem.data),
      tags: dataItem.tags || [],
      target: dataItem.target,
      anchor: dataItem.anchor,
      options,
    }

    const result = await this.makeWalletRequest<{ signedDataItem: string }>('signDataItem', params)
    return base64ToBuffer(result.signedDataItem)
  }

  /**
   * Signs a message by hashing it first and then signing the hash.
   * Requires SIGNATURE permission.
   *
   * @param data - The message data to sign (Uint8Array or ArrayBuffer)
   * @param options - Optional hash algorithm options (default: SHA-256)
   * @returns A promise that resolves to the signature as a Uint8Array
   * @throws {Error} If permission is not granted or signing fails
   *
   * @example
   * ```typescript
   * const data = new TextEncoder().encode('Message to sign')
   * const signature = await wallet.signMessage(data, { hashAlgorithm: 'SHA-256' })
   * ```
   */
  async signMessage(data: Uint8Array | ArrayBuffer, options?: SignMessageOptions): Promise<Uint8Array> {
    const dataBase64 = bufferToBase64(data)
    const result = await this.makeWalletRequest<string>('signMessage', {
      data: dataBase64,
      options,
    })
    return base64ToBuffer(result)
  }

  /**
   * Verifies a message signature against the original data.
   * Requires SIGNATURE permission.
   *
   * @param data - The original message data
   * @param signature - The signature to verify
   * @param publicKey - Optional public key (uses wallet's public key if not provided)
   * @param options - Optional hash algorithm options (default: SHA-256)
   * @returns A promise that resolves to true if the signature is valid, false otherwise
   * @throws {Error} If permission is not granted or verification fails
   *
   * @example
   * ```typescript
   * const isValid = await wallet.verifyMessage(data, signature, publicKey, {
   *   hashAlgorithm: 'SHA-256'
   * })
   * console.log('Signature valid:', isValid)
   * ```
   */
  async verifyMessage(
    data: Uint8Array | ArrayBuffer,
    signature: Uint8Array | ArrayBuffer | string,
    publicKey?: string,
    options?: SignMessageOptions,
  ): Promise<boolean> {
    const dataBase64 = bufferToBase64(data)
    const signatureBase64 = typeof signature === 'string' ? signature : bufferToBase64(signature)
    return this.makeWalletRequest<boolean>('verifyMessage', {
      data: dataBase64,
      signature: signatureBase64,
      publicKey,
      options,
    })
  }

  /**
   * Signs multiple data items in a single batch operation.
   * Requires SIGN_TRANSACTION permission.
   *
   * @param dataItems - Array of data items to sign
   * @param options - Optional signature options
   * @returns A promise that resolves to an array of signed data items with IDs and raw data
   * @throws {Error} If permission is not granted or signing fails
   *
   * @example
   * ```typescript
   * const results = await wallet.batchSignDataItem([
   *   { data: 'First item', tags: [{ name: 'Type', value: 'Test1' }] },
   *   { data: 'Second item', tags: [{ name: 'Type', value: 'Test2' }] }
   * ])
   * results.forEach(result => console.log('Signed item ID:', result.id))
   * ```
   */
  async batchSignDataItem(
    dataItems: SignDataItemParams[],
    options?: SignatureOptions,
  ): Promise<Array<{ id: string; raw: Uint8Array }>> {
    const items = dataItems.map(item => ({
      data: typeof item.data === 'string' ? item.data : bufferToBase64(item.data),
      tags: item.tags || [],
      target: item.target,
      anchor: item.anchor,
    }))

    const results = await this.makeWalletRequest<Array<{ signedDataItem: string }>>('batchSignDataItem', {
      dataItems: items,
      options,
    })

    return Promise.all(
      results.map(async result => {
        const signedBuffer = base64ToBuffer(result.signedDataItem)
        const dataItem = new ArBundlesDataItem(Buffer.from(signedBuffer))
        const itemId = await dataItem.id
        return { id: itemId, raw: signedBuffer }
      }),
    )
  }

  /**
   * Retrieves the balance of a specific token.
   * Requires ACCESS_TOKENS permission.
   *
   * @param id - The token ID (process ID)
   * @returns A promise that resolves to the token balance as a string
   * @throws {Error} If permission is not granted or the API is not supported
   *
   * @example
   * ```typescript
   * const balance = await wallet.tokenBalance('7GoQfmSOct_aUOWKM4xbKGg6DzAmOgdKwg8Kf-CbHm4')
   * console.log('Token balance:', balance)
   * ```
   */
  async tokenBalance(id: string): Promise<string> {
    return this.makeWalletRequest<string>('tokenBalance', { id })
  }

  /**
   * Retrieves all tokens owned by the user.
   * Requires ACCESS_TOKENS permission.
   *
   * @param options - Optional settings
   * @param options.fetchBalance - Whether to fetch token balances (default: false)
   * @returns A promise that resolves to an array of token information
   * @throws {Error} If permission is not granted or the API is not supported
   *
   * @example
   * ```typescript
   * const tokens = await wallet.userTokens({ fetchBalance: true })
   * tokens.forEach(token => {
   *   console.log(`${token.Name || token.Ticker}: ${token.balance || 'N/A'}`)
   * })
   * ```
   */
  async userTokens(options?: { fetchBalance?: boolean }): Promise<TokenInfo[]> {
    return this.makeWalletRequest<TokenInfo[]>('userTokens', { options })
  }

  /**
   * Retrieves Wander wallet tier information.
   * This is a Wander-specific feature that provides tier status, progress, and ranking.
   *
   * @returns A promise that resolves to the tier information
   * @throws {Error} If the wallet doesn't support this feature or the API is not available
   *
   * @example
   * ```typescript
   * const tierInfo = await wallet.getWanderTierInfo()
   * console.log(`Tier: ${tierInfo.tier}`)
   * console.log(`Progress: ${tierInfo.progress.toFixed(2)}%`)
   * console.log(`Rank: ${tierInfo.rank || 'N/A'}`)
   * ```
   */
  async getWanderTierInfo(): Promise<ActiveTier> {
    return this.makeWalletRequest<ActiveTier>('getWanderTierInfo', {})
  }

  /**
   * Creates a data item signer compatible with @permaweb/aoconnect.
   * This signer can be used with aoconnect's message() and spawn() functions.
   *
   * @returns A signer function compatible with aoconnect
   *
   * @example
   * ```typescript
   * import { message } from '@permaweb/aoconnect'
   *
   * const signer = wallet.getDataItemSigner()
   * const messageId = await message({
   *   process: 'PROCESS_ID',
   *   signer,
   *   tags: [{ name: 'Action', value: 'Hello' }],
   *   data: 'Hello from browser wallet!'
   * })
   * ```
   */
  getDataItemSigner() {
    return this.createDataItemSigner()
  }

  /**
   * Marks the wallet operations as complete and notifies the browser.
   * This will trigger the auto-close countdown in the browser window.
   *
   * @param status - The completion status ('success' or 'failed')
   *
   * @example
   * ```typescript
   * wallet.markComplete('success')
   * ```
   */
  markComplete(status: 'success' | 'failed' = 'success'): void {
    this.complete = true

    // Notify SSE client
    if (this.sseClient) {
      this.sendSSEComplete(status)
    }
  }

  /**
   * Closes the wallet connection, stops the server, and cleans up resources.
   * This should be called when you're done with all wallet operations.
   *
   * @param status - The completion status ('success' or 'failed')
   * @returns A promise that resolves when the connection is closed
   *
   * @example
   * ```typescript
   * try {
   *   // ... perform wallet operations ...
   *   await wallet.close('success')
   * } catch (error) {
   *   await wallet.close('failed')
   * }
   * ```
   */
  async close(status: 'success' | 'failed' = 'success'): Promise<void> {
    if (!this.server) return

    if (!this.complete) {
      this.markComplete(status)
    }

    await new Promise(resolve => setTimeout(resolve, SHUTDOWN_DELAY))

    // Close SSE connection if open
    if (this.sseClient) {
      try {
        this.sseClient.end()
      } catch {
        // Ignore errors on close
      }
      this.sseClient = null
    }

    if (this.server) {
      this.server.close()
      this.server = null
    }
  }

  // ==================== Private Methods ====================

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.setCORSHeaders(res)

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    const handlers: Record<string, () => void> = {
      'GET /': () => this.handleGetRoot(res),
      'GET /events': () => this.handleSSE(res),
      'POST /response': () => this.handleResponse(req, res),
    }

    const key = `${req.method} ${req.url}`
    const handler = handlers[key]

    if (handler) {
      handler()
    } else {
      res.writeHead(404)
      res.end('Not found')
    }
  }

  private setCORSHeaders(res: http.ServerResponse): void {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  }

  private handleGetRoot(res: http.ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(this.getSignerHTML())
  }

  private handleSSE(res: http.ServerResponse): void {
    // Set up SSE headers
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    // Mark browser as connected
    if (!this.browserConnected) {
      this.browserConnected = true
    }

    // Store the SSE client (only one per browser window)
    this.sseClient = res

    // Send initial connection message
    res.write('data: {"type":"connected"}\n\n')

    // Send any pending requests immediately
    const existingRequest = Array.from(this.pendingRequests.entries())[0]
    if (existingRequest) {
      const [id, value] = existingRequest
      if (value.data) {
        this.sendSSERequest(id, value.data.type, value.data)
      }
    }

    // Handle client disconnect - this fires immediately when browser tab closes
    res.on('close', () => {
      if (this.sseClient === res) {
        this.sseClient = null
        this.browserConnected = false
        this.close('failed')
        for (const [id, request] of this.pendingRequests.entries()) {
          request.reject(new Error('Browser connection lost'))
          this.pendingRequests.delete(id)
        }
      }
    })
  }

  private sendSSERequest(id: string, type: string, data: any): void {
    if (!this.sseClient) return

    const event = JSON.stringify({ id, type, data })
    try {
      this.sseClient.write(`data: ${event}\n\n`)
    } catch (error) {
      console.error('Failed to send SSE request:', error)
      this.sseClient = null
    }
  }

  private sendSSEComplete(status: 'success' | 'failed'): void {
    if (!this.sseClient) return

    const event = JSON.stringify({ type: 'completed', status })
    try {
      this.sseClient.write(`data: ${event}\n\n`)
    } catch (error) {
      console.error('Failed to send SSE completion:', error)
      this.sseClient = null
    }
  }

  private handleResponse(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.readRequestBody(req, body => {
      try {
        const response: SigningResponse = JSON.parse(body)
        const pending = this.pendingRequests.get(response.id)

        if (pending) {
          if (response.error) {
            pending.reject(new Error(response.error))
          } else {
            pending.resolve(response.result)
          }
          this.pendingRequests.delete(response.id)
        }

        this.sendJSON(res, 200, { success: true })
      } catch (error: any) {
        this.sendJSON(res, 400, { error: error.message })
      }
    })
  }

  private readRequestBody(req: http.IncomingMessage, callback: (body: string) => void): void {
    let body = ''
    req.on('data', chunk => (body += chunk.toString()))
    req.on('end', () => callback(body))
  }

  private sendJSON(res: http.ServerResponse, statusCode: number, data: any): void {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }

  private async waitForBrowserConnection(timeout = BROWSER_TIMEOUT): Promise<void> {
    const startTime = Date.now()
    const checkInterval = 100 // Check every 100ms

    while (!this.browserConnected && Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, checkInterval))
    }

    if (!this.browserConnected) {
      throw new Error('Browser page not responding. Please ensure the browser window is open.')
    }

    await new Promise(resolve => setTimeout(resolve, BROWSER_READY_DELAY))
  }

  private async makeWalletRequest<T>(type: string, params: any): Promise<T> {
    const id = nanoid()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Timeout waiting for ${type} after ${this.config.requestTimeout! / 1000} seconds`))
      }, this.config.requestTimeout!)

      this.pendingRequests.set(id, {
        resolve: (value: T) => {
          clearTimeout(timeout)
          resolve(value)
        },
        reject: (error: Error) => {
          clearTimeout(timeout)
          reject(error)
        },
        data: { type, params },
      })

      if (this.sseClient) {
        this.sendSSERequest(id, type, { type, params })
      }
    })
  }

  private createDataItemSigner() {
    return async (create: any) => {
      const { data, tags, target, anchor } = await create({
        alg: 'rsa-v1_5-sha256',
        passthrough: true,
      })

      const signedBuffer = await this.signDataItem({
        data,
        tags: tags || [],
        target,
        anchor,
      })

      const dataItem = new ArBundlesDataItem(Buffer.from(signedBuffer))
      const itemId = await dataItem.id
      const rawBuffer = await dataItem.getRaw()
      const raw = new Uint8Array(rawBuffer)

      return { id: itemId, raw }
    }
  }

  private async openBrowser(url: string): Promise<void> {
    if (this.config.browser === false) {
      console.log(`\n🌐 Browser URL: ${url}`)
      console.log('(Auto-open disabled - please open manually)\n')
      return
    }

    try {
      if (this.config.browser) {
        const openOptions: any = { app: { name: this.getBrowserName(this.config.browser) } }

        if (this.config.browserProfile && this.config.browser !== 'opera') {
          openOptions.app.arguments = this.getBrowserProfileArgs(this.config.browser)
          openOptions.newInstance = true
        }

        await open(url, openOptions)
      } else {
        await open(url)
      }
    } catch (error: any) {
      console.error('Failed to open browser automatically:', error.message)
      console.log(`Please open this URL manually: ${url}`)
    }
  }

  private getBrowserName(browser: string): string | readonly string[] {
    const browserLower = browser.toLowerCase()
    const browserMap: Record<string, string | readonly string[]> = {
      chrome: apps.chrome,
      firefox: apps.firefox,
      edge: apps.edge,
      brave: apps.brave,
    }
    return browserMap[browserLower] ?? browser
  }

  private getBrowserDataPath(browser: string): string | null {
    const platform = process.platform
    const home = homedir()

    const paths: Record<string, Record<string, string>> = {
      chrome: {
        darwin: join(home, 'Library/Application Support/Google/Chrome'),
        win32: join(home, 'AppData/Local/Google/Chrome/User Data'),
        linux: join(home, '.config/google-chrome'),
      },
      brave: {
        darwin: join(home, 'Library/Application Support/BraveSoftware/Brave-Browser'),
        win32: join(home, 'AppData/Local/BraveSoftware/Brave-Browser/User Data'),
        linux: join(home, '.config/BraveSoftware/Brave-Browser'),
      },
      edge: {
        darwin: join(home, 'Library/Application Support/Microsoft Edge'),
        win32: join(home, 'AppData/Local/Microsoft/Edge/User Data'),
        linux: join(home, '.config/microsoft-edge'),
      },
    }

    return paths[browser]?.[platform] ?? null
  }

  private resolveProfileName(browser: string, profileName: string): string {
    const browserLower = browser.toLowerCase()

    // Only Chromium-based browsers support profile directory resolution
    if (!['chrome', 'edge', 'brave', 'opera', 'vivaldi'].includes(browserLower)) {
      return profileName
    }

    try {
      const basePath = this.getBrowserDataPath(browserLower)
      if (!basePath || !existsSync(basePath)) {
        return profileName
      }

      const localStatePath = join(basePath, 'Local State')
      if (!existsSync(localStatePath)) {
        return profileName
      }

      const localState = JSON.parse(readFileSync(localStatePath, 'utf-8'))
      const profileInfo = localState?.profile?.info_cache

      if (!profileInfo) return profileName

      // Search for matching profile by name or gaia_name
      for (const [dirName, info] of Object.entries(profileInfo)) {
        const profileData = info as any
        if (profileData.name === profileName || profileData.gaia_name === profileName) {
          return dirName
        }
      }
    } catch {
      // Silently fall back to original profile name on any error
    }

    return profileName
  }

  private getBrowserProfileArgs(browser: string): string[] {
    const browserLower = browser.toLowerCase()
    const profile = this.config.browserProfile

    if (!profile) return []

    const resolvedProfile = this.resolveProfileName(browserLower, profile)

    // Firefox uses different profile arguments
    if (browserLower === 'firefox' || browserLower === 'zen') {
      return ['-P', resolvedProfile]
    }

    // Chromium-based browsers (Chrome, Edge, Brave) and others
    return [`--profile-directory=${resolvedProfile}`]
  }

  private getSignerHTML(): string {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)

    const htmlPath = join(__dirname, 'signer', 'signer.html')
    const jsPath = join(__dirname, 'signer', 'signer.js')

    const html = readFileSync(htmlPath, 'utf-8')
    const js = readFileSync(jsPath, 'utf-8')

    return html.replace('<script src="signer.js"></script>', `<script>${js}</script>`)
  }
}

// ==================== Exports ====================
/**
 * Creates a DataItemSigner compatible with @permaweb/aoconnect.
 * This is a convenience function that wraps the wallet's getDataItemSigner() method.
 * The returned signer can be used with aoconnect's message() and spawn() functions.
 *
 * @param arweaveWallet - The NodeArweaveWallet instance
 * @returns A signer function compatible with aoconnect
 *
 * @example
 * ```typescript
 * import { message } from '@permaweb/aoconnect'
 * import { createDataItemSigner, NodeArweaveWallet } from 'node-arweave-wallet'
 *
 * const wallet = new NodeArweaveWallet()
 * await wallet.initialize()
 * await wallet.connect(['ACCESS_ADDRESS', 'SIGN_TRANSACTION'])
 *
 * const signer = createDataItemSigner(wallet)
 * const messageId = await message({
 *   process: 'PROCESS_ID',
 *   signer,
 *   tags: [{ name: 'Action', value: 'Balance' }]
 * })
 * ```
 */
export function createDataItemSigner(arweaveWallet: NodeArweaveWallet) {
  return arweaveWallet.getDataItemSigner()
}
