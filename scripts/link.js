import fs from 'node:fs';
import path from 'node:path';
import {
  GUI_DEPENDENCIES,
  GUI_REPOSITORIES,
  LINKABLE_REPOSITORIES
} from './shared/constants.js';
import {
  fail,
  getRepositoryDirectory,
  isGitRepository,
  printSection,
  requireCommand,
  run
} from './shared/runtime.js';

const failures = [];

const printUsage = () => {
  console.log('Usage: node scripts/link.js');
};

const discoverRepositories = () => {
  const repositories = [];

  for (const name of GUI_REPOSITORIES) {
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

    repositories.push({name, directory});
  }

  return repositories;
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
    try {
      if (snapshot.existed) {
        const unchanged = fs.existsSync(snapshot.file) &&
          fs.readFileSync(snapshot.file).equals(snapshot.contents);
        if (!unchanged) fs.writeFileSync(snapshot.file, snapshot.contents);
      } else if (fs.existsSync(snapshot.file)) {
        fs.rmSync(snapshot.file);
      }
    } catch (error) {
      failures.push(`Could not restore ${snapshot.file} (${error.message})`);
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

const argumentsList = process.argv.slice(2);
if (argumentsList.includes('--help')) {
  printUsage();
  process.exit(0);
}
if (argumentsList.length > 0) {
  printUsage();
  fail(`Unknown argument: ${argumentsList[0]}`);
}

const repositories = discoverRepositories();
const findRepository = name => repositories.find(repository => repository.name === name);
const linkableRepositories = [];

for (const name of LINKABLE_REPOSITORIES) {
  const repository = findRepository(name);
  if (repository) linkableRepositories.push(repository);
}

if (linkableRepositories.length === 0) {
  printSection('Linking complete');
  console.log('No linkable NitroBolt repositories are installed.');
  process.exit(0);
}

requireCommand('pnpm');

let snapshots;
try {
  snapshots = snapshotManifests(repositories);
} catch (error) {
  fail(`Could not preserve repository manifests: ${error.message}`);
}

try {
  const linkedRepositories = [];

  for (const repository of linkableRepositories) {
    if (runPnpmLink(repository)) linkedRepositories.push(repository.name);
  }

  const vm = findRepository('scratch-vm');
  if (linkedRepositories.includes('scratch-parser') && linkedRepositories.includes('scratch-vm')) {
    runPnpmLink(vm, ['scratch-parser']);
  } else {
    console.log('Skipping scratch-parser -> scratch-vm link: both packages must be registered successfully.');
  }

  const gui = findRepository('scratch-gui');
  if (gui) {
    const guiDependencies = GUI_DEPENDENCIES.filter(name => linkedRepositories.includes(name));
    if (guiDependencies.length > 0) {
      runPnpmLink(gui, guiDependencies);
    } else {
      console.log('Skipping GUI dependency links: no dependencies were linked successfully.');
    }
  } else {
    console.log('Skipping GUI dependency links: scratch-gui is not installed.');
  }
} finally {
  restoreManifests(snapshots);
}

if (failures.length > 0) {
  printSection('Completed with errors');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

printSection('Linking complete');
