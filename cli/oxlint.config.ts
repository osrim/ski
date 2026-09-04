import { defineConfig } from "oxlint";

export default defineConfig({
  categories: {
    correctness: "error",
    suspicious: "error",
  },
  rules: {
    "func-style": ["error", "expression"],
    "eslint/require-await": "error",
    "eslint/require-unicode-regexp": "error",
    "eslint/no-loop-func": "error",
    "unicorn/prefer-array-find": "error",
    "oxc/no-map-spread": "error",
  },
});
