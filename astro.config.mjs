import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import { defineConfig } from 'astro/config';

const useVercel = Boolean(process.env.VERCEL || process.env.BUILD_TARGET === 'vercel');

export default defineConfig({
  output: 'server',
  adapter: useVercel ? vercel() : node({ mode: 'standalone' }),
  server: { port: 4321, host: true },
  devToolbar: { enabled: false },
  vite: {
    server: {
      fs: { allow: ['..'] },
    },
  },
});
