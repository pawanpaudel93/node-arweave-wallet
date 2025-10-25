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
import { nanoid } from 'nanoid'

// ==================== Type Definitions ====================
interface SigningResponse {
  id: string
  result?: any
  error?: string
}

interface PendingRequest {
  resolve: (value: any) => void
  reject: (error: Error) => void
  data?: {
    type: string
    params: any
  }
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

export interface NodeArweaveWalletConfig {
  port?: number // Port to listen on (default: 3737, use 0 for random)
}

// ==================== Constants ====================
const DEFAULT_PORT = 3737
const DEFAULT_HOST = '127.0.0.1'
const REQUEST_TIMEOUT = 120000 // 120 seconds
const BROWSER_TIMEOUT = 30000 // 30 seconds
const HEARTBEAT_CHECK_INTERVAL = 10000 // 10 seconds - check infrequently to reduce overhead
const HEARTBEAT_TIMEOUT = 300000 // 5 minutes - very generous timeout for user interactions
const SHUTDOWN_DELAY = 500 // 500ms
const BROWSER_READY_DELAY = 500 // 500ms

const ARWEAVE_CONFIG = {
  host: 'arweave.net',
  port: 443,
  protocol: 'https' as const,
}

const arweave = new Arweave(ARWEAVE_CONFIG)

// ==================== Helper Functions ====================
function bufferToBase64(buffer: Uint8Array | ArrayBuffer): string {
  const uint8Array = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer
  return Buffer.from(uint8Array).toString('base64')
}

function base64ToBuffer(base64: string): Uint8Array {
  return Buffer.from(base64, 'base64')
}

// ==================== NodeArweaveWallet Class ====================
export class NodeArweaveWallet {
  private server: http.Server | null = null
  private port: number = 0
  private readonly config: NodeArweaveWalletConfig
  private readonly pendingRequests = new Map<string, PendingRequest>()
  private sseClient: http.ServerResponse | null = null

  private address: string | null = null
  private browserConnected = false
  private lastHeartbeat = Date.now()
  private heartbeatInterval: NodeJS.Timeout | null = null
  private complete = false

  constructor(config: NodeArweaveWalletConfig = {}) {
    this.config = {
      port: config.port ?? DEFAULT_PORT,
    }
  }

  // ==================== Public API ====================
  /**
   * Start the local server and open the browser
   */
  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => this.handleRequest(req, res))

      this.server.listen(this.config.port, DEFAULT_HOST, () => {
        const addr = this.server!.address() as any
        this.port = addr.port
        console.log(`\n🌐 Arweave wallet signer started at http://localhost:${this.port}`)
        console.log('📱 Opening browser for wallet connection...\n')

        this.openBrowser(`http://localhost:${this.port}`)
        this.startHeartbeatChecker()

        resolve()
      })

