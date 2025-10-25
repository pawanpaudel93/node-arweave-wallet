/**
 * Browser Wallet Signer - Client-side JavaScript
 *
 * This script handles communication between the Node.js server and the
 * Arweave browser wallet extension (Wander or any other compatible wallet).
 *
 */

// ==================== Constants & Configuration ====================
const States = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  SIGNING: 'signing',
  ERROR: 'error',
  COMPLETE: 'complete',
}

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

const OPERATION_ICONS = {
  connect: '🔗',
  sign: '✍️',
  dispatch: '🚀',
  signDataItem: '📝',
  encrypt: '🔒',
  decrypt: '🔓',
  signature: '✒️',
  signMessage: '💬',
  verifyMessage: '✓',
  batchSignDataItem: '📚',
  privateHash: '🔐',
  addToken: '🪙',
  address: '📍',
  getAllAddresses: '📋',
  getWalletNames: '👤',
  getPermissions: '🔑',
  getArweaveConfig: '⚙️',
  getActivePublicKey: '🔐',
  disconnect: '🔌',
  getWanderTierInfo: '🔍',
  tokenBalance: '🪙',
  userTokens: '👤',
}

const OPERATION_LABELS = {
  connect: 'Connecting wallet',
  sign: 'Signing transaction',
  dispatch: 'Dispatching transaction',
  signDataItem: 'Signing data item',
  encrypt: 'Encrypting data',
  decrypt: 'Decrypting data',
  signature: 'Creating signature',
  signMessage: 'Signing message',
  verifyMessage: 'Verifying message',
  batchSignDataItem: 'Batch signing items',
  privateHash: 'Creating private hash',
  addToken: 'Adding token',
  isTokenAdded: 'Checking token',
  address: 'Getting address',
  getAllAddresses: 'Getting addresses',
  getWalletNames: 'Getting wallet names',
  getPermissions: 'Getting permissions',
  getArweaveConfig: 'Getting config',
  getActivePublicKey: 'Getting public key',
  disconnect: 'Disconnecting',
  getWanderTierInfo: 'Getting Wander tier info',
  tokenBalance: 'Getting token balance',
  userTokens: 'Getting user tokens',
  getWanderTierInfo: 'Getting Wander tier info',
}

const MAX_LOG_ENTRIES = 50
const QUEUE_CLEANUP_DELAY = 2000
const ERROR_RESET_DELAY = 3000
const WALLET_INJECTION_DELAY = 500
const POLL_ERROR_DELAY = 1000
const AUTO_CLOSE_DELAY = 5000

// ==================== State Variables ====================
let currentState = States.DISCONNECTED
let walletAddress = null
let eventSource = null
const requestQueue = new Map()

const arweave = Arweave.init({
  host: 'arweave.net',
  port: 443,
  protocol: 'https',
})

// ==================== DOM Cache ====================
const dom = {
  status: null,
  walletInfo: null,
  address: null,
  queueContainer: null,
  queueList: null,
  log: null,
  themeIcon: null,
}

function cacheDOMElements() {
  dom.status = document.getElementById('status')
  dom.walletInfo = document.getElementById('walletInfo')
  dom.address = document.getElementById('address')
  dom.queueContainer = document.getElementById('queueContainer')
  dom.queueList = document.getElementById('queueList')
  dom.log = document.getElementById('log')
  dom.themeIcon = document.getElementById('themeIcon')
}

// ==================== State Management ====================
function setState(newState, message = '') {
  currentState = newState
  if (!dom.status) return

  const statusConfig = {
    [States.DISCONNECTED]: ['error', message || '⚠️ Not connected - Click "Connect Wallet" to continue'],
    [States.CONNECTING]: ['connecting', `<div class="spinner"></div>${message || 'Connecting to wallet...'}`],
    [States.CONNECTED]: ['connected', message || '✅ Wallet connected - Ready for signing'],
    [States.SIGNING]: ['signing', message || '✍️ Processing request...'],
    [States.ERROR]: ['error', `❌ ${message || 'An error occurred'}`],
    [States.COMPLETE]: ['connected', message || '✅ All done! You can safely close this window.'],
  }

  const [className, html] = statusConfig[newState] || ['', '']
  dom.status.className = `status ${className}`
  dom.status.innerHTML = html
}

