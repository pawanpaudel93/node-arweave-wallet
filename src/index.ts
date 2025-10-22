import type { SignatureOptions } from 'arweave/node/lib/crypto/crypto-interface'
import type Transaction from 'arweave/node/lib/transaction'
import { Buffer } from 'node:buffer'
import { exec } from 'node:child_process'
import { readFileSync } from 'node:fs'
import http from 'node:http'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { DataItem as ArBundlesDataItem } from '@dha-team/arbundles/node'
import Arweave from 'arweave'

interface SigningResponse {
  id: string
  result?: any
  error?: string
}

export type PermissionType
  = 'ACCESS_ADDRESS'
    | 'ACCESS_PUBLIC_KEY'
    | 'ACCESS_ALL_ADDRESSES'
    | 'SIGN_TRANSACTION'
    | 'ENCRYPT'
    | 'DECRYPT'
    | 'SIGNATURE'
    | 'ACCESS_ARWEAVE_CONFIG'
    | 'DISPATCH'
    | 'ACCESS_TOKENS'

export interface AppInfo {
  name?: string
  logo?: string
}

export interface Gateway {
  host: string
  port: number
  protocol: 'http' | 'https'
}

export type TokenType = 'asset' | 'collectible'

export interface DispatchResult {
  id: string
  type?: 'BASE' | 'BUNDLED'
}

export interface SignMessageOptions {
  hashAlgorithm?: 'SHA-256' | 'SHA-384' | 'SHA-512'
}

export interface DataItem {
  data: string | Uint8Array
  target?: string
  anchor?: string
  tags?: {
    name: string
    value: string
  }[]
}

export type AlgorithmIdentifier = string | Algorithm
export interface Algorithm {
  name: string
}

export interface RsaPssParams extends Algorithm {
  name: 'RSA-PSS'
  saltLength: number
}

export interface EcdsaParams extends Algorithm {
  name: 'ECDSA'
  hash: AlgorithmIdentifier
}

const arweave = new Arweave({
  host: 'arweave.net',
  port: 443,
  protocol: 'https',
})

export interface NodeArweaveWalletConfig {
  port?: number // Port to listen on (default: 3737, use 0 for random)
}

export class NodeArweaveWallet {
  private server: http.Server | null = null
  private port: number = 0
  private pendingRequests: Map<
    string,
    { resolve: (value: any) => void, reject: (error: Error) => void }
  > = new Map()

  private address: string | null = null
  private connections: Set<any> = new Set()
  private browserConnected: boolean = false
  private lastHeartbeat: number = Date.now()
  private heartbeatInterval: NodeJS.Timeout | null = null
  private complete = false
  private status: 'success' | 'failed' | null = null
  private config: NodeArweaveWalletConfig

  constructor(config: NodeArweaveWalletConfig = {}) {
    this.config = {
      port: config.port ?? 3737, // Default to port 3737
    }
  }

