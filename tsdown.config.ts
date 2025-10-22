import { copyFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
  ],
  dts: true,
  onSuccess: async () => {
    // Copy HTML and JS files to dist folder
    mkdirSync('dist', { recursive: true })
    copyFileSync(join('src', 'signer.html'), join('dist', 'signer.html'))
    copyFileSync(join('src', 'signer.js'), join('dist', 'signer.js'))
    console.log('✓ Copied signer.html and signer.js to dist/')
  },
})