      this.server.on('error', (error: any) => {
        if (error.code === 'EADDRINUSE') {
          const errorMsg = `Port ${this.config.port} is already in use. `
            + `Please either:\n`
            + `  1. Close the application using port ${this.config.port}, or\n`
            + `  2. Use a different port: new NodeArweaveWallet({ port: 0 }) for automatic selection`
          reject(new Error(errorMsg))
        }
        else {
          reject(error)
        }
      })
    })
  }

  /**
   * Connect wallet programmatically
   */
  async connect(
    permissions: PermissionType[],
    appInfo?: AppInfo,
    gateway?: Gateway,
  ): Promise<void> {
    await this.waitForBrowserConnection()
    return this.makeWalletRequest<void>('connect', { permissions, appInfo, gateway })
  }

  /**
   * Get active wallet address from browser
   */
  async getActiveAddress(): Promise<string> {
    if (this.address)
      return this.address

    this.address = await this.makeWalletRequest<string>('getActiveAddress', {})
    return this.address
  }

  async disconnect(): Promise<void> {
    return this.makeWalletRequest<void>('disconnect', {})
  }

  async getAllAddresses(): Promise<string[]> {
    return this.makeWalletRequest<string[]>('getAllAddresses', {})
  }

  async getWalletNames(): Promise<{ [address: string]: string }> {
    return this.makeWalletRequest<{ [address: string]: string }>('getWalletNames', {})
  }

  async getPermissions(): Promise<PermissionType[]> {
    return this.makeWalletRequest<PermissionType[]>('getPermissions', {})
  }

  async getArweaveConfig(): Promise<Gateway> {
    return this.makeWalletRequest<Gateway>('getArweaveConfig', {})
  }

  async getActivePublicKey(): Promise<string> {
    return this.makeWalletRequest<string>('getPublicKey', {})
  }

  async signature(
    data: Uint8Array,
    algorithm: AlgorithmIdentifier | RsaPssParams | EcdsaParams,
  ): Promise<Uint8Array> {
    const dataBase64 = bufferToBase64(data)
    const result = await this.makeWalletRequest<string>('signature', { data: dataBase64, algorithm })
    return base64ToBuffer(result)
  }

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

  async dispatch(transaction: Transaction, options?: SignatureOptions): Promise<DispatchResult> {
    return this.makeWalletRequest<DispatchResult>('dispatch', { transaction, options })
  }

  async encrypt(
    data: string | Uint8Array,
    options: { algorithm: string, hash: string, salt?: string },
  ): Promise<Uint8Array> {
    const dataToEncrypt = typeof data === 'string' ? data : bufferToBase64(data)
    const result = await this.makeWalletRequest<string>('encrypt', { data: dataToEncrypt, options })
    return base64ToBuffer(result)
  }

  async decrypt(
    data: Uint8Array,
    options: { algorithm: string, hash: string, salt?: string },
  ): Promise<Uint8Array> {
    const dataBase64 = bufferToBase64(data)
    const result = await this.makeWalletRequest<string>('decrypt', { data: dataBase64, options })
    return base64ToBuffer(result)
  }

  async privateHash(data: Uint8Array | ArrayBuffer, options?: SignMessageOptions): Promise<Uint8Array> {
    const dataBase64 = bufferToBase64(data)
    const result = await this.makeWalletRequest<string>('privateHash', { data: dataBase64, options })
    return base64ToBuffer(result)
  }

  async addToken(id: string, type?: TokenType, gateway?: Gateway): Promise<void> {
    return this.makeWalletRequest<void>('addToken', { id, type, gateway })
  }

  async isTokenAdded(id: string): Promise<boolean> {
    return this.makeWalletRequest<boolean>('isTokenAdded', { id })
  }

  async signDataItem(dataItem: DataItem, options?: SignatureOptions): Promise<Uint8Array> {
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

  async signMessage(data: Uint8Array | ArrayBuffer, options?: SignMessageOptions): Promise<Uint8Array> {
    const dataBase64 = bufferToBase64(data)
    const result = await this.makeWalletRequest<string>('signMessage', { data: dataBase64, options })
    return base64ToBuffer(result)
  }

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

  async batchSignDataItem(
    dataItems: DataItem[],
    options?: SignatureOptions,
  ): Promise<Array<{ id: string, raw: Uint8Array }>> {
    const items = dataItems.map(item => ({
      data: typeof item.data === 'string' ? item.data : bufferToBase64(item.data),
      tags: item.tags || [],
      target: item.target,
      anchor: item.anchor,
    }))

    const results = await this.makeWalletRequest<Array<{ signedDataItem: string }>>(
      'batchSignDataItem',
      { dataItems: items, options },
    )

    return Promise.all(
      results.map(async (result) => {
        const signedBuffer = base64ToBuffer(result.signedDataItem)
        const dataItem = new ArBundlesDataItem(Buffer.from(signedBuffer))
        const itemId = await dataItem.id
        return { id: itemId, raw: signedBuffer }
      }),
    )
  }

  getDataItemSigner() {
    return this.createDataItemSigner()
  }

  markComplete(status: 'success' | 'failed' = 'success'): void {
    this.complete = true

    // Notify SSE client
    if (this.sseClient) {
      this.sendSSEComplete(status)
    }
  }

  async close(status: 'success' | 'failed' = 'success'): Promise<void> {
    if (!this.server)
      return

    if (!this.complete) {
      this.markComplete(status)
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval)
      this.heartbeatInterval = null
    }

    await new Promise(resolve => setTimeout(resolve, SHUTDOWN_DELAY))

    // Close SSE connection if open
    if (this.sseClient) {
      try {
        this.sseClient.end()
      }
      catch {
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
  private startHeartbeatChecker(): void {
    this.heartbeatInterval = setInterval(() => {
      const timeSinceLastHeartbeat = Date.now() - this.lastHeartbeat

      // Only check if we have pending requests - no need to check if nothing is pending
      if (this.browserConnected && this.pendingRequests.size > 0 && timeSinceLastHeartbeat > HEARTBEAT_TIMEOUT) {
        const timeoutMinutes = Math.floor(HEARTBEAT_TIMEOUT / 60000)
        console.log(`\n⚠️  Browser connection timeout - no response for ${timeoutMinutes} minutes`)
        console.log('💡 The browser tab may have been closed.')
        console.log('💡 Tip: Keep the browser window open while signing transactions.')
        this.browserConnected = false

        // Reject pending requests with a helpful error message
        for (const [id, pending] of this.pendingRequests.entries()) {
          pending.reject(
            new Error(
              `Browser connection timeout after ${timeoutMinutes} minutes. `
              + 'Please ensure the browser window stays open during signing operations.',
            ),
          )
          this.pendingRequests.delete(id)
        }
      }
    }, HEARTBEAT_CHECK_INTERVAL)
  }

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
    }
    else {
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
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    })

    // Mark browser as connected
    this.lastHeartbeat = Date.now()
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

    // Handle client disconnect
    res.on('close', () => {
      if (this.sseClient === res) {
        this.sseClient = null
        this.browserConnected = false
      }
    })
  }

  private sendSSERequest(id: string, type: string, data: any): void {
    if (!this.sseClient)
      return

    const event = JSON.stringify({ id, type, data })
    try {
      this.sseClient.write(`data: ${event}\n\n`)
    }
    catch (error) {
      console.error('Failed to send SSE request:', error)
      this.sseClient = null
    }
  }

  private sendSSEComplete(status: 'success' | 'failed'): void {
    if (!this.sseClient)
      return

    const event = JSON.stringify({ type: 'completed', status })
    try {
      this.sseClient.write(`data: ${event}\n\n`)
    }
    catch (error) {
      console.error('Failed to send SSE completion:', error)
      this.sseClient = null
    }
  }

  private handleResponse(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.readRequestBody(req, (body) => {
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

        this.sendJSON(res, 200, { success: true })
      }
      catch (error: any) {
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
    const initialHeartbeat = this.lastHeartbeat
    const checkInterval = 100 // Check every 100ms

    while (this.lastHeartbeat === initialHeartbeat && Date.now() - startTime < timeout) {
      await new Promise(resolve => setTimeout(resolve, checkInterval))
    }

    if (this.lastHeartbeat === initialHeartbeat) {
      throw new Error('Browser page not responding. Please ensure the browser window is open.')
    }

    await new Promise(resolve => setTimeout(resolve, BROWSER_READY_DELAY))
  }

  private async makeWalletRequest<T>(type: string, params: any): Promise<T> {
    const id = nanoid()
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Timeout waiting for ${type}`))
      }, REQUEST_TIMEOUT)

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

  private openBrowser(url: string): void {
    const commands: Record<string, string> = {
      darwin: `open "${url}"`,
      win32: `start "${url}"`,
    }

    const command = commands[process.platform] || `xdg-open "${url}"`

    exec(command, (error) => {
      if (error) {
        console.error('Failed to open browser automatically:', error.message)
        console.log(`Please open this URL manually: ${url}`)
      }
    })
  }

  private getSignerHTML(): string {
    const __filename = fileURLToPath(import.meta.url)
    const __dirname = dirname(__filename)

    const htmlPath = join(__dirname, 'signer.html')
    const jsPath = join(__dirname, 'signer.js')

    const html = readFileSync(htmlPath, 'utf-8')
    const js = readFileSync(jsPath, 'utf-8')

    return html.replace('<script src="signer.js"></script>', `<script>${js}</script>`)
  }
}

// ==================== Exports ====================
/**
 * Creates a DataItemSigner compatible with @permaweb/aoconnect
 * Similar to aoconnect's createDataItemSigner but uses browser wallet
 */
export function createDataItemSigner(arweaveWallet: NodeArweaveWallet) {
  return arweaveWallet.getDataItemSigner()
}
