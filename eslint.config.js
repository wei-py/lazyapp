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
  {
    rules: {
      // Bun 1.4.2 classifies the `bun`/`bun:*` builtins differently per platform
      // build (darwin: external, linux: builtin), making sort verdicts diverge.
      // Pin groups by source pattern so import order is platform-independent.
      'perfectionist/sort-imports': ['error', {
        customGroups: [
          { groupName: 'node-builtins', elementNamePattern: '^node:' },
          { groupName: 'bun-builtins', elementNamePattern: '^bun($|:)' },
        ],
        groups: [
          'type-import',
          ['type-parent', 'type-sibling', 'type-index', 'type-internal'],
          'node-builtins',
          'bun-builtins',
          'value-builtin',
          'value-external',
          'value-internal',
          ['value-parent', 'value-sibling', 'value-index'],
          'side-effect',
          'ts-equals-import',
          'unknown',
        ],
        newlinesBetween: 'ignore',
        newlinesInside: 'ignore',
        order: 'asc',
        type: 'natural',
      }],
    },
  },
)
