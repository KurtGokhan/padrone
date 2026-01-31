# Changesets

This folder is used by `@changesets/cli` to manage versioning and changelogs.

## Adding a Changeset

When you make a change that should be noted in the changelog, run:

```bash
bun changeset
```

Follow the prompts to:
1. Select the `padrone` package
2. Choose the semver bump type (major/minor/patch)
3. Write a summary of your changes

This creates a markdown file in `.changeset/` that will be consumed during release.

## Changeset Types

- **patch**: Bug fixes, documentation updates, internal changes
- **minor**: New features, non-breaking enhancements
- **major**: Breaking changes, API modifications

## Release Workflow

1. Accumulated changesets are versioned: `bun changeset:version`
2. Review the CHANGELOG.md updates
3. Bump and tag: `bun bump`
4. Push: `git push --follow-tags`
5. Create GitHub Release to trigger npm publish

## Skipping Changesets

Not all changes need changesets:
- CI/tooling changes
- Documentation-only changes
- Test-only changes
