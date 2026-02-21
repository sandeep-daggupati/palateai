import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        'bg-light': '#F6F4EF',
        'bg-dark': '#0F1412',
        'card-dark': '#161B18',
        'brand-primary': '#1F3D2B',
        'brand-accent': '#C9A227',
        'brand-primary-dark': '#3E6B4E',
        'brand-accent-dark': '#D4AF37',
        app: {
          bg: 'var(--color-bg)',
          card: 'var(--color-card)',
          text: 'var(--color-text)',
          muted: 'var(--color-muted)',
          border: 'var(--color-border)',
          primary: 'var(--color-primary)',
          'primary-text': 'var(--color-primary-text)',
          accent: 'var(--color-accent)',
          link: 'var(--color-link)',
        },
      },
    },
  },
  plugins: [],
};

export default config;
