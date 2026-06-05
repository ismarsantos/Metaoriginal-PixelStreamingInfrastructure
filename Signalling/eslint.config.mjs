// Copyright Epic Games, Inc. All Rights Reserved.

import { fileURLToPath } from 'url';
import { dirname } from 'path';
import tseslint from 'typescript-eslint';
import tsdocPlugin from 'eslint-plugin-tsdoc';
import baseConfig from '../eslint.config.mjs'

// import.meta.dirname requires Node ≥21.2; use fileURLToPath for compatibility.
const __dirname = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
    baseConfig,
    {
        ignores: [],
    },
    {
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                project: 'tsconfig.cjs.json',
                tsconfigRootDir: __dirname,
            },
        },
        files: ["src/**/*.ts"],
        plugins: {
            'tsdoc': tsdocPlugin,
        },
        rules: {
            "tsdoc/syntax": "warn",
            "@typescript-eslint/require-array-sort-compare": "error",
            "no-unused-vars": "off",
            "@typescript-eslint/no-misused-promises": "off", // http.createServer(app) is throwing this
            "@typescript-eslint/no-unused-vars": [
                "error",
                {
                    "argsIgnorePattern": "^_",
                    "varsIgnorePattern": "^_",
                    "caughtErrorsIgnorePattern": "^_"
                }
            ]
        }
    }
);
