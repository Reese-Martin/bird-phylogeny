import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { stickerDeliveryPlugin } from './scripts/sticker-delivery-middleware.ts';

export default defineConfig({
  plugins: [react(),stickerDeliveryPlugin()],
  server: {
    host: '127.0.0.1', port: 5173, strictPort: true,
    watch: { ignored: ['**/personal/**', '**/data/raw/**', '**/test-results/**', '**/.tools/**', '**/public/stickers/**', '**/public/sticker-sheets/**'] },
    fs: { deny: ['**/personal/**', '**/data/raw/**', '**/.tools/**', '**/.git/**', '**/.env*', '**/*.{crt,pem}'] },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
