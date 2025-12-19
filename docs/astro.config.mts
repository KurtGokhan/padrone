import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'astro/config';
import starlightThemeNova from 'starlight-theme-nova';

export default defineConfig({
  site: 'https://gkurt.com/padrone/',

  integrations: [
    starlight({
      plugins: [starlightThemeNova()],
      title: 'My Docs',
      social: [{ icon: 'github', label: 'GitHub', href: 'https://github.com/KurtGokhan/padrone' }],
      sidebar: [
        {
          label: 'Guides',
          items: [{ label: 'Example Guide', slug: 'guides/example' }],
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
  },
});
