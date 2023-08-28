/* eslint-env node */
module.exports = {
    extends: [
        'eslint:recommended',
        'plugin:@typescript-eslint/recommended',
        "plugin:mocha/recommended",
        'standard-with-typescript'
    ],
    parser: '@typescript-eslint/parser',
    plugins: ['@typescript-eslint'],
    root: true,
    ignorePatterns: [
        "node_modules/**/*",
        "src/lexicon/**/*",
        "src/frontend/**/*",
        "dist/**/*"
    ],
    rules: {
        "mocha/no-mocha-arrows": "off",
        // if I'm using `!!` it's because I know what I'm doing.
        // I feel like the syntax sufficiently indicates
        // better than a rule suppression comment
        "@typescript-eslint/no-extra-non-null-assertion": "off",
        "@typescript-eslint/no-non-null-assertion": "off",
        "@typescript-eslint/no-unused-vars": [
            "error",
            { "argsIgnorePattern": "^_" }
        ]
    }
}