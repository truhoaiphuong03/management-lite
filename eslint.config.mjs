import tseslint from 'typescript-eslint';
export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'apps/*/dist/**',
      'packages/*/dist/**',
      'node_modules/**',
      'docs/canonical/**',
    ],
  },
  ...tseslint.configs.recommended,
);