// ==================== Theme Management ====================
function getSystemTheme() {
  if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
    return 'dark'
  }
  return 'light'
}

function initTheme() {
  // Check if user has a saved preference
  const savedTheme = localStorage.getItem('theme')
  
  if (savedTheme) {
    // User has manually selected a theme
    setTheme(savedTheme, false)
  }
  else {
    // Use system preference
    const systemTheme = getSystemTheme()
    setTheme(systemTheme, false)
    log(`Using system theme: ${systemTheme}`)
  }

  // Listen for system theme changes (only if user hasn't manually set a theme)
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
      // Only auto-switch if user hasn't manually set a preference
      if (!localStorage.getItem('theme-manual')) {
        const newTheme = e.matches ? 'dark' : 'light'
        setTheme(newTheme, false)
        log(`System theme changed to ${newTheme}`)
      }
    })
  }
}

function setTheme(theme, logChange = true) {
  document.documentElement.setAttribute('data-theme', theme)
  if (dom.themeIcon) {
    dom.themeIcon.textContent = theme === 'dark' ? '☀️' : '🌙'
  }
  localStorage.setItem('theme', theme)
  if (logChange) {
    log(`Switched to ${theme} mode`)
  }
}

function toggleTheme() {
  const currentTheme = document.documentElement.getAttribute('data-theme') || 'light'
  const newTheme = currentTheme === 'light' ? 'dark' : 'light'
  
  // Mark that user has manually selected a theme
  localStorage.setItem('theme-manual', 'true')
  setTheme(newTheme)
}

// ==================== Request Queue Management ====================
function addToQueue(id, type, status = 'pending') {
  requestQueue.set(id, { type, status, timestamp: Date.now() })
  updateQueueUI()
}

function updateQueueStatus(id, status) {
  const item = requestQueue.get(id)
  if (item) {
    item.status = status
    updateQueueUI()
  }
}

function removeFromQueue(id) {
  requestQueue.delete(id)
  updateQueueUI()
}

function updateQueueUI() {
  if (!dom.queueContainer || !dom.queueList) return

  if (requestQueue.size === 0) {
    dom.queueContainer.classList.remove('active')
    return
  }

  dom.queueContainer.classList.add('active')

  const statusOrder = { processing: 0, pending: 1, completed: 2 }
  const sortedQueue = Array.from(requestQueue.entries()).sort(
    (a, b) => (statusOrder[a[1].status] || 3) - (statusOrder[b[1].status] || 3)
  )

  dom.queueList.innerHTML = sortedQueue.map(([id, item]) => `
    <div class="queue-item">
      <span class="queue-icon">${OPERATION_ICONS[item.type] || '📦'}</span>
      <span class="queue-text">${OPERATION_LABELS[item.type] || item.type}</span>
      <span class="queue-status ${item.status}">${item.status}</span>
    </div>
  `).join('')
}

// ==================== Logging ====================
function log(message, type = 'info') {
  if (!dom.log) return

  const entry = document.createElement('div')
  entry.className = `log-entry ${type}`
  entry.textContent = `${new Date().toLocaleTimeString()} - ${message}`
  dom.log.appendChild(entry)
  dom.log.scrollTop = dom.log.scrollHeight

  // Keep log at reasonable size
  while (dom.log.children.length > MAX_LOG_ENTRIES) {
    dom.log.removeChild(dom.log.firstChild)
  }
}

