import type { Config } from "tailwindcss";

/**
 * ARCHIHUB — Tailwind конфиг для CRM-системы.
 *
 * Все стилевые значения берутся ТОЛЬКО из этого файла.
 * Не вводи произвольные hex-коды, отступы или радиусы в компонентах —
 * пользуйся ключами theme.colors, theme.spacing, theme.borderRadius и т.д.
 *
 * Тёмная тема включается атрибутом data-theme="graphite" на <html>.
 */
const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: ["selector", "[data-theme='graphite']"],
  theme: {
    extend: {
      colors: {
        // — Поверхности —
        bg:         "var(--bg, #efe9de)",
        "bg-elev":  "var(--bg-elev, #f6f1e7)",
        surface:    "var(--surface, #fbf8f1)",
        "surface-2":"var(--surface-2, #f1ebdd)",
        line:       "var(--line, #e1d8c5)",
        "line-strong": "var(--line-strong, #cdc1a8)",

        // — Текст —
        ink: {
          DEFAULT: "var(--ink, #1f1c14)",
          2:       "var(--ink-2, #4a463a)",
          3:       "var(--ink-3, #7a7565)",
          4:       "var(--ink-4, #a9a392)",
        },

        // — Бренд —
        ochre: {
          DEFAULT: "var(--ochre, #b07a2c)",
          soft:    "var(--ochre-soft, #e9d6ad)",
          bg:      "var(--ochre-bg, #f5e9cc)",
        },

        // — Статусы проекта —
        "status-in-progress":    { DEFAULT: "#3b4a55", bg: "#d8dfe3" },
        "status-shipping":       { DEFAULT: "#5a6b3c", bg: "#e1e3cf" },
        "status-done":           { DEFAULT: "#2f5e3f", bg: "#d2e3d3" },
        "status-canceled":       { DEFAULT: "#a04930", bg: "#f1d9cf" },

        // — Семантические —
        profit:  "#2f5e3f",
        expense: "#8a3f47",
        warning: "#a04930",
        info:    "#3b4a55",
      },

      spacing: {
        "0.5": "2px",
        1:     "4px",
        1.5:   "6px",
        2:     "8px",
        2.5:   "10px",
        3:     "12px",
        3.5:   "14px",
        4:     "16px",
        5:     "20px",
        6:     "24px",
        7:     "28px",
        8:     "32px",
        10:    "40px",
        12:    "48px",
        14:    "56px",
        16:    "64px",
      },

      borderRadius: {
        none: "0",
        sm:   "6px",
        md:   "10px",
        lg:   "16px",
        xl:   "22px",
        full: "9999px",
      },

      boxShadow: {
        sm: "0 1px 0 rgba(48,42,28,.04), 0 1px 2px rgba(48,42,28,.06)",
        md: "0 1px 0 rgba(255,255,255,.5) inset, 0 8px 24px -8px rgba(48,42,28,.18)",
        lg: "0 1px 0 rgba(255,255,255,.5) inset, 0 24px 48px -12px rgba(48,42,28,.28)",
      },

      fontFamily: {
        display: ['"Newsreader"', '"Cormorant Garamond"', "Georgia", "serif"],
        ui:      ['"Manrope"', '"Inter"', "system-ui", "sans-serif"],
        mono:    ['"JetBrains Mono"', "ui-monospace", '"SF Mono"', "monospace"],
      },

      fontSize: {
        xs:          ["10.5px", { lineHeight: "1.3" }],
        eyebrow:     ["10.5px", { lineHeight: "1.3", letterSpacing: "0.12em" }],
        sm:          ["11.5px", { lineHeight: "1.4" }],
        base:        ["13px",   { lineHeight: "1.5" }],
        body:        ["14px",   { lineHeight: "1.5" }],
        md:          ["15px",   { lineHeight: "1.5" }],
        lg:          ["17px",   { lineHeight: "1.3" }],
        xl:          ["20px",   { lineHeight: "1.2" }],
        "display-sm":["22px",   { lineHeight: "1.15" }],
        display:     ["28px",   { lineHeight: "1.1" }],
        "display-lg":["34px",   { lineHeight: "1.05" }],
        "display-xl":["38px",   { lineHeight: "1.05" }],
      },

      letterSpacing: {
        tight:  "-0.01em",
        normal: "0",
        wide:   "0.04em",
        wider:  "0.12em",
        widest: "0.18em",
      },

      transitionDuration: {
        instant: "100ms",
        fast:    "150ms",
        base:    "200ms",
        slow:    "300ms",
      },

      transitionTimingFunction: {
        spring: "cubic-bezier(0.2, 0.7, 0.4, 1.2)",
        soft:   "cubic-bezier(0.3, 0.7, 0.4, 1)",
      },

      keyframes: {
        "fade-in":      { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        "modal-pop":    { from: { opacity: "0", transform: "translateY(8px) scale(.98)" }, to: { opacity: "1", transform: "none" } },
        "dropdown-pop": { from: { opacity: "0", transform: "translateY(-4px) scale(.98)" }, to: { opacity: "1", transform: "none" } },
        "overdue-pulse":{
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(160, 73, 48, 0)" },
          "50%":      { boxShadow: "0 0 0 4px rgba(160, 73, 48, .12)" },
        },
      },
      animation: {
        "fade-in":       "fade-in 220ms cubic-bezier(0.3, 0.7, 0.4, 1) both",
        "modal-pop":     "modal-pop 200ms cubic-bezier(0.2, 0.7, 0.4, 1.2) both",
        "dropdown-pop":  "dropdown-pop 140ms cubic-bezier(0.2, 0.7, 0.4, 1.2) both",
        "overdue-pulse": "overdue-pulse 2.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};

export default config;
