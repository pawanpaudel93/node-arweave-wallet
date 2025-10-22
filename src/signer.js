/**
 * Browser Wallet Signer - Client-side JavaScript
 *
 * This script handles communication between the Node.js server and the
 * Arweave browser wallet extension (Wander).
 *
 * Features:
 * - Auto-detection and connection to browser wallet
 * - Long-polling for requests from Node.js
 * - Support for all Arweave wallet API methods
 * - Error handling and status updates
 */

let connected = false
let walletAddress = null
let polling = false

const arweave = Arweave.init({
  host: 'arweave.net',
  port: 443,
  protocol: 'https',
})

function log(message, type = 'info') {
  const logDiv = document.getElementById('log')
  const entry = document.createElement('div')
  entry.className = `log-entry ${type}`
  entry.textContent = `${new Date().toLocaleTimeString()} - ${message}`
  logDiv.appendChild(entry)
  logDiv.scrollTop = logDiv.scrollHeight
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
  'ACCESS_TOKENS',
]

async function connectWallet() {
  const statusDiv = document.getElementById('status')
  const connectBtn = document.getElementById('connectBtn')

  try {
    if (!window.arweaveWallet) {
      statusDiv.className = 'status error'
      statusDiv.innerHTML = '❌ No Arweave wallet found. Please install Wander.'
      log('No wallet extension found', 'error')
      return
    }

    log('Requesting wallet connection...')
    console.log('Wallet object available:', !!window.arweaveWallet)
    console.log('Requesting permissions:', DEFAULT_PERMISSIONS)

    // Request comprehensive permissions for all wallet operations
    await window.arweaveWallet.connect(DEFAULT_PERMISSIONS)

    walletAddress = await window.arweaveWallet.getActiveAddress()

    statusDiv.className = 'status connected'
    statusDiv.innerHTML = '✅ Wallet connected successfully!'

    document.getElementById('walletInfo').style.display = 'block'
    document.getElementById('address').textContent = walletAddress

    connectBtn.style.display = 'none'

    log(`Connected: ${walletAddress}`, 'success')

    connected = true

    // Polling is already running from page load
  }
  catch (error) {
    // Handle error with proper message extraction
    let errorMessage = 'Unknown error occurred'
    if (error && typeof error === 'object') {
      if (error.message) {
        errorMessage = error.message
      }
      else if (error.toString && error.toString() !== '[object Object]') {
        errorMessage = error.toString()
      }
      else {
        errorMessage = 'User rejected wallet connection or wallet not available'
      }
    }
    else if (error) {
      errorMessage = String(error)
    }

    statusDiv.className = 'status error'
    statusDiv.innerHTML = `❌ Failed to connect: ${errorMessage}`
    log(`Connection failed: ${errorMessage}`, 'error')

    // Show the connect button again so user can retry
    connectBtn.style.display = 'block'
  }
}

