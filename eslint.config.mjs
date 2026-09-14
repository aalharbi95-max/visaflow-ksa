// Introduce lint incrementally for the new Sales module; existing monolithic views retain their baseline.
export default [{
  files: ['src/SalesCommandCenterLazyPage.jsx', 'src/salesAgent*.mjs', 'supabase/functions/_shared/salesAgent*.mjs'],
  languageOptions: {
    ecmaVersion: 'latest', sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } },
    globals: { fetch: 'readonly', Request: 'readonly', Response: 'readonly', TextEncoder: 'readonly', AbortSignal: 'readonly', URL: 'readonly' },
  },
  rules: { 'no-undef': 'error', 'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^[A-Z]' }], 'no-unreachable': 'error', 'no-dupe-keys': 'error', 'no-constant-condition': 'error', 'valid-typeof': 'error', 'constructor-super': 'error' },
}];
