import type { DataItemCreateOptions } from '@dha-team/arbundles'

export interface SigningResponse {
  id: string
  result?: any
  error?: string
}

export interface PendingRequest {
  resolve: (value: any) => void
  reject: (error: Error) => void
  data?: {
    type: string
    params: any
  }
}

export type PermissionType =
  | 'ACCESS_ADDRESS'
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

export interface SignDataItemParams extends DataItemCreateOptions {
  data: string | Uint8Array
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

export type BufferSource = ArrayBufferView | ArrayBuffer

export interface RsaOaepParams {
  name: 'RSA-OAEP'
  label?: BufferSource
}

export interface AesCtrParams {
  name: 'AES-CTR'
  counter: BufferSource
  length: number
}

export interface AesCbcParams {
  name: 'AES-CBC'
  iv: BufferSource
}

export interface AesGcmParams {
  name: 'AES-GCM'
  iv: BufferSource
  additionalData?: BufferSource
  tagLength?: number
}

// New API format (current)
export type EncryptDecryptAlgorithm = RsaOaepParams | AesCtrParams | AesCbcParams | AesGcmParams

// Old deprecated format (for backwards compatibility)
export interface DeprecatedEncryptDecryptOptions {
  algorithm: string
  hash: string
  salt?: string
}

export type EncryptDecryptOptions = EncryptDecryptAlgorithm | DeprecatedEncryptDecryptOptions

export interface TokenInfo {
  id?: string
  Name?: string
  Ticker?: string
  Logo?: string
  Denomination: number
  processId: string
  lastUpdated?: string | null
  type?: 'asset' | 'collectible'
  hidden?: boolean
  balance?: string
}

export type Tier = 'Prime' | 'Edge' | 'Reserve' | 'Select' | 'Core'

export interface ActiveTier {
  tier: Tier
  balance: string
  rank: '' | number
  progress: number
  snapshotTimestamp: number
  totalHolders: number
}

export interface NodeArweaveWalletConfig {
  port?: number // Port to listen on (default: 3737, use 0 for random)
  freePort?: boolean // Automatically free port if it's already in use (default: false)
}