// ==================== Utility Functions ====================
function base64ToUint8Array(base64) {
  const binaryString = atob(base64)
  const bytes = new Uint8Array(binaryString.length)
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

function uint8ArrayToBase64(uint8Array) {
  let binary = ''
  for (let i = 0; i < uint8Array.length; i++) {
    binary += String.fromCharCode(uint8Array[i])
  }
  return btoa(binary)
}

async function sendResponse(id, result, error = null) {
  await fetch('/response', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, result, error }),
  })
}

/**
 * Check if a wallet API method is supported
 * @param {string} methodName - The name of the wallet API method to check
 * @param {string} requestId - The request ID to send error response to
 * @returns {Promise<boolean>} - Returns true if supported, false otherwise (and sends error response)
 */
async function checkAPISupport(methodName, requestId) {
  if (!window.arweaveWallet || !window.arweaveWallet[methodName]) {
    const errorMsg = `${methodName} API not supported by this wallet`
    await sendResponse(requestId, null, errorMsg)
    log(errorMsg, 'error')
    return false
  }
  return true
}

// ==================== Request Handlers ====================
const requestHandlers = {
  async connect(params, requestId) {
    setState(States.SIGNING, '✍️ Please approve the connection in your wallet...')
    log('Programmatic connection request...')

    try {
      await window.arweaveWallet.connect(params.permissions, params.appInfo, params.gateway)
      walletAddress = await window.arweaveWallet.getActiveAddress()

      dom.walletInfo.style.display = 'block'
      dom.address.textContent = walletAddress

      await sendResponse(requestId, null)
      setState(States.CONNECTED, '✅ Wallet connected - Ready for signing')
      log(`Wallet connected programmatically: ${walletAddress}`, 'success')
    }
    catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      walletAddress = null // Clear wallet address on failure
      setState(States.DISCONNECTED, 'Connection cancelled or failed')
      log(`Connection failed: ${errorMsg}`, 'error')
      dom.walletInfo.style.display = 'none'
      throw err
    }
  },

  async getActiveAddress(params, requestId) {
    log('Providing wallet address...')
    const walletAddress = await window.arweaveWallet.getActiveAddress()
    await sendResponse(requestId, walletAddress)
    log('Address sent successfully', 'success')
  },

  async disconnect(params, requestId) {
    log('Disconnecting wallet...')
    await window.arweaveWallet.disconnect()
    await sendResponse(requestId, null)
    log('Wallet disconnected', 'success')
  },

  async getAllAddresses(params, requestId) {
    log('Getting all addresses...')
    const addresses = await window.arweaveWallet.getAllAddresses()
    await sendResponse(requestId, addresses)
    log('All addresses retrieved', 'success')
  },

  async getWalletNames(params, requestId) {
    log('Getting wallet names...')
    const names = await window.arweaveWallet.getWalletNames()
    await sendResponse(requestId, names)
    log('Wallet names retrieved', 'success')
  },

  async getPermissions(params, requestId) {
    log('Getting permissions...')
    const permissions = await window.arweaveWallet.getPermissions()
    await sendResponse(requestId, permissions)
    log('Permissions retrieved', 'success')
  },

  async getArweaveConfig(params, requestId) {
    log('Getting Arweave config...')
    const config = await window.arweaveWallet.getArweaveConfig()
    await sendResponse(requestId, config)
    log('Config retrieved', 'success')
  },

  async getActivePublicKey(params, requestId) {
    log('Getting public key...')
    const publicKey = await window.arweaveWallet.getActivePublicKey()
    await sendResponse(requestId, publicKey)
    log('Public key retrieved', 'success')
  },

  async signature(params, requestId) {
    setState(States.SIGNING, '✍️ Please sign the data in your wallet...')
    log('Signature request, please check your wallet...')

    const bytes = base64ToUint8Array(params.data)
    const signature = await window.arweaveWallet.signature(bytes, params.algorithm)
    const signatureBase64 = uint8ArrayToBase64(new Uint8Array(signature))

    await sendResponse(requestId, signatureBase64)
    setState(States.CONNECTED, '✅ Wallet connected - Ready for signing')
    log('Signature created successfully!', 'success')
  },

  async sign(params, requestId) {
    setState(States.SIGNING, '✍️ Please sign the transaction in your wallet...')
    log('Transaction signing request, please check your wallet...')

    params.transaction.data = arweave.utils.b64UrlToBuffer(params.transaction.data)
    const transaction = await arweave.createTransaction(params.transaction)
    const signedTx = await window.arweaveWallet.sign(transaction, params.options)

    await sendResponse(requestId, signedTx.toJSON())
    setState(States.CONNECTED, '✅ Wallet connected - Ready for signing')
    log('Transaction signed successfully!', 'success')
  },

  async dispatch(params, requestId) {
    setState(States.SIGNING, '✍️ Please approve the transaction in your wallet...')
    log('Transaction dispatch request, please check your wallet...')

    params.transaction.data = arweave.utils.b64UrlToBuffer(params.transaction.data)
    const transaction = await arweave.createTransaction(params.transaction)
    const result = await window.arweaveWallet.dispatch(transaction, params.options)

    await sendResponse(requestId, result)
    setState(States.CONNECTED, '✅ Wallet connected - Ready for signing')
    log('Transaction dispatched successfully!', 'success')
  },

  async encrypt(params, requestId) {
    setState(States.SIGNING, '🔒 Encrypting data...')
    log('Encryption request...')

    let dataToEncrypt = params.data
    try {
      dataToEncrypt = base64ToUint8Array(params.data)
    }
    catch (e) {
      // Keep as string if not base64
    }

    const encrypted = await window.arweaveWallet.encrypt(dataToEncrypt, params.options)
    const encryptedBase64 = uint8ArrayToBase64(new Uint8Array(encrypted))

    await sendResponse(requestId, encryptedBase64)
    setState(States.CONNECTED, '✅ Wallet connected - Ready for signing')
    log('Data encrypted successfully!', 'success')
  },

  async decrypt(params, requestId) {
    setState(States.SIGNING, '🔓 Decrypting data...')
    log('Decryption request...')

    const bytes = base64ToUint8Array(params.data)
    const decrypted = await window.arweaveWallet.decrypt(bytes, params.options)
    const decryptedBase64 = uint8ArrayToBase64(new Uint8Array(decrypted))

    await sendResponse(requestId, decryptedBase64)
    setState(States.CONNECTED, '✅ Wallet connected - Ready for signing')
    log('Data decrypted successfully!', 'success')
  },

  async signDataItem(params, requestId) {
    setState(States.SIGNING, '✍️ Please sign the data item in your wallet...')
    log('Data item signing request, please check your wallet...')

    let dataToSign = params.data
    if (typeof dataToSign === 'string') {
      try {
        dataToSign = base64ToUint8Array(dataToSign)
      }
      catch (e) {
        // Keep as string if not base64
      }
    }

    const signedDataItem = await window.arweaveWallet.signDataItem({
      data: dataToSign,
      tags: params.tags || [],
      target: params.target,
      anchor: params.anchor,
    }, params.options)

    const signedBase64 = uint8ArrayToBase64(new Uint8Array(signedDataItem))

    await sendResponse(requestId, { signedDataItem: signedBase64 })
    setState(States.CONNECTED, '✅ Wallet connected - Ready for signing')
    log('Data item signed successfully!', 'success')
  },

  async privateHash(params, requestId) {
    setState(States.SIGNING, '🔐 Creating private hash...')
    log('Private hash request...')

    const bytes = base64ToUint8Array(params.data)
    const hash = await window.arweaveWallet.privateHash(bytes, params.options)
    const hashBase64 = uint8ArrayToBase64(new Uint8Array(hash))

    await sendResponse(requestId, hashBase64)
    setState(States.CONNECTED, '✅ Wallet connected - Ready for signing')
    log('Private hash created successfully!', 'success')
  },

  async addToken(params, requestId) {
    log('Adding token to wallet...')
    await window.arweaveWallet.addToken(params.id, params.type, params.gateway)
    await sendResponse(requestId, null)
    log('Token added successfully!', 'success')
  },

  async isTokenAdded(params, requestId) {
    log('Checking if token is added...')
    const isAdded = await window.arweaveWallet.isTokenAdded(params.id)
    await sendResponse(requestId, isAdded)
    log(`Token ${isAdded ? 'is' : 'is not'} added`, 'success')
  },

  async signMessage(params, requestId) {
    setState(States.SIGNING, '✍️ Please sign the message in your wallet...')
    log('Message signing request, please check your wallet...')

    const bytes = base64ToUint8Array(params.data)
    const signature = await window.arweaveWallet.signMessage(bytes, params.options)
    const signatureBase64 = uint8ArrayToBase64(new Uint8Array(signature))

    await sendResponse(requestId, signatureBase64)
    setState(States.CONNECTED, '✅ Wallet connected - Ready for signing')
    log('Message signed successfully!', 'success')
  },

  async verifyMessage(params, requestId) {
    log('Verifying message signature...')

    const bytes = base64ToUint8Array(params.data)
    const sigBytes = base64ToUint8Array(params.signature)
    const isValid = await window.arweaveWallet.verifyMessage(
      bytes,
      sigBytes,
      params.publicKey,
      params.options,
    )

    await sendResponse(requestId, isValid)
    log(`Message verification: ${isValid ? 'valid' : 'invalid'}`, 'success')
  },

  async batchSignDataItem(params, requestId) {
    setState(States.SIGNING, '✍️ Please sign multiple data items in your wallet...')
    log(`Batch signing request for ${params.dataItems.length} items...`)

    const items = params.dataItems.map((item) => {
      let data = item.data
      if (typeof data === 'string') {
        try {
          data = base64ToUint8Array(data)
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
    const results = signedItems.map(signedItem => ({
      signedDataItem: uint8ArrayToBase64(new Uint8Array(signedItem)),
    }))

    await sendResponse(requestId, results)
    setState(States.CONNECTED, '✅ Wallet connected - Ready for signing')
    log(`Batch signed ${results.length} items successfully!`, 'success')
  },

  async tokenBalance(params, requestId) {
    log('Getting token balance...')
    const balance = await window.arweaveWallet.tokenBalance(params.id)
    await sendResponse(requestId, balance)
    log('Token balance retrieved', 'success')
  },

  async userTokens(params, requestId) {
    log('Getting user tokens...')
    const tokens = await window.arweaveWallet.userTokens(params.options)
    await sendResponse(requestId, tokens)
    log('User tokens retrieved', 'success')
  },

  async getWanderTierInfo(params, requestId) {
    log('Getting Wander tier info...')
    const tierInfo = await window.arweaveWallet.getWanderTierInfo()
    await sendResponse(requestId, tierInfo)
    log('Wander tier info retrieved', 'success')
  },
}

// ==================== Request Handling ====================
async function handleRequest(request) {
  try {
    addToQueue(request.id, request.type, 'processing')

    // Request data is already included in the SSE event
    const params = request.data?.params || {}

    const handler = requestHandlers[request.type]
    if (handler && (await checkAPISupport(request.type, request.id))) {
      await handler(params, request.id)
    }
    else {
      log(`Unknown request type: ${request.type}`, 'error')
      await sendResponse(request.id, null, `Unknown request type: ${request.type}`)
    }

    updateQueueStatus(request.id, 'completed')
    setTimeout(() => removeFromQueue(request.id), QUEUE_CLEANUP_DELAY)
  }
  catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    setState(States.ERROR, `Operation failed: ${errorMessage}`)
    log(`Error: ${errorMessage}`, 'error')
    await sendResponse(request.id, null, errorMessage)
    removeFromQueue(request.id)

    // Only reset to CONNECTED if we actually have a wallet connected
    setTimeout(() => {
      if (currentState === States.ERROR && walletAddress) {
        setState(States.CONNECTED, '✅ Wallet connected - Ready for signing')
      }
      else if (currentState === States.ERROR && !walletAddress) {
        setState(States.DISCONNECTED, '⚠️ Not connected - Click "Connect Wallet" to continue')
      }
    }, ERROR_RESET_DELAY)
  }
}

// ==================== Auto-Close ====================
function autoCloseWindow(status) {
  let countdown = Math.floor(AUTO_CLOSE_DELAY / 1000)
  
  const updateCountdown = () => {
    if (countdown > 0) {
      const message = status === 'success' 
        ? `✅ All done! Closing window in ${countdown} second${countdown !== 1 ? 's' : ''}...`
        : `Operation failed. Closing window in ${countdown} second${countdown !== 1 ? 's' : ''}...`
      
      if (status === 'success') {
        setState(States.COMPLETE, message)
      } else {
        setState(States.ERROR, message)
      }
      
      countdown--
      setTimeout(updateCountdown, 1000)
    } else {
      log('Closing window...', status === 'success' ? 'success' : 'error')
      window.close()
      
      // Fallback message if window.close() doesn't work (some browsers block it)
      setTimeout(() => {
        const fallbackMessage = status === 'success'
          ? '✅ All done! You can close this window manually.'
          : 'Operation failed. You can close this window manually.'
        
        if (status === 'success') {
          setState(States.COMPLETE, fallbackMessage)
        } else {
          setState(States.ERROR, fallbackMessage)
        }
      }, 500)
    }
  }
  
  updateCountdown()
}

// ==================== Server-Sent Events (SSE) ====================
function startEventStream() {
  if (eventSource) return
  
  log('🚀 Connecting via EventSource...')
  
  eventSource = new EventSource('/events')
  
  eventSource.onopen = () => {
    log('✅ EventSource connected - instant request delivery!', 'success')
  }
  
  eventSource.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data)
      
      // Handle different event types
      if (data.type === 'connected') {
        log('Connected to server via EventSource')
      }
      else if (data.type === 'completed') {
        if (data.status === 'success') {
          log('✅ All operations completed successfully!', 'success')
          setState(States.COMPLETE, '✅ All done! You can safely close this window.')
          autoCloseWindow('success')
        }
        else {
          log('❌ Operation failed or cancelled', 'error')
          setState(States.ERROR, '❌ Operation failed. Check your terminal for details.')
          autoCloseWindow('failed')
        }
        eventSource.close()
      }
      else if (data.id && data.type) {
        // New request received - handle it immediately!
        await handleRequest(data)
      }
    }
    catch (error) {
      console.error('EventSource message error:', error)
    }
  }
  
  eventSource.onerror = (error) => {
    console.error('EventSource error:', error)
    log('Connection interrupted, reconnecting...', 'error')
    
    // EventSource automatically reconnects, but we can handle errors here
    if (eventSource.readyState === EventSource.CLOSED) {
      log('EventSource closed, attempting to reconnect...', 'error')
      setTimeout(() => {
        eventSource = null
        startEventStream()
      }, POLL_ERROR_DELAY)
    }
  }
}

// ==================== Initialization ====================
window.addEventListener('load', () => {
  cacheDOMElements()
  initTheme()
  startEventStream()

  setTimeout(() => {
    if (window.arweaveWallet) {
      log('Wallet extension detected. Waiting for connection request...')
      setState(States.DISCONNECTED, '⏳ Waiting for connection request...')
    } else {
      setState(States.ERROR, 'No Arweave wallet extension detected<br><small>Please install Wander or any other compatible wallet and refresh this page</small>')
      log('Please install Wander or any other compatible wallet extension', 'error')
    }
  }, WALLET_INJECTION_DELAY)
})
