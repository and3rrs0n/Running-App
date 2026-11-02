/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0d10',
        surface: '#14171c',
        raised: '#1b1f26',
        line: '#262b33',
        muted: '#8b93a1',
        dim: '#5d6573',
        ink: '#eef1f5',
        accent: { DEFAULT: '#3ee0a1', soft: 'rgba(62,224,161,0.14)' },
        run: '#3ee0a1',
        walk: '#7aa8ff',
        strength: '#f5b452',
        bike: '#c58bff',
        warn: '#f5b452',
        danger: '#ff6b6b',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'system-ui', 'sans-serif'],
        display: ['-apple-system', 'BlinkMacSystemFont', 'SF Pro Display', 'Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: { xl2: '1.25rem' },
    },
  },
  plugins: [],
};
