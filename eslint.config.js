// @ts-check
import antfu from '@antfu/eslint-config'
import prettier from 'eslint-plugin-prettier/recommended'

export default antfu(
  {
    type: 'lib',
    pnpm: true,
    stylistic: false, // Disable @antfu's stylistic rules to avoid conflicts with Prettier
  },
  prettier,
  {
    rules: {
      'no-console': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'prettier/prettier': 'error',
    },
  },
)
