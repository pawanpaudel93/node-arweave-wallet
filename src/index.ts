/* eslint-disable ts/explicit-function-return-type */
/* eslint-disable no-console */
import type { SignatureOptions } from 'arweave/node/lib/crypto/crypto-interface'
import type Transaction from 'arweave/node/lib/transaction'
import { Buffer } from 'node:buffer'
import { exec } from 'node:child_process'
import http from 'node:http'
import process from 'node:process'
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

      // Listen on a random available port
      this.server.listen(0, '127.0.0.1', () => {
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
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AO Deploy - Browser Wallet Signer</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .container {
            background: white;
            border-radius: 20px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
            max-width: 500px;
            width: 100%;
            padding: 40px;
            text-align: center;
        }

        h1 {
            font-size: 28px;
            margin-bottom: 10px;
            color: #333;
        }

        .subtitle {
            color: #666;
            margin-bottom: 30px;
            font-size: 14px;
        }

        .status {
            padding: 15px;
            border-radius: 10px;
            margin-bottom: 20px;
            font-weight: 500;
        }

        .status.connecting {
            background: #fff3cd;
            color: #856404;
        }

        .status.connected {
            background: #d4edda;
            color: #155724;
        }

        .status.error {
            background: #f8d7da;
            color: #721c24;
        }

        .status.signing {
            background: #d1ecf1;
            color: #0c5460;
        }

        .wallet-address {
            background: #f8f9fa;
            padding: 10px;
            border-radius: 8px;
            font-family: 'Courier New', monospace;
            font-size: 12px;
            word-break: break-all;
            margin-top: 10px;
            color: #333;
        }

        button {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            border: none;
            padding: 12px 30px;
            border-radius: 25px;
            font-size: 16px;
            font-weight: 600;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
            margin-top: 20px;
        }

        button:hover {
            transform: translateY(-2px);
            box-shadow: 0 5px 15px rgba(0, 0, 0, 0.2);
        }

        button:active {
            transform: translateY(0);
        }

        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
            transform: none;
        }

        .spinner {
            border: 3px solid #f3f3f3;
            border-top: 3px solid #667eea;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .log {
            background: #f8f9fa;
            border-radius: 10px;
            padding: 15px;
            margin-top: 20px;
            max-height: 200px;
            overflow-y: auto;
            text-align: left;
            font-size: 12px;
            font-family: 'Courier New', monospace;
        }

        .log-entry {
            padding: 5px 0;
            color: #666;
            border-bottom: 1px solid #e9ecef;
        }

        .log-entry:last-child {
            border-bottom: none;
        }

        .log-entry.success {
            color: #28a745;
        }

        .log-entry.error {
            color: #dc3545;
        }

        .instructions {
            background: #e7f3ff;
            border-left: 4px solid #2196F3;
            padding: 15px;
            margin: 20px 0;
            text-align: left;
            border-radius: 5px;
            font-size: 14px;
            color: #333;
        }

        .instructions strong {
            color: #2196F3;
        }
    </style>
    <script src="https://unpkg.com/arweave/bundles/web.bundle.min.js"></script>
</head>
<body>
    <div class="container">
        <h1>🔐 AO Deploy Wallet Signer</h1>
        <p class="subtitle">Sign transactions with your Arweave wallet</p>

        <div id="status" class="status connecting">
            <div class="spinner"></div>
            Connecting to wallet...
        </div>

        <div id="walletInfo" style="display: none;">
            <div class="wallet-address" id="address"></div>
        </div>

        <div class="instructions">
            <strong>📋 Instructions:</strong><br>
            1. Make sure you have Wander or ArConnect installed<br>
            2. Click "Connect Wallet" below<br>
            3. Approve the requested permissions in your wallet<br>
            4. Keep this window open during the process<br>
            <br>
            <strong>✨ Supported Operations:</strong><br>
            • Address access & wallet management<br>
            • Transaction signing & dispatch<br>
            • Data item signing (ANS-104)<br>
            • Message signing & verification<br>
            • Data encryption & decryption<br>
            • Arbitrary data signatures<br>
            • Token management
        </div>

        <button id="connectBtn" onclick="connectWallet()">Connect Wallet</button>

        <div class="log" id="log"></div>
    </div>

    <script>
        let connected = false;
        let walletAddress = null;
        let polling = false;

        const arweave = Arweave.init({
          host: 'arweave.net',
          port: 443,
          protocol: 'https'
        });

        function log(message, type = 'info') {
            const logDiv = document.getElementById('log');
            const entry = document.createElement('div');
            entry.className = 'log-entry ' + type;
            entry.textContent = new Date().toLocaleTimeString() + ' - ' + message;
            logDiv.appendChild(entry);
            logDiv.scrollTop = logDiv.scrollHeight;
        }

        // Default permissions for comprehensive wallet operations
        const DEFAULT_PERMISSIONS = [
            'ACCESS_ADDRESS',
            'ACCESS_ALL_ADDRESSES',
            'SIGN_TRANSACTION',
            'ENCRYPT',
            'DECRYPT',
            'SIGNATURE',
            'ACCESS_PUBLIC_KEY',
            'ACCESS_ARWEAVE_CONFIG',
            'DISPATCH',
            'ACCESS_TOKENS'
        ];

        async function connectWallet() {
            const statusDiv = document.getElementById('status');
            const connectBtn = document.getElementById('connectBtn');

            try {
                if (!window.arweaveWallet) {
                    statusDiv.className = 'status error';
                    statusDiv.innerHTML = '❌ No Arweave wallet found. Please install Wander or ArConnect.';
                    log('No wallet extension found', 'error');
                    return;
                }

                log('Requesting wallet connection...');
                console.log('Wallet object available:', !!window.arweaveWallet);
                console.log('Requesting permissions:', DEFAULT_PERMISSIONS);
                
                // Request comprehensive permissions for all wallet operations
                await window.arweaveWallet.connect(DEFAULT_PERMISSIONS);

                walletAddress = await window.arweaveWallet.getActiveAddress();
                
                statusDiv.className = 'status connected';
                statusDiv.innerHTML = '✅ Wallet connected successfully!';
                
                document.getElementById('walletInfo').style.display = 'block';
                document.getElementById('address').textContent = walletAddress;
                
                connectBtn.style.display = 'none';
                
                log('Connected: ' + walletAddress, 'success');
                
                connected = true;
                
                // Polling is already running from page load
                
            } catch (error) {
                // Handle error with proper message extraction
                let errorMessage = 'Unknown error occurred';
                if (error && typeof error === 'object') {
                    if (error.message) {
                        errorMessage = error.message;
                    } else if (error.toString && error.toString() !== '[object Object]') {
                        errorMessage = error.toString();
                    } else {
                        errorMessage = 'User rejected wallet connection or wallet not available';
                    }
                } else if (error) {
                    errorMessage = String(error);
                }
                
                statusDiv.className = 'status error';
                statusDiv.innerHTML = '❌ Failed to connect: ' + errorMessage;
                log('Connection failed: ' + errorMessage, 'error');
                
                // Show the connect button again so user can retry
                connectBtn.style.display = 'block';
            }
        }

        async function handleRequest(request) {
            const statusDiv = document.getElementById('status');

            try {
                // Get the full request data
                const dataResponse = await fetch('/get-request', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ id: request.id })
                });
                const requestData = await dataResponse.json();
                const params = requestData.params || {};

                if (request.type === 'connect') {
                    statusDiv.className = 'status signing';
                    statusDiv.innerHTML = '✍️ Please approve the connection in your wallet...';
                    log('Programmatic connection request...');

                    try {
                        console.log('Connecting with permissions:', params.permissions);
                        console.log('App info:', params.appInfo);
                        console.log('Gateway:', params.gateway);
                        
                        await window.arweaveWallet.connect(params.permissions, params.appInfo, params.gateway);
                        
                        // Update wallet address after connection
                        walletAddress = await window.arweaveWallet.getActiveAddress();
                        console.log('Wallet connected, address:', walletAddress);
                        
                        // Update UI if not already connected
                        if (!connected) {
                            document.getElementById('walletInfo').style.display = 'block';
                            document.getElementById('address').textContent = walletAddress;
                            document.getElementById('connectBtn').style.display = 'none';
                            connected = true;
                            console.log('Wallet connected, polling already active');
                        }
                        
                        await sendResponse(request.id, null);
                        
                        statusDiv.className = 'status connected';
                        statusDiv.innerHTML = '✅ Wallet connected - Ready for signing';
                        log('Wallet connected programmatically: ' + walletAddress, 'success');
                    } catch (err) {
                        const errorMsg = err instanceof Error ? err.message : String(err);
                        console.error('Connect error:', err);
                        log('Connection failed: ' + errorMsg, 'error');
                        throw new Error('Failed to connect: ' + errorMsg);
                    }
                }
                else if (request.type === 'address') {
                    log('Providing wallet address...');
                    await sendResponse(request.id, walletAddress);
                    log('Address sent successfully', 'success');
                } 
                else if (request.type === 'disconnect') {
                    log('Disconnecting wallet...');
                    await window.arweaveWallet.disconnect();
                    await sendResponse(request.id, null);
                    log('Wallet disconnected', 'success');
                }
                else if (request.type === 'getAllAddresses') {
                    log('Getting all addresses...');
                    const addresses = await window.arweaveWallet.getAllAddresses();
                    await sendResponse(request.id, addresses);
                    log('All addresses retrieved', 'success');
                }
                else if (request.type === 'getWalletNames') {
                    log('Getting wallet names...');
                    const names = await window.arweaveWallet.getWalletNames();
                    await sendResponse(request.id, names);
                    log('Wallet names retrieved', 'success');
                }
                else if (request.type === 'getPermissions') {
                    log('Getting permissions...');
                    const permissions = await window.arweaveWallet.getPermissions();
                    await sendResponse(request.id, permissions);
                    log('Permissions retrieved', 'success');
                }
                else if (request.type === 'getArweaveConfig') {
                    log('Getting Arweave config...');
                    const config = await window.arweaveWallet.getArweaveConfig();
                    await sendResponse(request.id, config);
                    log('Config retrieved', 'success');
                }
                else if (request.type === 'getPublicKey') {
                    log('Getting public key...');
                    const publicKey = await window.arweaveWallet.getActivePublicKey();
                    await sendResponse(request.id, publicKey);
                    log('Public key retrieved', 'success');
                }
                else if (request.type === 'signature') {
                    statusDiv.className = 'status signing';
                    statusDiv.innerHTML = '✍️ Please sign the data in your wallet...';
                    log('Signature request, please check your wallet...');

                    // Convert base64 data back to Uint8Array
                    const binaryString = atob(params.data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }

                    const signature = await window.arweaveWallet.signature(bytes, params.algorithm);
                    
                    // Convert signature to base64
                    const signatureArray = new Uint8Array(signature);
                    let binary = '';
                    for (let i = 0; i < signatureArray.length; i++) {
                        binary += String.fromCharCode(signatureArray[i]);
                    }
                    const signatureBase64 = btoa(binary);

                    await sendResponse(request.id, signatureBase64);
                    statusDiv.className = 'status connected';
                    statusDiv.innerHTML = '✅ Wallet connected - Ready for signing';
                    log('Signature created successfully!', 'success');
                }
                else if (request.type === 'sign') {
                    statusDiv.className = 'status signing';
                    statusDiv.innerHTML = '✍️ Please sign the transaction in your wallet...';
                    log('Transaction signing request, please check your wallet...');

                    try {
                        params.transaction.data = arweave.utils.b64UrlToBuffer(params.transaction.data);
                    
                        // Reconstruct the transaction object from JSON
                        const transaction = await arweave.createTransaction(params.transaction);

                        const signedTx = await window.arweaveWallet.sign(transaction, params.options);
                        console.log("Signed transaction:", signedTx);

                        await sendResponse(request.id, signedTx.toJSON());
                        
                        statusDiv.className = 'status connected';
                        statusDiv.innerHTML = '✅ Wallet connected - Ready for signing';
                        log('Transaction signed successfully!', 'success');
                    } catch (err) {
                        const errorMsg = err instanceof Error ? err.message : String(err);
                        log('Failed to sign transaction: ' + errorMsg, 'error');
                        throw new Error('Failed to sign transaction: ' + errorMsg);
                    }
                }
                else if (request.type === 'dispatch') {
                    statusDiv.className = 'status signing';
                    statusDiv.innerHTML = '✍️ Please approve the transaction in your wallet...';
                    log('Transaction dispatch request, please check your wallet...');

                    try {
                        params.transaction.data = arweave.utils.b64UrlToBuffer(params.transaction.data);
                        console.log("Transaction:", params.transaction);
                        const transaction = await arweave.createTransaction(params.transaction);
                        const result = await window.arweaveWallet.dispatch(transaction, params.options);
                        await sendResponse(request.id, result);
                        
                        statusDiv.className = 'status connected';
                        statusDiv.innerHTML = '✅ Wallet connected - Ready for signing';
                        log('Transaction dispatched successfully!', 'success');
                    } catch (err) {
                        const errorMsg = err instanceof Error ? err.message : String(err);
                        log('Failed to dispatch transaction: ' + errorMsg, 'error');
                        throw new Error('Failed to dispatch transaction: ' + errorMsg);
                    }
                }
                else if (request.type === 'encrypt') {
                    statusDiv.className = 'status signing';
                    statusDiv.innerHTML = '🔒 Encrypting data...';
                    log('Encryption request...');

                    let dataToEncrypt = params.data;
                    // Check if data is base64 encoded (binary)
                    try {
                        const binaryString = atob(params.data);
                        const bytes = new Uint8Array(binaryString.length);
                        for (let i = 0; i < binaryString.length; i++) {
                            bytes[i] = binaryString.charCodeAt(i);
                        }
                        dataToEncrypt = bytes;
                    } catch (e) {
                        // Keep as string if not base64
                    }

                    const encrypted = await window.arweaveWallet.encrypt(dataToEncrypt, params.options);
                    
                    // Convert to base64
                    const encryptedArray = new Uint8Array(encrypted);
                    let binary = '';
                    for (let i = 0; i < encryptedArray.length; i++) {
                        binary += String.fromCharCode(encryptedArray[i]);
                    }
                    const encryptedBase64 = btoa(binary);

                    await sendResponse(request.id, encryptedBase64);
                    statusDiv.className = 'status connected';
                    statusDiv.innerHTML = '✅ Wallet connected - Ready for signing';
                    log('Data encrypted successfully!', 'success');
                }
                else if (request.type === 'decrypt') {
                    statusDiv.className = 'status signing';
                    statusDiv.innerHTML = '🔓 Decrypting data...';
                    log('Decryption request...');

                    // Convert base64 to Uint8Array
                    const binaryString = atob(params.data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }

                    const decrypted = await window.arweaveWallet.decrypt(bytes, params.options);
                    
                    // Convert to base64
                    const decryptedArray = new Uint8Array(decrypted);
                    let binary = '';
                    for (let i = 0; i < decryptedArray.length; i++) {
                        binary += String.fromCharCode(decryptedArray[i]);
                    }
                    const decryptedBase64 = btoa(binary);

                    await sendResponse(request.id, decryptedBase64);
                    statusDiv.className = 'status connected';
                    statusDiv.innerHTML = '✅ Wallet connected - Ready for signing';
                    log('Data decrypted successfully!', 'success');
                }
                else if (request.type === 'signDataItem') {
                    statusDiv.className = 'status signing';
                    statusDiv.innerHTML = '✍️ Please sign the data item in your wallet...';
                    log('Data item signing request, please check your wallet...');

                    // Convert base64 data to Uint8Array if needed
                    let dataToSign = params.data;
                    if (typeof dataToSign === 'string') {
                        try {
                            const binaryString = atob(dataToSign);
                            const bytes = new Uint8Array(binaryString.length);
                            for (let i = 0; i < binaryString.length; i++) {
                                bytes[i] = binaryString.charCodeAt(i);
                            }
                            dataToSign = bytes;
                        } catch (e) {
                            // If it's not base64, keep as string
                        }
                    }

                    // Sign data item with wallet (with optional signature options)
                    const signedDataItem = await window.arweaveWallet.signDataItem({
                        data: dataToSign,
                        tags: params.tags || [],
                        target: params.target,
                        anchor: params.anchor
                    }, params.options);

                    // Convert ArrayBuffer to base64 for transfer
                    const signedArray = new Uint8Array(signedDataItem);
                    let binary = '';
                    for (let i = 0; i < signedArray.length; i++) {
                        binary += String.fromCharCode(signedArray[i]);
                    }
                    const signedBase64 = btoa(binary);

                    await sendResponse(request.id, {
                        signedDataItem: signedBase64
                    });

                    statusDiv.className = 'status connected';
                    statusDiv.innerHTML = '✅ Wallet connected - Ready for signing';
                    log('Data item signed successfully!', 'success');
                }
                else if (request.type === 'privateHash') {
                    statusDiv.className = 'status signing';
                    statusDiv.innerHTML = '🔐 Creating private hash...';
                    log('Private hash request...');

                    // Convert base64 data back to Uint8Array
                    const binaryString = atob(params.data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }

                    console.log({bytes, options: params.options});

                    const hash = await window.arweaveWallet.privateHash(bytes, params.options);
                    
                    // Convert hash to base64
                    const hashArray = new Uint8Array(hash);
                    let binary = '';
                    for (let i = 0; i < hashArray.length; i++) {
                        binary += String.fromCharCode(hashArray[i]);
                    }
                    const hashBase64 = btoa(binary);

                    await sendResponse(request.id, hashBase64);
                    statusDiv.className = 'status connected';
                    statusDiv.innerHTML = '✅ Wallet connected - Ready for signing';
                    log('Private hash created successfully!', 'success');
                }
                else if (request.type === 'addToken') {
                    log('Adding token to wallet...');
                    await window.arweaveWallet.addToken(params.id, params.type, params.gateway);
                    await sendResponse(request.id, null);
                    log('Token added successfully!', 'success');
                }
                else if (request.type === 'isTokenAdded') {
                    log('Checking if token is added...');
                    const isAdded = await window.arweaveWallet.isTokenAdded(params.id);
                    await sendResponse(request.id, isAdded);
                    log('Token ' + (isAdded ? 'is' : 'is not') + ' added', 'success');
                }
                else if (request.type === 'signMessage') {
                    statusDiv.className = 'status signing';
                    statusDiv.innerHTML = '✍️ Please sign the message in your wallet...';
                    log('Message signing request, please check your wallet...');

                    // Convert message data
                    const binaryString = atob(params.data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }

                    const signature = await window.arweaveWallet.signMessage(bytes, params.options);
                    
                    // Convert signature to base64
                    const signatureArray = new Uint8Array(signature);
                    let binary = '';
                    for (let i = 0; i < signatureArray.length; i++) {
                        binary += String.fromCharCode(signatureArray[i]);
                    }
                    const signatureBase64 = btoa(binary);

                    await sendResponse(request.id, signatureBase64);
                    statusDiv.className = 'status connected';
                    statusDiv.innerHTML = '✅ Wallet connected - Ready for signing';
                    log('Message signed successfully!', 'success');
                }
                else if (request.type === 'verifyMessage') {
                    log('Verifying message signature...');

                    // Convert message data
                    const binaryString = atob(params.data);
                    const bytes = new Uint8Array(binaryString.length);
                    for (let i = 0; i < binaryString.length; i++) {
                        bytes[i] = binaryString.charCodeAt(i);
                    }

                    // Convert signature from base64
                    const sigBinaryString = atob(params.signature);
                    const sigBytes = new Uint8Array(sigBinaryString.length);
                    for (let i = 0; i < sigBinaryString.length; i++) {
                        sigBytes[i] = sigBinaryString.charCodeAt(i);
                    }

                    const isValid = await window.arweaveWallet.verifyMessage(
                        bytes,
                        sigBytes,
                        params.publicKey,
                        params.options
                    );
                    
                    await sendResponse(request.id, isValid);
                    log('Message verification: ' + (isValid ? 'valid' : 'invalid'), 'success');
                }
                else if (request.type === 'batchSignDataItem') {
                    statusDiv.className = 'status signing';
                    statusDiv.innerHTML = '✍️ Please sign multiple data items in your wallet...';
                    log('Batch signing request for ' + params.dataItems.length + ' items...');

                    // Convert data items
                    const items = params.dataItems.map(item => {
                        let data = item.data;
                        if (typeof data === 'string') {
                            try {
                                const binaryString = atob(data);
                                const bytes = new Uint8Array(binaryString.length);
                                for (let i = 0; i < binaryString.length; i++) {
                                    bytes[i] = binaryString.charCodeAt(i);
                                }
                                data = bytes;
                            } catch (e) {
                                // Keep as string if not base64
                            }
                        }
                        return {
                            data: data,
                            tags: item.tags || [],
                            target: item.target,
                            anchor: item.anchor
                        };
                    });

                    const signedItems = await window.arweaveWallet.batchSignDataItem(items, params.options);
                    
                    // Convert signed items to base64
                    const results = signedItems.map(signedItem => {
                        const signedArray = new Uint8Array(signedItem);
                        let binary = '';
                        for (let i = 0; i < signedArray.length; i++) {
                            binary += String.fromCharCode(signedArray[i]);
                        }
                        return {
                            signedDataItem: btoa(binary)
                        };
                    });

                    await sendResponse(request.id, results);
                    statusDiv.className = 'status connected';
                    statusDiv.innerHTML = '✅ Wallet connected - Ready for signing';
                    log('Batch signed ' + results.length + ' items successfully!', 'success');
                }
                else {
                    log('Unknown request type: ' + request.type, 'error');
                    await sendResponse(request.id, null, 'Unknown request type: ' + request.type);
                }
            } catch (error) {
                statusDiv.className = 'status error';
                statusDiv.innerHTML = '❌ Operation failed: ' + error.message;
                log('Error: ' + error.message, 'error');
                await sendResponse(request.id, null, error.message);
                
                // Reset status after error
                setTimeout(() => {
                    if (connected) {
                        statusDiv.className = 'status connected';
                        statusDiv.innerHTML = '✅ Wallet connected - Ready for signing';
                    }
                }, 3000);
            }
        }

        async function sendResponse(id, result, error = null) {
            await fetch('/response', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id, result, error })
            });
        }

        // Auto-connect if wallet is available
        window.addEventListener('load', () => {
            // Start polling immediately so we can receive programmatic connect requests
            // Set a minimal connected state to enable polling
            startPollingForRequests();
            
            // Wait a bit for wallet extensions to inject
            setTimeout(() => {
                if (window.arweaveWallet) {
                    // Check if already connected
                    window.arweaveWallet.getActiveAddress()
                        .then(address => {
                            if (address) {
                                log('Wallet already connected, attempting auto-connect...');
                                connectWallet();
                            } else {
                                log('Ready to connect wallet (click button or wait for programmatic connect)');
                            }
                        })
                        .catch(() => {
                            // Not connected yet
                            log('Ready to connect wallet (click button or wait for programmatic connect)');
                        });
                } else {
                    document.getElementById('status').className = 'status error';
                    document.getElementById('status').innerHTML = '❌ No Arweave wallet extension detected<br><small>Please install Wander or ArConnect and refresh this page</small>';
                    log('Please install Wander or ArConnect extension', 'error');
                    console.error('window.arweaveWallet is not available. Please install a compatible wallet extension.');
                }
            }, 500); // Give wallet extension time to inject
        });

        // Start polling for requests (independent of wallet connection state)
        async function startPollingForRequests() {
            if (polling) return;
            polling = true;
            log('Started listening for requests from CLI...');

            while (true) {
                try {
                    const response = await fetch('/poll', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' }
                    });

                    const request = await response.json();

                    // Check if the process is complete
                    if (request.completed) {
                        if (request.status === 'success') {
                            log('✅ Process successful!', 'success');
                            document.getElementById('status').className = 'status connected';
                            document.getElementById('status').innerHTML = '✅ Process complete! You can close this window.';
                        } else {
                            log('❌ Process failed!', 'error');
                            document.getElementById('status').className = 'status error';
                            document.getElementById('status').innerHTML = '❌ Process failed. Check your CLI for details.';
                        }
                        break; // Stop polling
                    }

                    if (request.id && request.type) {
                        await handleRequest(request);
                    }

                    // Small delay before next poll
                    await new Promise(resolve => setTimeout(resolve, 100));

                } catch (error) {
                    console.error('Polling error:', error);
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }
    </script>
</body>
</html>`
  }
}

/**
 * Creates a DataItemSigner compatible with @permaweb/aoconnect
 * Similar to aoconnect's createDataItemSigner but uses browser wallet
 */
export function createDataItemSigner(arweaveWallet: NodeArweaveWallet) {
  return arweaveWallet.getDataItemSigner()
}
