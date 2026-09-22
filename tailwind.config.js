/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Brand gold taken from the Hornung Consulting logo
        gold: {
          50: '#FBF8F1',
          100: '#F5EEDF',
          200: '#EADCBD',
          300: '#DCC495',
          400: '#C9A968',
          500: '#BE9C55',
          600: '#A98545',
          700: '#8C6D34',
          800: '#6E552B',
          900: '#4D3B1E'
        },
        ink: {
          50: '#F7F7F6',
          100: '#EDECEA',
          200: '#DCDAD5',
          300: '#B9B5AD',
          400: '#8C8880',
          500: '#66625B',
          600: '#4A4741',
          700: '#3A3733',
          800: '#272522',
          900: '#1C1B19'
        },
        sand: '#FAF8F4',
        line: '#E8E2D6'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Cormorant Garamond"', 'Georgia', 'serif']
      },
      boxShadow: {
        card: '0 1px 2px rgba(28, 27, 25, 0.04), 0 8px 24px -12px rgba(28, 27, 25, 0.12)',
        lift: '0 2px 4px rgba(28, 27, 25, 0.05), 0 16px 40px -16px rgba(28, 27, 25, 0.18)'
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.125rem'
      }
    }
  },
  plugins: []
}
