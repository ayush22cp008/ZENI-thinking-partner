import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load env variables so we can read VITE_MODE here
  const env = loadEnv(mode, process.cwd(), '')
  const isPrivate = env.VITE_MODE !== 'demo'

  return {
    plugins: [react(), tailwindcss()],
    server: {
      proxy: isPrivate
        ? {
            // Only proxy to local Ollama in private mode
            '/ollama': {
              target: 'http://localhost:11434',
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/ollama/, ''),
            },
          }
        : {}, // Demo mode — no proxy needed, calls go directly to Groq
    },
  }
})
