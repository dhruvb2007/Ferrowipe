/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono",
          "Cascadia Code",
          "Consolas",
          "ui-monospace",
          "monospace",
        ],
      },
      keyframes: {
        "indeterminate-bar": {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(350%)" },
        },
        "obs-ping": {
          "0%": { opacity: "0.6", transform: "scale(1)" },
          "75%, 100%": { opacity: "0", transform: "scale(2.3)" },
        },
      },
      animation: {
        "indeterminate-bar": "indeterminate-bar 1.35s cubic-bezier(0.22, 1, 0.36, 1) infinite",
        "obs-ping": "obs-ping 1.8s cubic-bezier(0, 0, 0.2, 1) infinite",
      },
    },
  },
  plugins: [],
};