async function handleRequest(request) {
  const statusDiv = document.getElementById('status')

  try {
    // Get the full request data
    const dataResponse = await fetch('/get-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: request.id }),
    })
    const requestData = await dataResponse.json()
    const params = requestData.params || {}

    if (request.type === 'connect') {
      statusDiv.className = 'status signing'
      statusDiv.innerHTML = '✍️ Please approve the connection in your wallet...'
      log('Programmatic connection request...')

      try {
        console.log('Connecting with permissions:', params.permissions)
        console.log('App info:', params.appInfo)
        console.log('Gateway:', params.gateway)

        await window.arweaveWallet.connect(params.permissions, params.appInfo, params.gateway)

        // Update wallet address after connection
        walletAddress = await window.arweaveWallet.getActiveAddress()
        console.log('Wallet connected, address:', walletAddress)

        // Update UI if not already connected
        if (!connected) {
          document.getElementById('walletInfo').style.display = 'block'
          document.getElementById('address').textContent = walletAddress
          document.getElementById('connectBtn').style.display = 'none'
          connected = true
          console.log('Wallet connected, polling already active')
        }

        await sendResponse(request.id, null)

        statusDiv.className = 'status connected'
        statusDiv.innerHTML = '✅ Wallet connected - Ready for signing'
        log(`Wallet connected programmatically: ${walletAddress}`, 'success')
      }
      catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        console.error('Connect error:', err)
        log(`Connection failed: ${errorMsg}`, 'error')
        throw new Error(`Failed to connect: ${errorMsg}`)
      }
    }
    else if (request.type === 'address') {
      log('Providing wallet address...')
      await sendResponse(request.id, walletAddress)
      log('Address sent successfully', 'success')
    }
    else if (request.type === 'disconnect') {
      log('Disconnecting wallet...')
      await window.arweaveWallet.disconnect()
      await sendResponse(request.id, null)
      log('Wallet disconnected', 'success')
    }
    else if (request.type === 'getAllAddresses') {
      log('Getting all addresses...')
      const addresses = await window.arweaveWallet.getAllAddresses()
      await sendResponse(request.id, addresses)
      log('All addresses retrieved', 'success')
    }
    else if (request.type === 'getWalletNames') {
      log('Getting wallet names...')
      const names = await window.arweaveWallet.getWalletNames()
      await sendResponse(request.id, names)
      log('Wallet names retrieved', 'success')
    }
    else if (request.type === 'getPermissions') {
      log('Getting permissions...')
      const permissions = await window.arweaveWallet.getPermissions()
      await sendResponse(request.id, permissions)
      log('Permissions retrieved', 'success')
    }
    else if (request.type === 'getArweaveConfig') {
      log('Getting Arweave config...')
      const config = await window.arweaveWallet.getArweaveConfig()
      await sendResponse(request.id, config)
      log('Config retrieved', 'success')
    }
    else if (request.type === 'getPublicKey') {
      log('Getting public key...')
      const publicKey = await window.arweaveWallet.getActivePublicKey()
      await sendResponse(request.id, publicKey)
      log('Public key retrieved', 'success')
    }
    else if (request.type === 'signature') {
      statusDiv.className = 'status signing'
      statusDiv.innerHTML = '✍️ Please sign the data in your wallet...'
      log('Signature request, please check your wallet...')

      // Convert base64 data back to Uint8Array
      const binaryString = atob(params.data)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      const signature = await window.arweaveWallet.signature(bytes, params.algorithm)

      // Convert signature to base64
      const signatureArray = new Uint8Array(signature)
      let binary = ''
      for (let i = 0; i < signatureArray.length; i++) {
        binary += String.fromCharCode(signatureArray[i])
      }
      const signatureBase64 = btoa(binary)

      await sendResponse(request.id, signatureBase64)
      statusDiv.className = 'status connected'
      statusDiv.innerHTML = '✅ Wallet connected - Ready for signing'
      log('Signature created successfully!', 'success')
    }
    else if (request.type === 'sign') {
      statusDiv.className = 'status signing'
      statusDiv.innerHTML = '✍️ Please sign the transaction in your wallet...'
      log('Transaction signing request, please check your wallet...')

      try {
        params.transaction.data = arweave.utils.b64UrlToBuffer(params.transaction.data)

        // Reconstruct the transaction object from JSON
        const transaction = await arweave.createTransaction(params.transaction)

        const signedTx = await window.arweaveWallet.sign(transaction, params.options)
        console.log('Signed transaction:', signedTx)

        await sendResponse(request.id, signedTx.toJSON())

        statusDiv.className = 'status connected'
        statusDiv.innerHTML = '✅ Wallet connected - Ready for signing'
        log('Transaction signed successfully!', 'success')
      }
      catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        log(`Failed to sign transaction: ${errorMsg}`, 'error')
        throw new Error(`Failed to sign transaction: ${errorMsg}`)
      }
    }
    else if (request.type === 'dispatch') {
      statusDiv.className = 'status signing'
      statusDiv.innerHTML = '✍️ Please approve the transaction in your wallet...'
      log('Transaction dispatch request, please check your wallet...')

      try {
        params.transaction.data = arweave.utils.b64UrlToBuffer(params.transaction.data)
        console.log('Transaction:', params.transaction)
        const transaction = await arweave.createTransaction(params.transaction)
        const result = await window.arweaveWallet.dispatch(transaction, params.options)
        await sendResponse(request.id, result)

        statusDiv.className = 'status connected'
        statusDiv.innerHTML = '✅ Wallet connected - Ready for signing'
        log('Transaction dispatched successfully!', 'success')
      }
      catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        log(`Failed to dispatch transaction: ${errorMsg}`, 'error')
        throw new Error(`Failed to dispatch transaction: ${errorMsg}`)
      }
    }
    else if (request.type === 'encrypt') {
      statusDiv.className = 'status signing'
      statusDiv.innerHTML = '🔒 Encrypting data...'
      log('Encryption request...')

      let dataToEncrypt = params.data
      // Check if data is base64 encoded (binary)
      try {
        const binaryString = atob(params.data)
        const bytes = new Uint8Array(binaryString.length)
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i)
        }
        dataToEncrypt = bytes
      }
      catch (e) {
        // Keep as string if not base64
      }

      const encrypted = await window.arweaveWallet.encrypt(dataToEncrypt, params.options)

      // Convert to base64
      const encryptedArray = new Uint8Array(encrypted)
      let binary = ''
      for (let i = 0; i < encryptedArray.length; i++) {
        binary += String.fromCharCode(encryptedArray[i])
      }
      const encryptedBase64 = btoa(binary)

      await sendResponse(request.id, encryptedBase64)
      statusDiv.className = 'status connected'
      statusDiv.innerHTML = '✅ Wallet connected - Ready for signing'
      log('Data encrypted successfully!', 'success')
    }
    else if (request.type === 'decrypt') {
      statusDiv.className = 'status signing'
      statusDiv.innerHTML = '🔓 Decrypting data...'
      log('Decryption request...')

      // Convert base64 to Uint8Array
      const binaryString = atob(params.data)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      const decrypted = await window.arweaveWallet.decrypt(bytes, params.options)

      // Convert to base64
      const decryptedArray = new Uint8Array(decrypted)
      let binary = ''
      for (let i = 0; i < decryptedArray.length; i++) {
        binary += String.fromCharCode(decryptedArray[i])
      }
      const decryptedBase64 = btoa(binary)

      await sendResponse(request.id, decryptedBase64)
      statusDiv.className = 'status connected'
      statusDiv.innerHTML = '✅ Wallet connected - Ready for signing'
      log('Data decrypted successfully!', 'success')
    }
    else if (request.type === 'signDataItem') {
      statusDiv.className = 'status signing'
      statusDiv.innerHTML = '✍️ Please sign the data item in your wallet...'
      log('Data item signing request, please check your wallet...')

      // Convert base64 data to Uint8Array if needed
      let dataToSign = params.data
      if (typeof dataToSign === 'string') {
        try {
          const binaryString = atob(dataToSign)
          const bytes = new Uint8Array(binaryString.length)
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i)
          }
          dataToSign = bytes
        }
        catch (e) {
          // If it's not base64, keep as string
        }
      }

      // Sign data item with wallet (with optional signature options)
      const signedDataItem = await window.arweaveWallet.signDataItem({
        data: dataToSign,
        tags: params.tags || [],
        target: params.target,
        anchor: params.anchor,
      }, params.options)

      // Convert ArrayBuffer to base64 for transfer
      const signedArray = new Uint8Array(signedDataItem)
      let binary = ''
      for (let i = 0; i < signedArray.length; i++) {
        binary += String.fromCharCode(signedArray[i])
      }
      const signedBase64 = btoa(binary)

      await sendResponse(request.id, {
        signedDataItem: signedBase64,
      })

      statusDiv.className = 'status connected'
      statusDiv.innerHTML = '✅ Wallet connected - Ready for signing'
      log('Data item signed successfully!', 'success')
    }
    else if (request.type === 'privateHash') {
      statusDiv.className = 'status signing'
      statusDiv.innerHTML = '🔐 Creating private hash...'
      log('Private hash request...')

      // Convert base64 data back to Uint8Array
      const binaryString = atob(params.data)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      console.log({ bytes, options: params.options })

      const hash = await window.arweaveWallet.privateHash(bytes, params.options)

      // Convert hash to base64
      const hashArray = new Uint8Array(hash)
      let binary = ''
      for (let i = 0; i < hashArray.length; i++) {
        binary += String.fromCharCode(hashArray[i])
      }
      const hashBase64 = btoa(binary)

      await sendResponse(request.id, hashBase64)
      statusDiv.className = 'status connected'
      statusDiv.innerHTML = '✅ Wallet connected - Ready for signing'
      log('Private hash created successfully!', 'success')
    }
    else if (request.type === 'addToken') {
      log('Adding token to wallet...')
      await window.arweaveWallet.addToken(params.id, params.type, params.gateway)
      await sendResponse(request.id, null)
      log('Token added successfully!', 'success')
    }
    else if (request.type === 'isTokenAdded') {
      log('Checking if token is added...')
      const isAdded = await window.arweaveWallet.isTokenAdded(params.id)
      await sendResponse(request.id, isAdded)
      log(`Token ${isAdded ? 'is' : 'is not'} added`, 'success')
    }
    else if (request.type === 'signMessage') {
      statusDiv.className = 'status signing'
      statusDiv.innerHTML = '✍️ Please sign the message in your wallet...'
      log('Message signing request, please check your wallet...')

      // Convert message data
      const binaryString = atob(params.data)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      const signature = await window.arweaveWallet.signMessage(bytes, params.options)

      // Convert signature to base64
      const signatureArray = new Uint8Array(signature)
      let binary = ''
      for (let i = 0; i < signatureArray.length; i++) {
        binary += String.fromCharCode(signatureArray[i])
      }
      const signatureBase64 = btoa(binary)

      await sendResponse(request.id, signatureBase64)
      statusDiv.className = 'status connected'
      statusDiv.innerHTML = '✅ Wallet connected - Ready for signing'
      log('Message signed successfully!', 'success')
    }
    else if (request.type === 'verifyMessage') {
      log('Verifying message signature...')

      // Convert message data
      const binaryString = atob(params.data)
      const bytes = new Uint8Array(binaryString.length)
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i)
      }

      // Convert signature from base64
      const sigBinaryString = atob(params.signature)
      const sigBytes = new Uint8Array(sigBinaryString.length)
      for (let i = 0; i < sigBinaryString.length; i++) {
        sigBytes[i] = sigBinaryString.charCodeAt(i)
      }

      const isValid = await window.arweaveWallet.verifyMessage(
        bytes,
        sigBytes,
        params.publicKey,
        params.options,
      )

      await sendResponse(request.id, isValid)
      log(`Message verification: ${isValid ? 'valid' : 'invalid'}`, 'success')
    }
    else if (request.type === 'batchSignDataItem') {
      statusDiv.className = 'status signing'
      statusDiv.innerHTML = '✍️ Please sign multiple data items in your wallet...'
      log(`Batch signing request for ${params.dataItems.length} items...`)

      // Convert data items
      const items = params.dataItems.map((item) => {
        let data = item.data
        if (typeof data === 'string') {
          try {
            const binaryString = atob(data)
            const bytes = new Uint8Array(binaryString.length)
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i)
            }
            data = bytes
          }
          catch (e) {
            // Keep as string if not base64
          }
        }
        return {
          data,
          tags: item.tags || [],
          target: item.target,
          anchor: item.anchor,
        }
      })

      const signedItems = await window.arweaveWallet.batchSignDataItem(items, params.options)

      // Convert signed items to base64
      const results = signedItems.map((signedItem) => {
        const signedArray = new Uint8Array(signedItem)
        let binary = ''
        for (let i = 0; i < signedArray.length; i++) {
          binary += String.fromCharCode(signedArray[i])
        }
        return {
          signedDataItem: btoa(binary),
        }
      })

      await sendResponse(request.id, results)
      statusDiv.className = 'status connected'
      statusDiv.innerHTML = '✅ Wallet connected - Ready for signing'
      log(`Batch signed ${results.length} items successfully!`, 'success')
    }
    else {
      log(`Unknown request type: ${request.type}`, 'error')
      await sendResponse(request.id, null, `Unknown request type: ${request.type}`)
    }
  }
  catch (error) {
    statusDiv.className = 'status error'
    statusDiv.innerHTML = `❌ Operation failed: ${error.message}`
    log(`Error: ${error.message}`, 'error')
    await sendResponse(request.id, null, error.message)

    // Reset status after error
    setTimeout(() => {
      if (connected) {
        statusDiv.className = 'status connected'
        statusDiv.innerHTML = '✅ Wallet connected - Ready for signing'
      }
    }, 3000)
  }
}

