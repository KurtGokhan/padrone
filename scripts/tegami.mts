// scripts/tegami.mts — Tegami versioning + publishing config.
//
// Run via the package script: { "tegami": "bun scripts/tegami.mts" }
import { tegami } from 'tegami';
import { createCli } from 'tegami/cli';
import { github } from 'tegami/plugins/github';

const paper = tegami({
  // All packages share one version (replaces Changesets `fixed`). `syncBump`
  // applies the same bump type to every member, so they stay aligned because
  // they already share a version today.
  groups: { all: { syncBump: true } },
  packages: () => ({ group: 'all' }),

  npm: {
    client: 'bun',
  },

  plugins: [
    github({
      repo: 'gkurt/padrone',
      versionPr: {
        base: 'main',
      },
    }),
  ],
});

void createCli(paper).parseAsync();
