import {ALL_REPOSITORIES} from './shared/constants.js';
import {
  fail,
  getRepositoryDirectory,
  hasGitRef,
  isGitRepository,
  parseOptions,
  printSection,
  requireCommand,
  run,
  runGit
} from './shared/runtime.js';

const printUsage = () => {
  console.log('Usage: node scripts/checkout.js --branch <name>');
};

const {branch} = parseOptions(process.argv.slice(2), ['branch'], printUsage);
if (!branch) {
  printUsage();
  fail('--branch is required.');
}
requireCommand('git');

const branchCheck = run('git', ['check-ref-format', '--branch', branch], undefined, true);
if (branchCheck.status !== 0) fail(`Invalid Git branch name: ${branch}`);

let matches = 0;
let changed = 0;
let failures = 0;

for (const name of ALL_REPOSITORIES) {
  const directory = getRepositoryDirectory(name);
  if (!isGitRepository(directory)) {
    console.log(`Skipping ${name}: repository is not installed.`);
    continue;
  }

  const localRef = `refs/heads/${branch}`;
  const remoteRef = `refs/remotes/origin/${branch}`;
  const hasLocalBranch = hasGitRef(directory, localRef);
  const hasRemoteBranch = hasGitRef(directory, remoteRef);
  if (!hasLocalBranch && !hasRemoteBranch) {
    console.log(`Skipping ${name}: branch not found.`);
    continue;
  }

  matches++;
  const currentBranch = runGit(directory, ['branch', '--show-current'], true);
  if (currentBranch.status === 0 && currentBranch.stdout.trim() === branch) {
    console.log(`${name}: already on ${branch}.`);
    continue;
  }

  printSection(`Checking out ${name}/${branch}`);
  const checkoutArgs = hasLocalBranch ?
    ['checkout', branch] :
    ['checkout', '-b', branch, '--track', `origin/${branch}`];
  const result = runGit(directory, checkoutArgs);
  if (result.status === 0) {
    changed++;
  } else {
    failures++;
    console.error(`${name}: could not check out ${branch}.`);
  }
}

if (matches === 0) fail(`No installed NitroBolt repository contains branch ${branch}.`);

printSection('Checkout complete');
console.log(`${matches} matching repositories, ${changed} changed, ${failures} failed.`);
if (failures > 0) process.exit(1);
