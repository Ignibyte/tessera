import eslint from "@eslint/js";
import vitest from "@vitest/eslint-plugin";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "playwright-report/**", "test-results/**"],
  },
  {
    // An eslint-disable comment has no effect and is reported as a warning, which
    // --max-warnings=0 turns into a failure.
    linterOptions: { noInlineConfig: true, reportUnusedInlineConfigs: "error" },
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": true,
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
        },
      ],
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowBoolean: true, allowNullish: true, allowNumber: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // The trusted expression engine compiles expressions with `new Function`; docs/design.md
    // keeps it and docs/decisions.md records this exception. This one file, this one rule.
    files: ["src/expression.ts"],
    rules: { "@typescript-eslint/no-implied-eval": "off" },
  },
  {
    // A test may prove a type error, with a reason.
    files: ["test/**/*.ts"],
    rules: {
      "@typescript-eslint/ban-ts-comment": [
        "error",
        {
          "ts-expect-error": "allow-with-description",
          "ts-ignore": true,
          "ts-nocheck": true,
          "ts-check": false,
        },
      ],
    },
  },
  {
    files: ["test/unit/**/*.ts", "test/property/**/*.ts"],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      "vitest/no-disabled-tests": "error",
      "vitest/no-focused-tests": "error",
    },
  },
  {
    files: ["**/*.js"],
    ...tseslint.configs.disableTypeChecked,
  },
);
