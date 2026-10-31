import node from '@astrojs/node';
import vercel from '@astrojs/vercel';
import { defineConfig } from 'astro/config';

const useVercel = Boolean(process.env.VERCEL || process.env.BUILD_TARGET === 'vercel');
// `astro dev` may inherit NODE_ENV=production from the shell, so detect the
// command explicitly instead of relying on NODE_ENV.
const isDevCommand = process.argv.includes('dev') && !process.argv.includes('build');

export default defineConfig({
  output: 'server',
  adapter: useVercel ? vercel() : node({ mode: 'standalone' }),
  server: { port: 4321, host: true },
  // Hover prefetching multiplies SSR renders on every link hover; useful in
  // production, noise in dev (each hover re-renders the page server-side).
  prefetch: isDevCommand ? false : { prefetchAll: true, defaultStrategy: 'hover' },
  devToolbar: { enabled: false },
  security: {
    checkOrigin: false,
  },
  vite: {
    optimizeDeps: {
      // jsQR is imported on demand by the admin scanner; pre-bundling keeps the
      // first scan instant in dev.
      include: ['jsqr'],
    },
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
