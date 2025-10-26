import Arweave from 'arweave'

export const DEFAULT_PORT = 3737
export const DEFAULT_HOST = '127.0.0.1'
export const REQUEST_TIMEOUT = 120000 // 120 seconds
export const BROWSER_TIMEOUT = 30000 // 30 seconds
export const SHUTDOWN_DELAY = 500 // 500ms
export const BROWSER_READY_DELAY = 500 // 500ms

export const ARWEAVE_CONFIG = {
  host: 'arweave.net',
  port: 443,
  protocol: 'https' as const,
}

export const arweave = new Arweave(ARWEAVE_CONFIG)
