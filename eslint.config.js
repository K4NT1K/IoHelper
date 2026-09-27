import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
    js.configs.recommended,
    eslintConfigPrettier,
    {
        files: ['**/*.js', 'build.mjs'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                ...globals.browser,
                ...globals.webextensions,
                chrome: 'readonly'
            }
        },
        rules: {
            'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
            'no-undef': 'error',
            'no-async-promise-executor': 'off',
            'no-useless-escape': 'off',
            'no-useless-assignment': 'off',
            'preserve-caught-error': 'off'
        }
    },
    {
        ignores: ['dist/**', 'IoHelperV2/**', 'node_modules/**', 'siteDemonstration/**', 'scripts/**']
    }
];
