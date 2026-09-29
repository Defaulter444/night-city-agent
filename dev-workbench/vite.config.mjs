import { defineConfig } from 'vite';
const name = process.env.CODESPACE_NAME;
const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN;
export default defineConfig({
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    allowedHosts: name && domain ? [`${name}-5173.${domain}`] : [],
    fs: { deny: ['.env', '.env.*', '**/.git/**', '**/.tools/**', '**/.codex/**', '**/.gemini/**', '**/.mcp.json', '**/repos/**', '**/reports/**'] }
  },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true }
});
