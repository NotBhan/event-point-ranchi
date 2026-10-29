import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import { defineConfig } from 'astro/config';

const useVercel = Boolean(process.env.VERCEL || process.env.BUILD_TARGET === 'vercel');

export default defineConfig({
  output: 'server',
  adapter: useVercel ? vercel() : node({ mode: 'standalone' }),
  server: { port: 4321, host: true },
  devToolbar: { enabled: false },
  security: {
    checkOrigin: false,
  },
  vite: {
    server: {
      fs: { allow: ['..'] },
      cors: true,
      allowedHosts: true,
    },
    plugins: [
      {
        name: 'allow-static-assets-dev',
        configureServer(server) {
          const patchRequest = (req) => {
            if (
              req.headers &&
              req.headers['sec-fetch-site'] &&
              req.headers['sec-fetch-site'] !== 'same-origin' &&
              req.url &&
              (req.url.startsWith('/images/') ||
                req.url.startsWith('/storage/') ||
                req.url.startsWith('/favicon') ||
                /\.(svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf|css)$/i.test(req.url.split('?')[0]))
            ) {
              req.headers['sec-fetch-site'] = 'same-origin';
            }
          };

          return () => {
            const secFetchEntry = server.middlewares.stack.find(
              (m) => m.handle && (m.handle.name === 'devSecFetch' || m.handle.name === 'secFetchMiddleware')
            );
            if (secFetchEntry) {
              const orig = secFetchEntry.handle;
              secFetchEntry.handle = function devSecFetchPatched(req, res, next) {
                patchRequest(req);
                return orig.call(this, req, res, next);
              };
            }

            server.middlewares.stack.unshift({
              route: '',
              handle(req, _res, next) {
                patchRequest(req);
                next();
              },
            });
          };
        },
      },
    ],
  },
});
