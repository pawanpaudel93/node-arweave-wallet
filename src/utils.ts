import { Buffer } from 'node:buffer'

export function bufferToBase64(buffer: Uint8Array | ArrayBuffer): string {
  const uint8Array = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : buffer
  return Buffer.from(uint8Array).toString('base64')
}

export function base64ToBuffer(base64: string): Uint8Array {
  return Buffer.from(base64, 'base64')
}
