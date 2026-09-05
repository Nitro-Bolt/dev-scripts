import fs from 'node:fs';
import path from 'node:path';
import {
  ALL_REPOSITORIES,
  BASE_BRANCHES,
  GUI_DEPENDENCIES,
  GUI_REPOSITORIES,
  LINKABLE_REPOSITORIES,
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

    repositories.push({name, directory, installed: false, ready: true});
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
  if (result.status === 0) {
    repository.installed = true;
  } else {
    failures.push(`${repository.name}: ${command} ${args.join(' ')} failed`);
  }
};

const snapshotManifests = repositories => {
  const snapshots = [];

  for (const repository of repositories) {
    for (const filename of ['package.json', 'pnpm-lock.yaml']) {
      const file = path.join(repository.directory, filename);
      const existed = fs.existsSync(file);
      snapshots.push({
        file,
        existed,
        contents: existed ? fs.readFileSync(file) : null
      });
    }
  }

  return snapshots;
};

const restoreManifests = snapshots => {
  for (const snapshot of snapshots) {
    if (snapshot.existed) {
      const unchanged = fs.existsSync(snapshot.file) &&
        fs.readFileSync(snapshot.file).equals(snapshot.contents);
      if (!unchanged) fs.writeFileSync(snapshot.file, snapshot.contents);
    } else if (fs.existsSync(snapshot.file)) {
      fs.rmSync(snapshot.file);
    }
  }
};

const runPnpmLink = (repository, packageNames = []) => {
  const args = ['link', ...packageNames];
  const description = packageNames.length > 0 ?
    `${repository.name} to ${packageNames.join(', ')}` :
    repository.name;
  printSection(`Linking ${description}`);

  const result = run('pnpm', args, repository.directory);
  if (result.status !== 0) {
    failures.push(`${description}: pnpm link failed`);
    return false;
  }

  return true;
};

const linkGuiRepositories = repositories => {
  const findRepository = name => repositories.find(repository => repository.name === name);
  const involved = GUI_REPOSITORIES
    .map(findRepository)
    .filter(repository => repository && repository.installed);
  const snapshots = snapshotManifests(involved);

  try {
    const linkedRepositories = [];
    for (const name of LINKABLE_REPOSITORIES) {
      const repository = findRepository(name);
      if (!repository?.installed) {
        console.log(`Skipping pnpm link for ${name}: repository was not found or did not install successfully.`);
        continue;
      }

      if (runPnpmLink(repository)) linkedRepositories.push(name);
    }

    const vm = findRepository('scratch-vm');
    if (linkedRepositories.includes('scratch-parser') && linkedRepositories.includes('scratch-vm')) {
      runPnpmLink(vm, ['scratch-parser']);
    } else {
      console.log('Skipping scratch-parser -> scratch-vm link: both packages must be registered successfully.');
    }

    const gui = findRepository('scratch-gui');
    if (!gui?.installed) {
      console.log('Skipping GUI dependency links: scratch-gui did not install successfully.');
      return;
    }

    const guiDependencies = GUI_DEPENDENCIES.filter(name => linkedRepositories.includes(name));
    if (guiDependencies.length > 0) {
      runPnpmLink(gui, guiDependencies);
    } else {
      console.log('Skipping GUI dependency links: no dependencies were linked successfully.');
    }
  } finally {
    restoreManifests(snapshots);
  }
};

const printUsage = () => {
  console.log('Usage: node scripts/ci.js <full|gui> [--preserve-branch]');
};

const argumentsList = process.argv.slice(2);
if (argumentsList.includes('--help')) {
  printUsage();
  process.exit(0);
}

const [mode, ...flags] = argumentsList;
const unknownFlags = flags.filter(flag => flag !== '--preserve-branch');
const preserveBranchCount = flags.filter(flag => flag === '--preserve-branch').length;
if (!['full', 'gui'].includes(mode) || unknownFlags.length > 0 || preserveBranchCount > 1) {
  printUsage();
  if (preserveBranchCount > 1) console.error('--preserve-branch can only be provided once.');
  process.exit(2);
}

const preserveBranch = flags.includes('--preserve-branch');
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

linkGuiRepositories(repositories);

if (failures.length > 0) {
  printSection('Completed with errors');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

printSection('Clean install complete');
