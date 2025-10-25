import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
// @ts-expect-error - no types available
import { minify as minifyHTML } from 'html-minifier-terser'
import { minify as minifyJS } from 'terser'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: [
    'src/index.ts',
  ],
  dts: true,
  minify: true,
  onSuccess: async () => {
    // Create dist directory
    mkdirSync('dist', { recursive: true })

    // Minify and copy signer.js
    const jsContent = readFileSync(join('src', 'signer.js'), 'utf-8')
    const minifiedJS = await minifyJS(jsContent, {
      compress: {
        dead_code: true,
        drop_console: false,
        drop_debugger: true,
        keep_classnames: false,
        keep_fargs: true,
        keep_fnames: false,
        keep_infinity: false,
      },
      mangle: {
        toplevel: false,
      },
      format: {
        comments: false,
      },
    })

    if (minifiedJS.code) {
      writeFileSync(join('dist', 'signer.js'), minifiedJS.code, 'utf-8')
      console.log(`✓ Minified signer.js: ${jsContent.length} → ${minifiedJS.code.length} bytes (${((1 - minifiedJS.code.length / jsContent.length) * 100).toFixed(1)}% reduction)`)
    }

    // Minify and copy signer.html
    const htmlContent = readFileSync(join('src', 'signer.html'), 'utf-8')
    const minifiedHTML = await minifyHTML(htmlContent, {
      collapseWhitespace: true,
      removeComments: true,
      removeRedundantAttributes: true,
      removeScriptTypeAttributes: true,
      removeStyleLinkTypeAttributes: true,
      useShortDoctype: true,
      minifyCSS: true,
      minifyJS: true,
    })

    writeFileSync(join('dist', 'signer.html'), minifiedHTML, 'utf-8')
    console.log(`✓ Minified signer.html: ${htmlContent.length} → ${minifiedHTML.length} bytes (${((1 - minifiedHTML.length / htmlContent.length) * 100).toFixed(1)}% reduction)`)
  },
})
