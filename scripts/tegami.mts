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

        // Put the release version in the Version Packages PR title
        // ("chore: release v2.0.0"), like the old Changesets workflow.
        // Must be a method (not an arrow) so `this` binds to the TegamiContext.
        // `create` runs after the draft is applied, so read the already-bumped
        // version straight off the graph — re-bumping would title the PR one
        // release ahead of the actual bump. All packages share a version, so
        // `padrone` is representative.
        create() {
          const version = this.graph.get('npm:padrone')?.version;
          return { title: version ? `chore: release v${version}` : 'chore: release' };
        },
      },
    }),
  ],
});

void createCli(paper).parseAsync();
