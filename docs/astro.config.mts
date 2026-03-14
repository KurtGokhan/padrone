import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://gkurt.com',
  base: '/padrone',

  integrations: [
    starlight({
      customCss: ['./src/styles/global.css'],
      title: 'Padrone',
      description: 'Create type-safe, interactive CLI apps with Zod schemas',
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/KurtGokhan/padrone' },
        { icon: 'npm', label: 'npm', href: 'https://www.npmjs.com/package/padrone' },
      ],
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'guides/introduction' },
            { label: 'Quick Start', slug: 'guides/quick-start' },
          ],
        },
        {
          label: 'Guides',
          items: [
            { label: 'Commands & Arguments', slug: 'guides/commands-arguments' },
            { label: 'Interactive Prompting', slug: 'guides/interactive-prompting' },
            { label: 'AI Integration', slug: 'guides/ai-integration' },
          ],
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' },
        },
      ],
    }),
    react(),
  ],

  vite: {
    plugins: [tailwindcss()],
    resolve: {
      conditions: ['padrone@dev'],
    },
    ssr: {
      resolve: {
        conditions: ['padrone@dev'],
      },
    },
  },
});
