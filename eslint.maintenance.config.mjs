import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const reactCompilerRules =
  reactHooks.configs?.["recommended-latest"]?.rules ??
  reactHooks.configs?.recommended?.rules ??
  {};

export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".turbo/**",
      ".maintenance/**",
      ".pnpm-store/**",
      "dist/**",
      "build/**",
      "storybook-static/**",
      "**/*.stories.ts",
      "**/*.stories.tsx",
      "packages/web/src/components/ui/**",
      "packages/web/test-results/**",
      "packages/web/playwright-report/**",
    ],
  },
  {
    files: ["packages/*/src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-deprecated": "warn",
    },
  },
  {
    files: ["packages/web/src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: reactCompilerRules,
  },
];
