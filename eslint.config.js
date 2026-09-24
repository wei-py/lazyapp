import antfu from '@antfu/eslint-config'

export default antfu(
  {
    type: 'app',
    javascript: true,
    typescript: false,
    markdown: false,
    formatters: false,
    ignores: ['skills/**', '.agents/**', '.claude/**'],
  },
  {
    files: ['src/**/*.js', 'vendor/**/*.js'],
    rules: {
      // Managed paths and terminal text must explicitly reject or strip control bytes.
      'no-control-regex': 'off',
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      globals: {
        Bun: 'readonly',
      },
    },
  },
  {
    files: ['vendor/**/*.js'],
    rules: {
      'no-undef': 'off',
      'node/prefer-global/process': 'off',
    },
    languageOptions: {
      globals: {
        Bun: 'readonly',
        process: 'readonly',
      },
    },
  },
)
