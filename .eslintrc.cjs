/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
  },
  plugins: ["@typescript-eslint", "import"],
  extends: [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:@typescript-eslint/recommended-requiring-type-checking",
    "plugin:import/recommended",
    "plugin:import/typescript",
    "prettier",
  ],
  rules: {
    // Named exports only
    "import/no-default-export": "error",
    "import/order": [
      "error",
      {
        groups: [
          "builtin",
          "external",
          "internal",
          "parent",
          "sibling",
          "index",
          "type",
        ],
        "newlines-between": "always",
        alphabetize: { order: "asc" },
      },
    ],
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-explicit-any": "error",
    "no-console": ["warn", { allow: ["warn", "error", "info"] }],
  },
  overrides: [
    {
      // Next.js pages and layouts require default exports
      files: [
        "apps/web/app/**/{page,layout,error,loading,not-found}.tsx",
        "apps/web/app/**/[[...sign-in]]/page.tsx",
        "apps/web/app/**/[[...sign-up]]/page.tsx",
        "apps/web/middleware.ts",
        "apps/web/next.config.ts",
        "apps/web/tailwind.config.ts",
        "apps/web/postcss.config.cjs",
        "**/drizzle.config.ts",
        "**/vitest.config.ts",
      ],
      rules: {
        "import/no-default-export": "off",
      },
    },
    {
      files: ["**/*.cjs"],
      env: { node: true },
      parserOptions: { sourceType: "script" },
    },
  ],
  settings: {
    "import/resolver": {
      typescript: {
        project: ["apps/*/tsconfig.json", "packages/*/tsconfig.json"],
      },
    },
  },
  ignorePatterns: [
    "node_modules/",
    "dist/",
    ".next/",
    "*.gen.ts",
    "*.generated.*",
    "migrations/",
  ],
};
