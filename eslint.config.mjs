import tseslint from 'typescript-eslint';
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'apps/*/dist/**',
      'packages/*/dist/**',
      'node_modules/**',
      'docs/canonical/**',
      '.codex-worktrees/**',
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  ...tseslint.configs.recommended,
);
