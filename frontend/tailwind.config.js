/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // Every colour resolves through a CSS variable so the whole app can flip
      // to dark mode by swapping variables on <html>, never by hunting hex codes.
      colors: {
        canvas: 'rgb(var(--c-canvas) / <alpha-value>)',
        surface: 'rgb(var(--c-surface) / <alpha-value>)',
        raised: 'rgb(var(--c-raised) / <alpha-value>)',
        ink: 'rgb(var(--c-ink) / <alpha-value>)',
        muted: 'rgb(var(--c-muted) / <alpha-value>)',
        line: 'rgb(var(--c-line) / <alpha-value>)',
        leaf: 'rgb(var(--c-leaf) / <alpha-value>)',
        'leaf-soft': 'rgb(var(--c-leaf-soft) / <alpha-value>)',
        bark: 'rgb(var(--c-bark) / <alpha-value>)',
        bloom: 'rgb(var(--c-bloom) / <alpha-value>)',
        danger: 'rgb(var(--c-danger) / <alpha-value>)',
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
        display: ['Fraunces', 'Georgia', 'serif'],
      },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.05), 0 6px 18px -8px rgb(0 0 0 / 0.18)',
        lift: '0 2px 6px rgb(0 0 0 / 0.07), 0 18px 40px -12px rgb(0 0 0 / 0.28)',
      },
      keyframes: {
        grow: { '0%': { strokeDashoffset: '1' }, '100%': { strokeDashoffset: '0' } },
        sprout: {
          '0%': { opacity: '0', transform: 'translateY(10px) scale(.94)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        fade: { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        slideUp: {
          '0%': { opacity: '0', transform: 'translateY(16px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        sprout: 'sprout .45s cubic-bezier(.2,.9,.3,1) both',
        fade: 'fade .25s ease-out both',
        slideUp: 'slideUp .3s cubic-bezier(.2,.9,.3,1) both',
      },
    },
  },
  plugins: [],
}
