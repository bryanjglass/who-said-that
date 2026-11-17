import { fileURLToPath } from "node:url";
const here = (p) => fileURLToPath(new URL(p, import.meta.url));

/** @type {import('tailwindcss').Config} */
export default {
  content: [here("./index.html"), here("./src/**/*.{ts,tsx}")],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: "#120C2B", 900: "#0B0720", 800: "#1A1240", 700: "#251A57", 600: "#33256F", 500: "#4A3A94" },
        cream: { DEFAULT: "#FFF7E6", 200: "#FFEFCC" },
        pop: {
          yellow: "#FFD23F",
          pink: "#FF4F8B",
          cyan: "#2DE1FC",
          green: "#3DDC84",
          red: "#FF5A5F",
          orange: "#FF9F1C",
          purple: "#9B6BFF",
        },
      },
      fontFamily: {
        display: ['"Fredoka"', "ui-rounded", "system-ui", "sans-serif"],
        body: ['"Nunito"', "system-ui", "sans-serif"],
      },
      boxShadow: {
        pop: "0 6px 0 0 rgba(0,0,0,0.35)",
        "pop-sm": "0 3px 0 0 rgba(0,0,0,0.35)",
        glow: "0 0 40px 6px rgba(255,210,63,0.55)",
        "glow-green": "0 0 30px 6px rgba(61,220,132,0.7)",
      },
      keyframes: {
        wobble: { "0%,100%": { transform: "rotate(-3deg)" }, "50%": { transform: "rotate(3deg)" } },
        floaty: { "0%,100%": { transform: "translateY(0)" }, "50%": { transform: "translateY(-10px)" } },
        pulseRing: { "0%": { transform: "scale(0.9)", opacity: "0.8" }, "100%": { transform: "scale(1.6)", opacity: "0" } },
        shimmer: { "0%": { backgroundPosition: "-200% 0" }, "100%": { backgroundPosition: "200% 0" } },
      },
      animation: {
        wobble: "wobble 2.4s ease-in-out infinite",
        floaty: "floaty 3s ease-in-out infinite",
        "pulse-ring": "pulseRing 1.4s ease-out infinite",
        shimmer: "shimmer 3s linear infinite",
      },
    },
  },
  plugins: [],
};
