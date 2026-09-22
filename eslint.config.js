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
    files: ['src/**/*.js'],
    rules: {
      // Managed paths and terminal text must explicitly reject or strip control bytes.
      'no-control-regex': 'off',
    },
  },
)
