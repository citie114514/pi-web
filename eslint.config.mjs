import coreWebVitals from "eslint-config-next/core-web-vitals";
import typescript from "eslint-config-next/typescript";

const eslintConfig = [
  // demo/ is a separate Next.js project with its own lint config; release/ holds
  // electron-builder output (a copy of the whole app tree).
  { ignores: ["demo/**", "release/**"] },
  ...coreWebVitals,
  ...typescript,
  {
    // The desktop shell is a CommonJS Node program, not a TypeScript module;
    // bin/*.js keeps its own inline disables (upstream convention).
    files: ["desktop/**/*.js"],
    languageOptions: { sourceType: "commonjs" },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
  {
    rules: {
      "react-hooks/immutability": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      // React Compiler optimisation hints, not correctness: upstream's manual
      // memoization in ChatInput / ChatMinimap / SkillsConfig / useAgentSession
      // can't be preserved by the compiler. Same reasoning as the three above.
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
];

export default eslintConfig;
