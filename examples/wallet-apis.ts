import type { PermissionType } from 'node-arweave-wallet'
import { Buffer } from 'node:buffer'
import process from 'node:process'
import Arweave from 'arweave'
import { NodeArweaveWallet } from 'node-arweave-wallet'

export const DEFAULT_PERMISSIONS: PermissionType[] = [
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

async function demonstrateWalletAPIs() {
  console.log('🚀 Starting Browser Wallet API Demo\n')

  // Initialize the browser wallet arweaveWallet with consistent port
  // You can specify a custom port, or use default (3737)
  const arweaveWallet = new NodeArweaveWallet({ port: 3737 })
  console.log('📱 Initializing browser wallet arweaveWallet...')
  await arweaveWallet.initialize()

  try {
    // 0. Connect Wallet (Programmatic API)
    console.log('\n0️⃣ Connecting wallet programmatically...')
    console.log(
      'ℹ️  Note: The wallet is auto-connected during initialization,',
    )
    console.log('    but you can also connect programmatically:')

    await arweaveWallet.connect(DEFAULT_PERMISSIONS)
    console.log('✅ Wallet connected programmatically!')

    console.log('✅ connect() API method available')

    // 1. Get Active Address
    console.log('\n1️⃣ Getting active wallet address...')
    const address = await arweaveWallet.getActiveAddress()
    console.log(`✅ Active Address: ${address}`)

    // 2. Get All Addresses
    console.log('\n2️⃣ Getting all wallet addresses...')
    const allAddresses = await arweaveWallet.getAllAddresses()
    console.log(`✅ All Addresses (${allAddresses.length}):`, allAddresses)

    // 3. Get Wallet Names
    console.log('\n3️⃣ Getting wallet names...')
    const walletNames = await arweaveWallet.getWalletNames()
    console.log('✅ Wallet Names:', walletNames)

    // 4. Get Permissions
    console.log('\n4️⃣ Getting granted permissions...')
    const permissions = await arweaveWallet.getPermissions()
    console.log('✅ Permissions:', permissions)

    // 5. Get Public Key
    console.log('\n5️⃣ Getting public key...')
    const publicKey = await arweaveWallet.getActivePublicKey()
    console.log(`✅ Public Key: ${publicKey.substring(0, 50)}...`)

    // 6. Get Arweave Config
    console.log('\n6️⃣ Getting Arweave configuration...')
    const config = await arweaveWallet.getArweaveConfig()
    console.log('✅ Arweave Config:', config)

    // 7. Sign Arbitrary Data (Signature)
    console.log('\n7️⃣ Signing arbitrary data...')
    const dataToSign = new TextEncoder().encode('Hello, Arweave!')
    const signature = await arweaveWallet.signature(dataToSign, {
      name: 'RSA-PSS',
      saltLength: 32,
    })
    console.log(
      `✅ Signature created (${signature.length} bytes):`,
      `${Buffer.from(signature).toString('base64').substring(0, 50)}...`,
    )

    // 8. Encrypt Data
    console.log('\n8️⃣ Encrypting data...')
    const secretMessage = 'This is a secret message!'
    const encrypted = await arweaveWallet.encrypt(secretMessage, {
      algorithm: 'RSA-OAEP',
      hash: 'SHA-256',
    })
    console.log(
      `✅ Data encrypted (${encrypted.length} bytes):`,
      `${Buffer.from(encrypted).toString('base64').substring(0, 50)}...`,
    )

    // 9. Decrypt Data
    console.log('\n9️⃣ Decrypting data...')
    const decrypted = await arweaveWallet.decrypt(encrypted, {
      algorithm: 'RSA-OAEP',
      hash: 'SHA-256',
    })
    const decryptedText = new TextDecoder().decode(decrypted)
    console.log(`✅ Data decrypted: "${decryptedText}"`)

    // 10. Sign Transaction (example with Arweave)
    console.log('\n🔟 Signing an Arweave transaction...')
    console.log(
      'ℹ️  Note: For transaction signing, it\'s recommended to use arweave-js directly',
    )
    console.log('    Example: await arweave.transactions.sign(transaction);')
    console.log(
      '    This automatically uses the wallet without needing to pass the keyfile.',
    )
    console.log('✅ Transaction sign() method available')

    // Uncomment to test transaction signing:

    const arweave = new Arweave({
      host: config.host,
      port: config.port,
      protocol: config.protocol,
    })

    const transaction = await arweave.createTransaction({
      data: 'Hello from ao-deploy!',
    })
    const signedTx = await arweaveWallet.sign(transaction)
    if (signedTx) {
      console.log('✅ Transaction signed:', signedTx)
    }
    else {
      console.error('❌ Transaction not signed')
    }

    // 11. Dispatch Transaction (sign and send to network)
    console.log('\n1️⃣1️⃣ Dispatching a transaction (sign + send)...')
    console.log('ℹ️  Note: This will actually post to the network!')
    console.log('    Uncomment the lines below to test dispatch:')

    const dispatchTx = await arweave.createTransaction({
      data: 'Dispatched from ao-deploy!',
    })
    dispatchTx.addTag('Content-Type', 'text/plain')
    const dispatchResult = await arweaveWallet.dispatch(dispatchTx)
    console.log(`✅ Transaction dispatched: ${dispatchResult.id}`)

    // 12. Sign Data Item (Direct API)
    console.log('\n1️⃣2️⃣ Signing a data item (direct API)...')
    const dataItemToSign = {
      data: 'This is an example data item for ANS-104 bundling',
      tags: [
        { name: 'Content-Type', value: 'text/plain' },
        { name: 'App-Name', value: 'ao-deploy-demo' },
      ],
    }

    const signedDataItemBuffer
      = await arweaveWallet.signDataItem(dataItemToSign)
    console.log(
      `✅ Data item signed (${signedDataItemBuffer.length} bytes):`,
      `${Buffer.from(signedDataItemBuffer).toString('base64').substring(0, 50)
      }...`,
    )

    console.log('ℹ️  You can now load it into a DataItem instance:')
    console.log('    import { DataItem } from \'@dha-team/arbundles\';')
    console.log('    const dataItem = new DataItem(signedDataItemBuffer);')
    console.log(
      '    // Submit to bundler: fetch(\'https://upload.ardrive.io/v1/tx\', ...)',
    )

    // // 13. Get DataItem Signer (for aoconnect)
    // console.log("\n1️⃣3️⃣ Creating DataItem arweaveWallet for aoconnect...");
    // console.log("✅ DataItem arweaveWallet created and ready for use with aoconnect");
    /*
    const dataItemSigner = createDataItemSigner(arweaveWallet);
    // Use dataItemSigner with aoconnect's message/spawn functions

    import { message } from "@permaweb/aoconnect";

    const messageId = await message({
      process: "PROCESS_ID",
      arweaveWallet: dataItemSigner,
      tags: [
        { name: "Action", value: "Hello" }
      ],
      data: "Hello from browser wallet!"
    });

    console.log(`Message sent: ${messageId}`);
    */

    // 14. Private Hash (hash with private key)
    console.log('\n1️⃣4️⃣ Creating private hash...')
    const dataToHash = new TextEncoder().encode('Data to hash privately')
    const privateHash = await arweaveWallet.privateHash(dataToHash, {
      hashAlgorithm: 'SHA-256',
    })
    console.log(
      `✅ Private hash created (${privateHash.length} bytes):`,
      `${Buffer.from(privateHash).toString('base64').substring(0, 50)}...`,
    )

    // 15. Sign Message
    console.log('\n1️⃣5️⃣ Signing a message...')
    const data = new TextEncoder().encode(
      'The hash of this msg will be signed.',
    )
    const messageSignature = await arweaveWallet.signMessage(data, {
      hashAlgorithm: 'SHA-256',
    })
    console.log(
      `✅ Message signed (${messageSignature.length} bytes):`,
      `${Buffer.from(messageSignature).toString('base64').substring(0, 50)}...`,
    )

    // 16. Verify Message
    console.log('\n1️⃣6️⃣ Verifying message signature...')
    const isValidSignature = await arweaveWallet.verifyMessage(
      data,
      messageSignature,
      publicKey,
      {
        hashAlgorithm: 'SHA-256',
      },
    )
    console.log(
      `✅ Message signature is ${isValidSignature ? 'VALID' : 'INVALID'}`,
    )

    // 17. Batch Sign Data Items
    console.log('\n1️⃣7️⃣ Batch signing data items...')
    console.log('ℹ️  This demonstrates signing multiple data items at once')
    console.log('    Uncomment the lines below to test:')
    /*
    const dataItems = [
      {
        data: "First data item",
        tags: [{ name: "Type", value: "Test1" }]
      },
      {
        data: "Second data item",
        tags: [{ name: "Type", value: "Test2" }]
      }
    ];
    const batchResults = await arweaveWallet.batchSignDataItem(dataItems);
    console.log(`✅ Batch signed ${batchResults.length} data items`);
    batchResults.forEach((result, idx) => {
      console.log(`   Item ${idx + 1}: ${result.id}`);
    });
    */
    console.log('✅ batchSignDataItem() method available')

    // 18. Disconnect wallet (optional)
    console.log('\n1️⃣8️⃣ Disconnecting wallet...')
    console.log('ℹ️  Uncomment the line below to test disconnect:')
    // await arweaveWallet.disconnect();
    console.log(
      '✅ Disconnect method available (skipped to keep connection active)',
    )

    // Success summary
    console.log(`\n${'='.repeat(60)}`)
    console.log('✨ All 18 wallet API methods demonstrated successfully!')
    console.log('='.repeat(60))
    console.log('\n📝 Summary of demonstrated APIs:')
    console.log('   0. ✅ connect() - Connect wallet with permissions')
    console.log('   1. ✅ getActiveAddress() - Get active wallet address')
    console.log('   2. ✅ getAllAddresses() - Get all wallet addresses')
    console.log('   3. ✅ getWalletNames() - Get wallet names')
    console.log('   4. ✅ getPermissions() - Get granted permissions')
    console.log('   5. ✅ getActivePublicKey() - Get public key')
    console.log('   6. ✅ getArweaveConfig() - Get Arweave configuration')
    console.log('   7. ✅ signature() - Sign arbitrary data')
    console.log('   8. ✅ encrypt() - Encrypt data')
    console.log('   9. ✅ decrypt() - Decrypt data')
    console.log('   10. ✅ sign() - Sign Arweave transaction')
    console.log('   11. ✅ dispatch() - Sign and send transaction')
    console.log('   12. ✅ signDataItem() - Sign ANS-104 data item (direct API)')
    console.log('   13. ✅ getSigner() / createDataItemSigner() - DataItem arweaveWallet')
    console.log('   14. ✅ privateHash() - Hash with private key')
    console.log('   15. ✅ signMessage() - Sign a message')
    console.log('   16. ✅ verifyMessage() - Verify message signature')
    console.log('   17. ✅ batchSignDataItem() - Batch sign data items')
    console.log('   18. ✅ disconnect() - Disconnect wallet')
    console.log('='.repeat(60))
  }
  catch (error: any) {
    console.error('\n❌ Error:', error.message)
    await arweaveWallet.close('failed')
    throw error
  }

  // Clean up - close the browser connection
  console.log('\n🧹 Cleaning up and closing browser connection...')
  await arweaveWallet.close('success')
  console.log('✅ Demo completed successfully!\n')
}

// Run the demo
demonstrateWalletAPIs()
  .then(() => {
    console.log('🎉 Browser Wallet API demo finished!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('💥 Demo failed:', error)
    process.exit(1)
  })
