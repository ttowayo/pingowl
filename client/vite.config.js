import { defineConfig } from 'vite';

export default defineConfig({
  base: './', // GitHub Pages 등 서브 디렉토리 배포를 위해 상대 경로 사용
  server: {
    host: '127.0.0.1',
    port: 5600,
    strictPort: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true
      }
    }
  }
});
