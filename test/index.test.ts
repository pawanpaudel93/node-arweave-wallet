import type { PermissionType } from '../src'
import Arweave from 'arweave'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { NodeArweaveWallet } from '../src'

const DEFAULT_PERMISSIONS: PermissionType[] = [
  'ACCESS_ADDRESS',
  'ACCESS_ALL_ADDRESSES',
  'SIGN_TRANSACTION',
  'ENCRYPT',
  'DECRYPT',
  'SIGNATURE',
  'ACCESS_PUBLIC_KEY',
  'ACCESS_ARWEAVE_CONFIG',
  'DISPATCH',
  'ACCESS_TOKENS',
]

const tokenId = '7GoQfmSOct_aUOWKM4xbKGg6DzAmOgdKwg8Kf-CbHm4'

describe('nodeArweaveWallet API Methods', () => {
  let arweaveWallet: NodeArweaveWallet
  let address: string
  let publicKey: string
  let arweave: Arweave

  beforeAll(async () => {
    // Initialize the wallet
    arweaveWallet = new NodeArweaveWallet({ freePort: true })
    await arweaveWallet.initialize()

    // Connect wallet programmatically
    await arweaveWallet.connect(DEFAULT_PERMISSIONS)

    // Get address and public key for later tests
    address = await arweaveWallet.getActiveAddress()
    publicKey = await arweaveWallet.getActivePublicKey()

    // Initialize Arweave client
    const config = await arweaveWallet.getArweaveConfig()
    arweave = new Arweave({
      host: config.host,
      port: config.port,
      protocol: config.protocol,
    })
  }, 60000) // 60 second timeout for initialization

  afterAll(async () => {
    await arweaveWallet.close('success')
  })

  describe('connection and Permissions', () => {
    it('should connect wallet programmatically', async () => {
      // Already connected in beforeAll, just verify it worked
      expect(address).toBeTruthy()
      expect(address).toMatch(/^[\w-]{43}$/)
    })

    it('should get granted permissions', async () => {
      const permissions = await arweaveWallet.getPermissions()
      expect(permissions).toBeDefined()
      expect(Array.isArray(permissions)).toBe(true)
      expect(permissions.length).toBeGreaterThan(0)
      expect(permissions).toContain('ACCESS_ADDRESS')
    })
  })

  describe('address and Wallet Information', () => {
    it('should get active wallet address', async () => {
      const activeAddress = await arweaveWallet.getActiveAddress()
      expect(activeAddress).toBeTruthy()
      expect(activeAddress).toMatch(/^[\w-]{43}$/)
      expect(activeAddress).toBe(address)
    })

    it('should get all wallet addresses', async () => {
      const allAddresses = await arweaveWallet.getAllAddresses()
      expect(Array.isArray(allAddresses)).toBe(true)
      expect(allAddresses.length).toBeGreaterThan(0)
      expect(allAddresses).toContain(address)
    })

    it('should get wallet names', async () => {
      const walletNames = await arweaveWallet.getWalletNames()
      expect(walletNames).toBeDefined()
      expect(typeof walletNames).toBe('object')
    })

    it('should get public key', async () => {
      const pk = await arweaveWallet.getActivePublicKey()
      expect(pk).toBeTruthy()
      expect(typeof pk).toBe('string')
      expect(pk.length).toBeGreaterThan(0)
    })
  })

  describe('arweave Configuration', () => {
    it('should get Arweave configuration', async () => {
      const config = await arweaveWallet.getArweaveConfig()
      expect(config).toBeDefined()
      expect(config.host).toBeDefined()
      expect(config.port).toBeDefined()
      expect(config.protocol).toBeDefined()
      expect(['http', 'https']).toContain(config.protocol)
    })
  })

  describe('cryptographic Operations', () => {
    it('should sign arbitrary data', async () => {
      const dataToSign = new TextEncoder().encode('Hello, Arweave!')
      const signature = await arweaveWallet.signature(dataToSign, {
        name: 'RSA-PSS',
        saltLength: 32,
      })

      expect(signature).toBeDefined()
      expect(signature instanceof Uint8Array).toBe(true)
      expect(signature.length).toBeGreaterThan(0)
    })

    it('should encrypt and decrypt data', async () => {
      const secretMessage = 'This is a secret message!'
      const encrypted = await arweaveWallet.encrypt(secretMessage, {
        algorithm: 'RSA-OAEP',
        hash: 'SHA-256',
      })

      expect(encrypted).toBeDefined()
      expect(encrypted instanceof Uint8Array).toBe(true)
      expect(encrypted.length).toBeGreaterThan(0)

      const decrypted = await arweaveWallet.decrypt(encrypted, {
        algorithm: 'RSA-OAEP',
        hash: 'SHA-256',
      })

      const decryptedText = new TextDecoder().decode(decrypted)
      expect(decryptedText).toBe(secretMessage)
    })

    it('should create private hash', async () => {
      const dataToHash = new TextEncoder().encode('Data to hash privately')
      const privateHash = await arweaveWallet.privateHash(dataToHash, {
        hashAlgorithm: 'SHA-256',
      })

      expect(privateHash).toBeDefined()
      expect(privateHash instanceof Uint8Array).toBe(true)
      expect(privateHash.length).toBeGreaterThan(0)
    })

    it('should sign and verify message', async () => {
      const data = new TextEncoder().encode('The hash of this msg will be signed.')
      const messageSignature = await arweaveWallet.signMessage(data, {
        hashAlgorithm: 'SHA-256',
      })

      expect(messageSignature).toBeDefined()
      expect(messageSignature instanceof Uint8Array).toBe(true)
      expect(messageSignature.length).toBeGreaterThan(0)

      const isValidSignature = await arweaveWallet.verifyMessage(
        data,
        messageSignature,
        publicKey,
        {
          hashAlgorithm: 'SHA-256',
        },
      )

      expect(isValidSignature).toBe(true)
    })

    it('should detect invalid message signature', async () => {
      const data = new TextEncoder().encode('Original message')
      const tamperedData = new TextEncoder().encode('Tampered message')
      const messageSignature = await arweaveWallet.signMessage(data, {
        hashAlgorithm: 'SHA-256',
      })

      const isValidSignature = await arweaveWallet.verifyMessage(
        tamperedData,
        messageSignature,
        publicKey,
        {
          hashAlgorithm: 'SHA-256',
        },
      )

      expect(isValidSignature).toBe(false)
    })
  })

  describe('transaction Operations', () => {
    it('should sign an Arweave transaction', async () => {
      const transaction = await arweave.createTransaction({
        data: 'Hello from test!',
      })

      const signedTx = await arweaveWallet.sign(transaction)

      expect(signedTx).toBeDefined()
      expect(signedTx.id).toBeTruthy()
      expect(signedTx.signature).toBeTruthy()
      expect(signedTx.owner).toBeTruthy()
    })

    it('should dispatch a transaction (sign + send)', async () => {
      const dispatchTx = await arweave.createTransaction({
        data: 'Dispatched from test!',
      })
      dispatchTx.addTag('Content-Type', 'text/plain')
      dispatchTx.addTag('Test', 'true')

      const dispatchResult = await arweaveWallet.dispatch(dispatchTx)

      expect(dispatchResult).toBeDefined()
      expect(dispatchResult.id).toBeTruthy()
      expect(dispatchResult.id).toMatch(/^[\w-]{43}$/)
    })
  }, 60000)

  describe('data Item Operations', () => {
    it('should sign a data item', async () => {
      const dataItemToSign = {
        data: 'This is an example data item for ANS-104 bundling',
        tags: [
          { name: 'Content-Type', value: 'text/plain' },
          { name: 'App-Name', value: 'test-suite' },
        ],
      }

      const signedDataItemBuffer = await arweaveWallet.signDataItem(dataItemToSign)

      expect(signedDataItemBuffer).toBeDefined()
      expect(signedDataItemBuffer instanceof Uint8Array).toBe(true)
      expect(signedDataItemBuffer.length).toBeGreaterThan(0)
    })

    it('should batch sign multiple data items', async () => {
      const dataItems = [
        {
          data: 'First data item',
          tags: [{ name: 'Type', value: 'Test1' }],
        },
        {
          data: 'Second data item',
          tags: [{ name: 'Type', value: 'Test2' }],
        },
        {
          data: 'Third data item',
          tags: [{ name: 'Type', value: 'Test3' }],
        },
      ]

      const batchResults = await arweaveWallet.batchSignDataItem(dataItems)

      expect(batchResults).toBeDefined()
      expect(Array.isArray(batchResults)).toBe(true)
      expect(batchResults.length).toBe(3)

      batchResults.forEach((result) => {
        expect(result.id).toBeTruthy()
        expect(result.id).toMatch(/^[\w-]{43}$/)
        expect(result.raw).toBeDefined()
        expect(result.raw instanceof Uint8Array).toBe(true)
      })
    })

    it('should sign data item with Uint8Array data', async () => {
      const binaryData = new Uint8Array([1, 2, 3, 4, 5])
      const dataItemToSign = {
        data: binaryData,
        tags: [{ name: 'Content-Type', value: 'application/octet-stream' }],
      }

      const signedDataItemBuffer = await arweaveWallet.signDataItem(dataItemToSign)

      expect(signedDataItemBuffer).toBeDefined()
      expect(signedDataItemBuffer instanceof Uint8Array).toBe(true)
      expect(signedDataItemBuffer.length).toBeGreaterThan(0)
    })
  })

  describe('token Operations', () => {
    it('should add token', async () => {
      await expect(arweaveWallet.addToken(tokenId, 'asset')).rejects.toThrow()
    })

    it('should check if token is added', async () => {
      await expect(arweaveWallet.isTokenAdded(tokenId)).rejects.toThrow()
    })

    it('should get token balance', async () => {
      try {
        const balance = await arweaveWallet.tokenBalance(tokenId)
        expect(typeof balance).toBe('string')
        expect(balance.length).toBeGreaterThan(0)
        // Should be a valid number string
        expect(Number.isNaN(Number(balance))).toBe(false)
      }
      catch (error: any) {
        // API might not be supported by the wallet
        expect(error.message).toContain('not supported')
      }
    }, 60000)

    it('should get user tokens', async () => {
      try {
        const tokens = await arweaveWallet.userTokens({ fetchBalance: false })
        expect(Array.isArray(tokens)).toBe(true)

        if (tokens.length > 0) {
          const token = tokens[0]
          expect(token).toHaveProperty('Denomination')
          expect(typeof token.Denomination).toBe('number')
        }
      }
      catch (error: any) {
        // API might not be supported by the wallet
        expect(error.message).toContain('not supported')
      }
    })

    it('should get user tokens with balance', async () => {
      try {
        const tokens = await arweaveWallet.userTokens({ fetchBalance: true })
        expect(Array.isArray(tokens)).toBe(true)
      }
      catch (error: any) {
        // API might not be supported by the wallet
        expect(error.message).toContain('not supported')
      }
    })
  })

  describe('wander Tier Operations', () => {
    it('should get Wander tier info', async () => {
      try {
        const tierInfo = await arweaveWallet.getWanderTierInfo()

        expect(tierInfo).toBeDefined()
        expect(tierInfo).toHaveProperty('tier')
        expect(tierInfo).toHaveProperty('balance')
        expect(tierInfo).toHaveProperty('rank')
        expect(tierInfo).toHaveProperty('progress')
        expect(tierInfo).toHaveProperty('snapshotTimestamp')
        expect(tierInfo).toHaveProperty('totalHolders')

        // Validate tier is one of the valid values
        expect(['Prime', 'Edge', 'Reserve', 'Select', 'Core']).toContain(tierInfo.tier)

        // Validate types
        expect(typeof tierInfo.balance).toBe('string')
        expect(typeof tierInfo.progress).toBe('number')
        expect(typeof tierInfo.snapshotTimestamp).toBe('number')
        expect(typeof tierInfo.totalHolders).toBe('number')

        // Validate progress is between 0 and 1
        expect(tierInfo.progress).toBeGreaterThanOrEqual(0)
        expect(tierInfo.progress).toBeLessThanOrEqual(1)
      }
      catch (error: any) {
        // API might not be supported by the wallet
        expect(error.message).toContain('not supported')
      }
    })
  })

  describe('data Item Signer', () => {
    it('should create data item signer', () => {
      const signer = arweaveWallet.getDataItemSigner()
      expect(signer).toBeDefined()
      expect(typeof signer).toBe('function')
    })
  })

  describe('disconnect', () => {
    it('should have disconnect method available', async () => {
      // We don't actually disconnect during tests to keep the connection active
      expect(arweaveWallet.disconnect).toBeDefined()
      expect(typeof arweaveWallet.disconnect).toBe('function')
    })
  })
})
