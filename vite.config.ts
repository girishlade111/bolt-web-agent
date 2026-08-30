import { cloudflareDevProxyVitePlugin as remixCloudflareDevProxy, vitePlugin as remixVitePlugin } from '@remix-run/dev';
import UnoCSS from 'unocss/vite';
import { defineConfig, loadEnv, type ViteDevServer } from 'vite';
import { nodePolyfills } from 'vite-plugin-node-polyfills';
import { optimizeCssModules } from 'vite-plugin-optimize-css-modules';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig((config) => {
  const env = loadEnv(config.mode, process.cwd(), '');
  process.env.NVIDIA_API_KEY = env.NVIDIA_API_KEY || process.env.NVIDIA_API_KEY;
  process.env.NVIDIA_NIM_API_KEY = env.NVIDIA_NIM_API_KEY || process.env.NVIDIA_NIM_API_KEY;

  return {
    build: {
      target: 'esnext',
    },
    plugins: [
      nodePolyfills({
        include: ['path', 'buffer'],
      }),
      // Workaround: in SSR dev mode, `path-browserify` (the browser polyfill for
      // `node:path`) is a CommonJS file, and Vite's SSR module runner evaluates it
      // as ESM, which throws `ReferenceError: module is not defined`. Convert its
      // single CJS export to a real ESM export for SSR only.
      {
        name: 'ssr-path-browserify-cjs-fix',
        enforce: 'pre',
        transform(code, id, options) {
          if (options?.ssr && id.includes('path-browserify') && code.includes('module.exports = posix;')) {
            return {
              code: code.replace('module.exports = posix;', 'export default posix;'),
              map: null,
            };
          }

          return null;
        },
      },
      config.mode !== 'test' && remixCloudflareDevProxy(),
      remixVitePlugin({
        future: {
          v3_fetcherPersist: true,
          v3_relativeSplatPath: true,
          v3_throwAbortReason: true,
        },
      }),
      UnoCSS(),
      tsconfigPaths(),
      chrome129IssuePlugin(),
      config.mode === 'production' && optimizeCssModules({ apply: 'build' }),
    ],
  };
});

function chrome129IssuePlugin() {
  return {
    name: 'chrome129IssuePlugin',
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const raw = req.headers['user-agent']?.match(/Chrom(e|ium)\/([0-9]+)\./);

        if (raw) {
          const version = parseInt(raw[2], 10);

          if (version === 129) {
            res.setHeader('content-type', 'text/html');
            res.end(
              '<body><h1>Please use Chrome Canary for testing.</h1><p>Chrome 129 has an issue with JavaScript modules & Vite local development, see <a href="https://github.com/stackblitz/bolt.new/issues/86#issuecomment-2395519258">for more information.</a></p><p><b>Note:</b> This only impacts <u>local development</u>. `pnpm run build` and `pnpm run start` will work fine in this browser.</p></body>',
            );

            return;
          }
        }

        next();
      });
    },
  };
}
