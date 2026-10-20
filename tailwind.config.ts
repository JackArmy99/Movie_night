import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f1115",
        panel: "#191c23",
        line: "#2a2f3a",
        accent: "#f5b942",
      },
    },
  },
  plugins: [],
};

export default config;
