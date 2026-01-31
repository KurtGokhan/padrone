import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://gkurt.com/padrone/',

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
            { label: 'Commands & Options', slug: 'guides/commands-options' },
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
  },
});
