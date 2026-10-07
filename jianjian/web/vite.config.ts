import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const api = process.env.API_ORIGIN ?? 'http://localhost:8080';

// 浏览器直接打开 /s/rec/:token 时交给前端页面；接口请求（fetch）仍转发到后端
const shareRec = {
  target: api,
  bypass: (req: { url?: string; headers: { accept?: string } }) =>
    req.url?.startsWith('/s/rec/') && req.headers.accept?.includes('text/html') ? '/index.html' : undefined,
};

const proxy = { '/api': api, '/s/rec/': shareRec, '/s/': api, '/v/': api, '/health': api };

export default defineConfig({
  plugins: [react()],
  server: { host: '0.0.0.0', port: 5173, allowedHosts: true, proxy },
  preview: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true, proxy },
});
