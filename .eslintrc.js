module.exports = {
    root: true,
    extends: [
        'eslint:recommended',
    ],
    env: {
        es6: true,
    },
    parserOptions: {
        ecmaVersion: 'latest',
    },
    overrides: [
        {
            files: ['src/**/*.js'],
            env: {
                browser: true,
                jquery: true,
            },
            globals: {
                SillyTavern: 'readonly',
                toastr: 'readonly',
            },
            parserOptions: {
                sourceType: 'module',
            },
        },
        {
            files: ['webpack.config.js', '.eslintrc.js'],
            parserOptions: {
            },
            env: {
                node: true,
            },
        },
    ],
    // There are various vendored libraries that shouldn't be linted
    ignorePatterns: [
        'dist/**/*',
        'node_modules/**/*',
    ],
    rules: {
        'no-unused-vars': ['error', { args: 'none' }],
        'no-control-regex': 'off',
        'no-constant-condition': ['error', { checkLoops: false }],
        'require-yield': 'off',
        'quotes': ['error', 'single'],
        'semi': ['error', 'always'],
        'indent': ['error', 4, { SwitchCase: 1, FunctionDeclaration: { parameters: 'first' } }],
        'comma-dangle': ['error', 'always-multiline'],
        'eol-last': ['error', 'always'],
        'no-trailing-spaces': 'error',
        'object-curly-spacing': ['error', 'always'],
        'space-infix-ops': 'error',
        'no-unused-expressions': ['error', { allowShortCircuit: true, allowTernary: true }],
        'no-cond-assign': 'error',

        // These rules should eventually be enabled.
        'no-async-promise-executor': 'off',
        'no-inner-declarations': 'off',
    },
};