  /**
   * Start the local server and open the browser
   */
  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res)
      })

      // Track connections for clean shutdown
      this.server.on('connection', (conn) => {
        this.connections.add(conn)
        conn.on('close', () => {
          this.connections.delete(conn)
        })
      })

      // Listen on configured port (default: 3737, or 0 for random)
      this.server.listen(this.config.port, '127.0.0.1', () => {
        const addr = this.server!.address() as any
        this.port = addr.port
        console.log(
          `\n🌐 Browser wallet signer started at http://localhost:${this.port}`,
        )
        console.log('📱 Opening browser for wallet connection...\n')

        // Open browser
        this.openBrowser(`http://localhost:${this.port}`)

        // Start heartbeat checker
        this.startHeartbeatChecker()

        resolve()
      })

      this.server.on('error', reject)
    })
  }

  /**
   * Start checking for browser heartbeat
   */
  private startHeartbeatChecker(): void {
    this.heartbeatInterval = setInterval(() => {
      const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat

      // If no heartbeat for 10 seconds and the browser was connected, it's disconnected
      if (this.browserConnected && timeSinceLastHeartbeat > 10000) {
        console.log('\n❌ Browser connection lost - tab may have been closed')
        this.browserConnected = false

        // Reject all pending requests
        for (const [id, pending] of this.pendingRequests.entries()) {
          pending.reject(new Error('Browser tab closed - signing cancelled'))
          this.pendingRequests.delete(id)
        }
      }
    }, 2000) // Check every 2 seconds
  }

  /**
   * Handle HTTP requests from browser
   */
  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse) {
    // Enable CORS
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') {
      res.writeHead(200)
      res.end()
      return
    }

    if (req.method === 'GET' && req.url === '/') {
      // Serve the HTML page
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end(this.getSignerHTML())
      return
    }

    if (req.method === 'POST' && req.url === '/poll') {
      // Update heartbeat - browser is alive
      this.lastHeartbeat = Date.now()
      if (!this.browserConnected) {
        this.browserConnected = true
      }

      // Check if the process is complete
      if (this.complete) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            id: null,
            completed: true,
            status: this.status,
          }),
        )
        return
      }

      // Long polling endpoint for getting signing requests
      // Return pending request if any, otherwise wait
      const request = Array.from(this.pendingRequests.entries())[0]
      if (request) {
        const [id, value] = request
        // console.log(`📍 Found pending request: ${id}`);
        const requestData = (value as any).data
        if (requestData) {
          // console.log(`📍 Request has data, type: ${requestData.type}`);
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(
            JSON.stringify({
              id,
              type: requestData.type,
              data: requestData,
            }),
          )
        }
        else {
          // No data yet, wait
          setTimeout(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ id: null }))
          }, 1000)
        }
      }
      else {
        // No pending requests, hold connection briefly
        setTimeout(() => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ id: null }))
        }, 1000)
      }
      return
    }

    if (req.method === 'POST' && req.url === '/response') {
      // Browser sends back signed data
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const response: SigningResponse = JSON.parse(body)
          const pending = this.pendingRequests.get(response.id)
          if (pending) {
            if (response.error) {
              pending.reject(new Error(response.error))
            }
            else {
              pending.resolve(response.result)
            }
            this.pendingRequests.delete(response.id)
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true }))
        }
        catch (error: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: error.message }))
        }
      })
      return
    }

    if (req.method === 'POST' && req.url === '/get-request') {
      // Get the next pending request
      let body = ''
      req.on('data', (chunk) => {
        body += chunk.toString()
      })
      req.on('end', () => {
        try {
          const { id } = JSON.parse(body)
          const pending = this.pendingRequests.get(id) as any
          if (pending && pending.data) {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(pending.data))
          }
          else {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Request not found' }))
          }
        }
        catch (error: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: error.message }))
        }
      })
      return
    }

    res.writeHead(404)
    res.end('Not found')
  }

  /**
   * Get active wallet address from browser
   */
  async getActiveAddress(): Promise<string> {
    if (this.address) {
      return this.address
    }

    const id = this.generateId()
    return new Promise((resolve, reject) => {
      // Set timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error('Timeout waiting for wallet address'))
      }, 60000) // 60 second timeout

      // Store request with both callbacks and data
      this.pendingRequests.set(id, {
        resolve: (value: string) => {
          clearTimeout(timeout)
          this.address = value
          resolve(value)
        },
        reject: (error: Error) => {
          clearTimeout(timeout)
          reject(error)
        },
        data: {
          type: 'address',
        },
      } as any)
    })
  }

  /** Connect wallet programmatically */
  async connect(
    permissions: PermissionType[],
    appInfo?: AppInfo,
    gateway?: Gateway,
  ): Promise<void> {
    // Wait for browser to be ready before attempting connection
    await this.waitForBrowserConnection()

    return this.makeWalletRequest<void>('connect', {
      permissions,
      appInfo,
      gateway,
    })
  }

  /**
   * Wait for browser page to be ready (receiving heartbeats)
   * This doesn't require wallet connection, just that the browser page has loaded
   */
  private async waitForBrowserConnection(timeout = 30000): Promise<void> {
    const startTime = Date.now()
    // Wait for any heartbeat (even without wallet connected)
    // The lastHeartbeat is updated when browser polls
    const initialHeartbeat = this.lastHeartbeat

    while (
      this.lastHeartbeat === initialHeartbeat
      && Date.now() - startTime < timeout
    ) {
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    if (this.lastHeartbeat === initialHeartbeat) {
      throw new Error(
        'Browser page not responding. Please ensure the browser window is open.',
      )
    }

    // Give it a moment to be fully ready
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  /**
   * Disconnect wallet
   */
  async disconnect(): Promise<void> {
    return this.makeWalletRequest<void>('disconnect', {})
  }

  /**
   * Get all wallet addresses
   */
  async getAllAddresses(): Promise<string[]> {
    return this.makeWalletRequest<string[]>('getAllAddresses', {})
  }

  /**
   * Get wallet names
   */
  async getWalletNames(): Promise<{ [address: string]: string }> {
    return this.makeWalletRequest<{ [address: string]: string }>(
      'getWalletNames',
      {},
    )
  }

  /**
   * Get permissions
   */
  async getPermissions(): Promise<PermissionType[]> {
    return this.makeWalletRequest<PermissionType[]>('getPermissions', {})
  }

  /**
   * Get Arweave config
   */
  async getArweaveConfig(): Promise<Gateway> {
    return this.makeWalletRequest<Gateway>('getArweaveConfig', {})
  }

  /**
   * Get public key
   */
  async getActivePublicKey(): Promise<string> {
    return this.makeWalletRequest<string>('getPublicKey', {})
  }

  /**
   * Sign arbitrary data
   */
  async signature(
    data: Uint8Array,
    algorithm: AlgorithmIdentifier | RsaPssParams | EcdsaParams,
  ): Promise<Uint8Array> {
    const dataBase64 = Buffer.from(data).toString('base64')
    const result = await this.makeWalletRequest<string>('signature', {
      data: dataBase64,
      algorithm,
    })
    return Buffer.from(result, 'base64')
  }

  /**
   * Sign a transaction
   */
  async sign(
    transaction: Transaction,
    options?: SignatureOptions,
  ): Promise<Transaction> {
    const data = await this.makeWalletRequest<any>('sign', {
      transaction,
      options,
    })

    return arweave.transactions.fromRaw(data)
  }

  /**
   * Sign and dispatch a transaction
   */
  async dispatch(
    transaction: Transaction,
    options?: SignatureOptions,
  ): Promise<DispatchResult> {
    return this.makeWalletRequest<DispatchResult>('dispatch', {
      transaction,
      options,
    })
  }

  /**
   * Encrypt data
   */
  async encrypt(
    data: string | Uint8Array,
    options: {
      algorithm: string
      hash: string
      salt?: string
    },
  ): Promise<Uint8Array> {
    const dataToEncrypt
      = typeof data === 'string' ? data : Buffer.from(data).toString('base64')
    const result = await this.makeWalletRequest<string>('encrypt', {
      data: dataToEncrypt,
      options,
    })
    return Buffer.from(result, 'base64')
  }

  /**
   * Decrypt data
   */
  async decrypt(
    data: Uint8Array,
    options: {
      algorithm: string
      hash: string
      salt?: string
    },
  ): Promise<Uint8Array> {
    const dataBase64 = Buffer.from(data).toString('base64')
    const result = await this.makeWalletRequest<string>('decrypt', {
      data: dataBase64,
      options,
    })
    return Buffer.from(result, 'base64')
  }

  /**
   * Create a private hash (hash data with private key)
   */
  async privateHash(
    data: Uint8Array | ArrayBuffer,
    options?: SignMessageOptions,
  ): Promise<Uint8Array> {
    const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    const dataBase64 = Buffer.from(buffer).toString('base64')
    const result = await this.makeWalletRequest<string>('privateHash', {
      data: dataBase64,
      options,
    })
    return Buffer.from(result, 'base64')
  }

  /**
   * Add a token to the wallet
   */
  async addToken(
    id: string,
    type?: TokenType,
    gateway?: Gateway,
  ): Promise<void> {
    return this.makeWalletRequest<void>('addToken', { id, type, gateway })
  }

  /**
   * Check if a token is added to the wallet
   */
  async isTokenAdded(id: string): Promise<boolean> {
    return this.makeWalletRequest<boolean>('isTokenAdded', { id })
  }

  /**
   * Sign a data item (direct API method)
   * Returns the signed data item as a buffer
   */
  async signDataItem(
    dataItem: DataItem,
    options?: SignatureOptions,
  ): Promise<Uint8Array> {
    const params = {
      data:
        typeof dataItem.data === 'string'
          ? dataItem.data
          : Buffer.from(dataItem.data).toString('base64'),
      tags: dataItem.tags || [],
      target: dataItem.target,
      anchor: dataItem.anchor,
      options,
    }

    const result = await this.makeWalletRequest<{ signedDataItem: string }>(
      'signDataItem',
      params,
    )

    return Buffer.from(result.signedDataItem, 'base64')
  }

  /**
   * Sign a message
   */
  async signMessage(
    data: Uint8Array | ArrayBuffer,
    options?: SignMessageOptions,
  ): Promise<Uint8Array> {
    const buffer = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    const dataBase64 = Buffer.from(buffer).toString('base64')
    const result = await this.makeWalletRequest<string>('signMessage', {
      data: dataBase64,
      options,
    })
    return Buffer.from(result, 'base64')
  }

  /**
   * Verify a message signature
   */
  async verifyMessage(
    data: Uint8Array | ArrayBuffer,
    signature: ArrayBuffer | string,
    publicKey?: string,
    options?: SignMessageOptions,
  ): Promise<boolean> {
    const dataBuffer
      = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    const dataBase64 = Buffer.from(dataBuffer).toString('base64')
    const signatureBuffer
      = signature instanceof ArrayBuffer ? new Uint8Array(signature) : signature
    const signatureBase64 = Buffer.from(signatureBuffer).toString('base64')
    return this.makeWalletRequest<boolean>('verifyMessage', {
      data: dataBase64,
      signature: signatureBase64,
      publicKey,
      options,
    })
  }

  /**
   * Batch sign data items
   */
  async batchSignDataItem(
    dataItems: DataItem[],
    options?: SignatureOptions,
  ): Promise<Array<{ id: string, raw: Uint8Array }>> {
    // Convert data items to proper format
    const items = dataItems.map(item => ({
      data:
        typeof item.data === 'string'
          ? item.data
          : Buffer.from(item.data).toString('base64'),
      tags: item.tags || [],
      target: item.target,
      anchor: item.anchor,
    }))

    const results = await this.makeWalletRequest<
      Array<{ signedDataItem: string }>
    >('batchSignDataItem', { dataItems: items, options })

    // Convert results back to proper format
    return Promise.all(
      results.map(async (result) => {
        const signedBuffer = Buffer.from(result.signedDataItem, 'base64')
        const dataItem = new ArBundlesDataItem(signedBuffer)
        const itemId = await dataItem.id
        return {
          id: itemId,
          raw: new Uint8Array(signedBuffer),
        }
      }),
    )
  }

  /**
   * Generic method to make wallet requests
   */
  private async makeWalletRequest<T>(type: string, params: any): Promise<T> {
    const id = this.generateId()
    return new Promise((resolve, reject) => {
      // Set timeout
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Timeout waiting for ${type}`))
      }, 120000) // 120 second timeout

      // Store request with both callbacks and data
      this.pendingRequests.set(id, {
        resolve: (value: T) => {
          clearTimeout(timeout)
          resolve(value)
        },
        reject: (error: Error) => {
          clearTimeout(timeout)
          reject(error)
        },
        data: {
          type,
          params,
        },
      } as any)
    })
  }

  /**
   * Get the browser wallet signer (for direct use)
   */
  getDataItemSigner() {
    return this.createDataItemSigner()
  }

  /**
   * Create a DataItemSigner compatible with @permaweb/aoconnect
   * This delegates to browser wallet's signDataItem method
   * Uses arbundles DataItem class for proper ANS-104 handling
   */
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

      return {
        id: itemId,
        raw,
      }
    }
  }

  /**
   * Mark the process as complete and notify browser
   */
  markComplete(status: 'success' | 'failed' = 'success'): void {
    this.complete = true
    this.status = status
  }

  /**
   * Cleanup and close server
   */
  async close(status: 'success' | 'failed' = 'success'): Promise<void> {
    if (!this.server)
      return

    // Mark as complete if not already marked (defaults to success)
    if (!this.complete) {
      this.markComplete(status)
    }

    // Stop heartbeat checker
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    // Give browser a moment to receive completion message, then force close
    await new Promise(resolve => setTimeout(resolve, 500))

    // Destroy all active connections
    for (const conn of this.connections) {
      conn.destroy()
    }
    this.connections.clear()

    // Close server
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15)
  }

  private openBrowser(url: string) {
    const platform = process.platform
    let command: string

    switch (platform) {
      case 'darwin':
        command = `open "${url}"`
        break
      case 'win32':
        command = `start "${url}"`
        break
      default:
        command = `xdg-open "${url}"`
        break
    }

    exec(command, (error) => {
      if (error) {
        console.error('Failed to open browser automatically:', error.message)
        console.log(`Please open this URL manually: ${url}`)
      }
    })
  }

  private getSignerHTML(): string {
    // Load HTML and JS from separate files for better maintainability
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)

    const htmlPath = join(__dirname, 'signer.html')
    const jsPath = join(__dirname, 'signer.js')

    const html = readFileSync(htmlPath, 'utf-8')
    const js = readFileSync(jsPath, 'utf-8')

    // Replace the script src with inline script
    return html.replace(
      '<script src="signer.js"></script>',
      `<script>${js}</script>`,
    )
  }
}

/**
 * Creates a DataItemSigner compatible with @permaweb/aoconnect
 * Similar to aoconnect's createDataItemSigner but uses browser wallet
 */
export function createDataItemSigner(arweaveWallet: NodeArweaveWallet) {
  return arweaveWallet.getDataItemSigner()
}
