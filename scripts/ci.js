import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {
  ALL_REPOSITORIES,
  BASE_BRANCHES,
  GUI_REPOSITORIES,
  NPM_REPOSITORIES
} from './shared/constants.js';
import {
  getRepositoryDirectory,
  hasGitRef,
  isGitRepository,
  printSection,
  requireCommand,
  run,
  runGit
} from './shared/runtime.js';

const failures = [];

const findDefaultBranch = repository => {
  const remoteHead = runGit(
    repository.directory,
    ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
    true
  );

  if (remoteHead.status === 0) {
    return remoteHead.stdout.trim().replace(/^origin\//, '');
  }

  for (const branch of BASE_BRANCHES) {
    if (
      hasGitRef(repository.directory, `refs/heads/${branch}`) ||
      hasGitRef(repository.directory, `refs/remotes/origin/${branch}`)
    ) {
      return branch;
    }
  }

  return null;
};

const discoverRepositories = names => {
  const repositories = [];

  for (const name of names) {
    const directory = getRepositoryDirectory(name);
    if (!fs.existsSync(directory)) {
      console.log(`Skipping ${name}: repository is not installed.`);
      continue;
    }

    if (!isGitRepository(directory)) {
      console.log(`Skipping ${name}: directory is not a Git repository.`);
      continue;
    }

    if (!fs.existsSync(path.join(directory, 'package.json'))) {
      console.log(`Skipping ${name}: package.json is missing.`);
      continue;
    }

    repositories.push({name, directory, ready: true});
  }

  return repositories;
};

const removeNodeModules = repository => {
  const nodeModules = path.join(repository.directory, 'node_modules');
  printSection(`Removing node_modules from ${repository.name}`);

  try {
    fs.rmSync(nodeModules, {recursive: true, force: true, maxRetries: 3});
  } catch (error) {
    repository.ready = false;
    failures.push(`${repository.name}: could not remove node_modules (${error.message})`);
  }
};

const checkoutDefaultBranch = repository => {
  const branch = findDefaultBranch(repository);
  if (!branch) {
    repository.ready = false;
    failures.push(`${repository.name}: could not determine the default branch`);
    return;
  }

  printSection(`Checking out ${repository.name}/${branch}`);
  const result = runGit(repository.directory, ['checkout', branch]);
  if (result.status !== 0) {
    repository.ready = false;
    failures.push(`${repository.name}: could not check out ${branch}`);
  }
};

const installRepository = repository => {
  if (!repository.ready) {
    console.log(`Skipping install for ${repository.name} because preparation failed.`);
    return;
  }

  const usesNpm = NPM_REPOSITORIES.includes(repository.name);
  const command = usesNpm ? 'npm' : 'pnpm';
  const args = usesNpm ?
    ['ci', '--loglevel=error', '--no-audit', '--no-fund', '--progress=false'] :
    ['install', '--frozen-lockfile'];
  printSection(`Installing ${repository.name} with ${command}`);
  const result = run(command, args, repository.directory);
  if (result.status !== 0) {
    failures.push(`${repository.name}: ${command} ${args.join(' ')} failed`);
  }
};

const printUsage = () => {
  console.log('Usage: node scripts/ci.js <full|gui> [--preserve-branch] [--no-link]');
};

const argumentsList = process.argv.slice(2);
if (argumentsList.includes('--help')) {
  printUsage();
  process.exit(0);
}

const [mode, ...flags] = argumentsList;
const unknownFlags = flags.filter(flag => !['--preserve-branch', '--no-link'].includes(flag));
const preserveBranchCount = flags.filter(flag => flag === '--preserve-branch').length;
const noLinkCount = flags.filter(flag => flag === '--no-link').length;
if (
  !['full', 'gui'].includes(mode) ||
  unknownFlags.length > 0 ||
  preserveBranchCount > 1 ||
  noLinkCount > 1
) {
  printUsage();
  if (preserveBranchCount > 1) console.error('--preserve-branch can only be provided once.');
  if (noLinkCount > 1) console.error('--no-link can only be provided once.');
  process.exit(2);
}

const preserveBranch = flags.includes('--preserve-branch');
const noLink = flags.includes('--no-link');
const repositoryNames = mode === 'full' ? ALL_REPOSITORIES : GUI_REPOSITORIES;
const repositories = discoverRepositories(repositoryNames);

if (repositories.length === 0) {
  console.error('No recognized NitroBolt repositories were found next to dev-scripts.');
  process.exit(1);
}

if (!preserveBranch) requireCommand('git');
if (repositories.some(repository => NPM_REPOSITORIES.includes(repository.name))) {
  requireCommand('npm');
}
if (repositories.some(repository => !NPM_REPOSITORIES.includes(repository.name))) {
  requireCommand('pnpm');
}

for (const repository of repositories) removeNodeModules(repository);
if (preserveBranch) {
  printSection('Preserving current branches');
} else {
  for (const repository of repositories) checkoutDefaultBranch(repository);
}
for (const repository of repositories) installRepository(repository);

if (noLink) {
  printSection('Skipping repository links');
} else {
  printSection('Linking repositories');
  const linkScript = fileURLToPath(new URL('./link.js', import.meta.url));
  if (run(process.execPath, [linkScript]).status !== 0) {
    failures.push('Repository linking failed');
  }
}

if (failures.length > 0) {
  printSection('Completed with errors');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

printSection('Clean install complete');
