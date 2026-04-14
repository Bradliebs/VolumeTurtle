import type { Config } from "jest";

const config: Config = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  testMatch: ["**/__tests__/**/*.test.ts"],
  collectCoverageFrom: [
    "src/lib/**/*.ts",
    "!src/lib/**/*.d.ts",
    "!src/generated/**",
  ],
  coverageThreshold: {
    global: {
      lines: 40,
      functions: 40,
      branches: 30,
    },
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          module: "commonjs",
          moduleResolution: "node",
          esModuleInterop: true,
          strict: true,
          noUncheckedIndexedAccess: true,
          jsx: "react-jsx",
          paths: { "@/*": ["./src/*"] },
        },
      },
    ],
  },
};

export default config;
