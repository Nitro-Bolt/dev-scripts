This repository contains scripts that make NitroBolt development easier.

These scripts assume all installed NitroBolt repositories are under the same folder as this repository like the following:

```
NitroBolt/
  dev-scripts/
  scratch-gui/
  scratch-vm/
  scratch-blocks/
  ...
```

Only recognized NitroBolt repositories that exist locally are used. Each CI command removes `node_modules`, checks out the repository's default branch unless branch preservation is enabled, and installs one repository at a time. `Nitron`, `scratch-storage`, and `scratchblocks` use `npm ci`. All other repositories use `pnpm install --frozen-lockfile`.

When the relevant repositories are available, the link command registers `scratch-vm`, `scratch-blocks`, `scratch-render`, `scratch-parser`, and `scratch-paint` with `pnpm link`. It then links `scratch-parser` into `scratch-vm` and links all available GUI dependencies with one combined command. Both CI commands run the link command automatically after installation.

```
scratch-parser -> scratch-vm
scratch-vm     -> scratch-gui
scratch-blocks -> scratch-gui
scratch-paint  -> scratch-gui
scratch-render -> scratch-gui
```

Any `package.json` and `pnpm-lock.yaml` changes made by `pnpm link` are reverted while the links themselves remain active. Existing contents of those files are preserved, including uncommitted changes.

## Commands

- `pnpm run full-ci` processes every locally available NitroBolt repository.
- `pnpm run gui-ci` processes only `scratch-gui`, `scratch-vm`, `scratch-blocks`, `scratch-paint`, `scratch-render`, and `scratch-parser`.
- `pnpm run link` links all locally available GUI repositories together.
- `pnpm run checkout` checks out a matching branch in every locally available NitroBolt repository that contains it.
- `pnpm run sync` safely synchronizes the current branch of every locally available NitroBolt repository.
- `pnpm run experiment` builds the current `scratch-gui` feature branch and publishes it to the local `experiments` repository.

## Cleaning and installing repositories

Run either CI command without flags to clean and install its repositories:

```sh
pnpm run full-ci
pnpm run gui-ci
```

By default, each repository is switched to its default branch before installation. The commands do not fetch, pull, discard changes, or delete untracked files. If Git cannot safely switch a repository to its default branch, that repository is skipped and the command reports the error at the end.

The optional `--preserve-branch` flag keeps every repository on its current branch:

```sh
pnpm run full-ci --preserve-branch
pnpm run gui-ci --preserve-branch
```

The optional `--no-link` flag skips automatic repository linking after installation:

```sh
pnpm run full-ci --no-link
pnpm run gui-ci --no-link
```

Both optional flags can be used together.

## Linking repositories

Run the link command without arguments to recreate links without reinstalling repositories:

```sh
pnpm run link
```

Only locally available repositories are used. The command preserves existing `package.json` and `pnpm-lock.yaml` contents while creating the links.

## Checking out a branch across repositories

Pass the branch to search for with `--branch`:

```sh
pnpm run checkout --branch feature-name
```

The command checks local branches and locally known `origin` branches. It does not fetch or pull. Repositories without the branch are skipped, and a checkout failure in one repository does not prevent the remaining repositories from being checked.

## Synchronizing repositories

Run the sync command without arguments:

```sh
pnpm run sync
```

Each installed repository is pulled from its current branch's upstream using fast-forward-only mode. If no upstream is configured but `origin` has a matching branch, that branch is pulled explicitly. Tracked and untracked changes are temporarily stashed and restored with their staged state. A failed pull still triggers restoration. Merge commits are never created automatically.

## Publishing an experiment

Run the experiment command from a feature branch in `scratch-gui`:

```sh
pnpm run experiment --description "Try the new editor feature" --status "Buggy"
```

The GUI branch name becomes the experiment ID and folder name. Slashes are replaced with hyphens for cross-platform paths. The display name is generated from the final branch segment. If the experiment already exists, its compiled files are replaced and its metadata entry is updated. Existing description and status values are reused when their flags are omitted.
