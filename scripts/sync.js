import {ALL_REPOSITORIES} from './shared/constants.js';
import {
  fail,
  getRepositoryDirectory,
  isGitRepository,
  printSection,
  requireCommand,
  runGit
} from './shared/runtime.js';

const printUsage = () => {
  console.log('Usage: node scripts/sync.js');
};

const getOutput = (directory, args) => {
  const result = runGit(directory, args, true);
  return result.status === 0 ? result.stdout.trim() : null;
};

const getStashHead = directory => getOutput(directory, ['rev-parse', '--verify', 'refs/stash']);

const restoreStash = (directory, name, expectedStash) => {
  const currentStash = getStashHead(directory);
  if (currentStash !== expectedStash) {
    console.error(`${name}: stash order changed unexpectedly; changes remain safely stashed.`);
    return false;
  }

  const popResult = runGit(directory, ['stash', 'pop', '--index', 'stash@{0}']);
  if (popResult.status !== 0) {
    console.error(`${name}: stash restoration needs manual conflict resolution.`);
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

requireCommand('git');

let available = 0;
let synchronized = 0;
let stashed = 0;
let restored = 0;
let failures = 0;

for (const name of ALL_REPOSITORIES) {
  const directory = getRepositoryDirectory(name);
  if (!isGitRepository(directory)) {
    console.log(`Skipping ${name}: repository is not installed.`);
    continue;
  }

  available++;
  const branch = getOutput(directory, ['branch', '--show-current']);
  if (!branch) {
    failures++;
    console.error(`${name}: cannot sync a detached HEAD.`);
    continue;
  }

  const statusResult = runGit(
    directory,
    ['status', '--porcelain', '--untracked-files=normal'],
    true
  );
  if (statusResult.status !== 0) {
    failures++;
    console.error(`${name}: could not inspect working tree changes.`);
    continue;
  }

  const hasChanges = statusResult.stdout.length > 0;
  let createdStash = null;
  if (hasChanges) {
    printSection(`Stashing ${name}`);
    const previousStash = getStashHead(directory);
    const stashResult = runGit(directory, [
      'stash',
      'push',
      '--include-untracked',
      '--message',
      `dev-scripts sync ${new Date().toISOString()}`
    ]);
    createdStash = getStashHead(directory);

    if (stashResult.status !== 0 || !createdStash || createdStash === previousStash) {
      failures++;
      console.error(`${name}: could not safely stash all working tree changes.`);
      continue;
    }
    stashed++;

    const remainingChanges = runGit(
      directory,
      ['status', '--porcelain', '--untracked-files=normal'],
      true
    );
    if (remainingChanges.status !== 0 || remainingChanges.stdout.length > 0) {
      failures++;
      console.error(`${name}: some working tree changes could not be stashed safely.`);
      printSection(`Restoring ${name}`);
      if (restoreStash(directory, name, createdStash)) {
        restored++;
      } else {
        failures++;
      }
      continue;
    }
  }

  const upstream = getOutput(
    directory,
    ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']
  );
  const pullArgs = upstream ?
    ['pull', '--ff-only'] :
    ['pull', '--ff-only', 'origin', branch];

  printSection(`Synchronizing ${name}/${branch}`);
  const pullSucceeded = runGit(directory, pullArgs).status === 0;
  if (pullSucceeded) {
    synchronized++;
  } else {
    failures++;
    console.error(`${name}: fast-forward synchronization failed.`);
  }

  if (createdStash) {
    printSection(`Restoring ${name}`);
    if (restoreStash(directory, name, createdStash)) {
      restored++;
    } else {
      failures++;
    }
  }
}

if (available === 0) fail('No NitroBolt repositories are installed next to dev-scripts.');

printSection('Synchronization complete');
console.log(
  `${available} repositories, ${synchronized} synchronized, ` +
  `${stashed} stashed, ${restored} restored, ${failures} errors.`
);
if (failures > 0) process.exit(1);