async function sendResponse(id, result, error = null) {
  await fetch('/response', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, result, error }),
  })
}

// Auto-connect if wallet is available
window.addEventListener('load', () => {
  // Start polling immediately so we can receive programmatic connect requests
  // Set a minimal connected state to enable polling
  startPollingForRequests()

  // Wait a bit for wallet extensions to inject
  setTimeout(() => {
    if (window.arweaveWallet) {
      // Check if already connected
      window.arweaveWallet.getActiveAddress()
        .then((address) => {
          if (address) {
            log('Wallet already connected, attempting auto-connect...')
            connectWallet()
          }
          else {
            log('Ready to connect wallet (click button or wait for programmatic connect)')
          }
        })
        .catch(() => {
          // Not connected yet
          log('Ready to connect wallet (click button or wait for programmatic connect)')
        })
    }
    else {
      document.getElementById('status').className = 'status error'
      document.getElementById('status').innerHTML = '❌ No Arweave wallet extension detected<br><small>Please install Wander and refresh this page</small>'
      log('Please install Wander extension', 'error')
      console.error('window.arweaveWallet is not available. Please install a compatible wallet extension.')
    }
  }, 500) // Give wallet extension time to inject
})

// Start polling for requests (independent of wallet connection state)
async function startPollingForRequests() {
  if (polling)
    return
  polling = true
  log('Started listening for requests from CLI...')

  while (true) {
    try {
      const response = await fetch('/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const request = await response.json()

      // Check if the process is complete
      if (request.completed) {
        if (request.status === 'success') {
          log('✅ Process successful!', 'success')
          document.getElementById('status').className = 'status connected'
          document.getElementById('status').innerHTML = '✅ Process complete! You can close this window.'
        }
        else {
          log('❌ Process failed!', 'error')
          document.getElementById('status').className = 'status error'
          document.getElementById('status').innerHTML = '❌ Process failed. Check your CLI for details.'
        }
        break // Stop polling
      }

      if (request.id && request.type) {
        await handleRequest(request)
      }

      // Small delay before next poll
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    catch (error) {
      console.error('Polling error:', error)
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}
