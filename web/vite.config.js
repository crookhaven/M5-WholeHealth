import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// On GitHub Pages the site lives under /<repo name>/. Take the name from the
// Actions environment so renaming the repo can't break the deployed paths.
const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'M5-WholeHealth'

// https://vite.dev/config/
export default defineConfig({
  base: process.env.GITHUB_PAGES ? `/${repoName}/` : '/',
  plugins: [react()],
  // Two pages: M5 itself, and the made-up clinic that checks in with it.
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        clinic: fileURLToPath(new URL('./clinic/index.html', import.meta.url)),
      },
    },
  },
  test: {
    setupFiles: ['./src/test/setup.js'],
  },
})
