import Arweave from 'arweave'

export const DEFAULT_PORT = 3737
export const DEFAULT_HOST = '127.0.0.1'
export const DEFAULT_REQUEST_TIMEOUT = 300000 // 5 minutes
export const BROWSER_TIMEOUT = 30000 // 30 seconds
export const SHUTDOWN_DELAY = 500 // 500ms
export const BROWSER_READY_DELAY = 500 // 500ms

export const ARWEAVE_CONFIG = {
  host: 'arweave.net',
  port: 443,
  protocol: 'https' as const,
}

export const arweave = new Arweave(ARWEAVE_CONFIG)

export const DATAITEM_SIGNER_KIND = 'ans104'
export const HTTP_SIGNER_KIND = 'httpsig'
