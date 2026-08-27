// One config for the whole workspace, run from the root as `pnpm lint`.
//
// The rules that are errors here are the ones that would let a real defect through in
// this particular codebase: silently discarded promises around proving and chain calls,
// swallowed errors, and the escape hatches that turn a type error into a runtime one.
// Style is left to the formatter.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/.next/**",
      "**/.open-next/**",
      "**/node_modules/**",
      // Pinned upstream source, vendored verbatim. Linting it would report on somebody
      // else's code and any fix would break the pin.
      ".vendor/**",
      "**/*.d.ts",
      "contracts/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        // Each package's tsconfig.json covers its tests; tsconfig.build.json is the one
        // that excludes them from emit. So type-aware rules reach test files through a
        // real project rather than the default-project fallback, which is capped.
        projectService: {
          allowDefaultProject: ["*.mjs", "*.js", "*/*/*.mjs"],
          defaultProject: "tsconfig.json",
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A dropped promise here means an unobserved proving failure or an unawaited
      // chain write, which is exactly the class of bug that looks like success.
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      // The project's hard rule: never suppress a type error.
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/ban-ts-comment": "error",
      // An empty catch turns a failed clearance into a silent one.
      "no-empty": ["error", { allowEmptyCatch: false }],
      // Scripts are operator tools and print their results.
      "no-console": "off",
      // A function is often async because the interface it satisfies is async — Next's
      // `headers()`, a test double for an async provider. The async bugs that matter
      // here are unobserved promises and awaiting a non-promise, both still errors.
      "@typescript-eslint/require-await": "off",
      // Destructuring a field out in order to drop it is the clearest way to strip
      // response-only fields, so an underscore-prefixed binding is intentional.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", ignoreRestSiblings: true },
      ],
    },
  },
  {
    // Scripts talk to RPC and prover JSON that has no generated types, so narrowing
    // every response would mean inventing a schema the upstream does not publish.
    files: ["scripts/**", "tools/**"],
    rules: {
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  }
);
