import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, Plugin} from 'vite';
import {VitePWA} from 'vite-plugin-pwa';

function standaloneClassicSingleFilePlugin(): Plugin {
  return {
    name: 'standalone-classic-singlefile',
    apply: 'build',
    enforce: 'post',
    generateBundle(_, bundle) {
      const htmlAsset = bundle['index.html'];
      if (!htmlAsset || htmlAsset.type !== 'asset') return;

      let jsCode = '';
      const cssChunks: string[] = [];

      for (const [fileName, item] of Object.entries(bundle)) {
        if (item.type === 'chunk' && item.isEntry) {
          jsCode = item.code;
          delete bundle[fileName];
        } else if (item.type === 'asset' && fileName.endsWith('.css')) {
          const cssText = typeof item.source === 'string' ? item.source : item.source.toString();
          cssChunks.push(cssText);
          delete bundle[fileName];
        }
      }

      let html = typeof htmlAsset.source === 'string' ? htmlAsset.source : htmlAsset.source.toString();

      // Remove Vite build script tags (preserving data-keep="true" inline error trap), stylesheet, modulepreload, manifest, and icon tags
      html = html.replace(/<script\b(?![^>]*data-keep=["']true["'])[^>]*>[\s\S]*?<\/script>/gi, '');
      html = html.replace(/<link\b[^>]*rel=["'](?:stylesheet|modulepreload|manifest|apple-touch-icon)["'][^>]*>/gi, '');

      const combinedCss = cssChunks.join('\n').replace(/<\/style/gi, '<\\/style');
      const safeJs = jsCode.replace(/<\/script/gi, '<\\/script');

      if (combinedCss) {
        html = html.replace('</head>', `<style>${combinedCss}</style>\n  </head>`);
      }
      if (safeJs) {
        html = html.replace('</body>', `<script>${safeJs}</script>\n  </body>`);
      }

      htmlAsset.source = html;
    },
  };
}

export default defineConfig(() => {
  return {
    base: './',
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        includeAssets: ['icon.svg', 'apple-touch-icon.png', 'pwa-192x192.png', 'pwa-512x512.png', 'pwa-maskable-512x512.png'],
        manifest: {
          id: '/',
          name: 'Sürücü Takip',
          short_name: 'SürücüTakip',
          description: 'Direksiyon eğitmenleri için çevrimdışı çalışan kursiyer, eğitim ve sınav takip uygulaması.',
          theme_color: '#0F274A',
          background_color: '#F8FAFC',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          lang: 'tr',
          icons: [
            {
              src: '/pwa-192x192.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        },
        devOptions: {
          enabled: true,
          type: 'module',
        },
      }),
      standaloneClassicSingleFilePlugin(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    build: {
      cssCodeSplit: false,
      assetsInlineLimit: 100000000,
      rollupOptions: {
        output: {
          format: 'iife' as const,
          inlineDynamicImports: true,
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
