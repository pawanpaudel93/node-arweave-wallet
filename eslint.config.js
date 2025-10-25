// @ts-check
import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'lib',
    pnpm: true,
    ignores: ['src/signer.html'],
  },
  {
    rules: {
      'no-console': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      'style/brace-style': ['error', '1tbs', { allowSingleLine: true }],
    },
  },
)
