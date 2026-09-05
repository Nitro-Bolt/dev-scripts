import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const sharedDirectory = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(sharedDirectory, '..', '..', '..');

const getRepositoryDirectory = name => path.join(workspaceDirectory, name);

const isGitRepository = directory => fs.existsSync(path.join(directory, '.git'));

const printSection = message => {
  process.stdout.write(`\n=== ${message} ===\n`);
};

const fail = message => {
  console.error(message);
  process.exit(1);
};

const parseOptions = (args, optionNames, printUsage) => {
  const options = {};

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];
    if (argument === '--help') {
      printUsage();
      process.exit(0);
    }

    const equalsIndex = argument.indexOf('=');
    const flag = equalsIndex === -1 ? argument : argument.slice(0, equalsIndex);
    const name = flag.slice(2);
    if (!flag.startsWith('--') || !optionNames.includes(name)) {
      printUsage();
      fail(`Unknown argument: ${argument}`);
    }
    if (options[name] !== undefined) fail(`${flag} can only be provided once.`);
    if (equalsIndex === -1 && (index + 1 >= args.length || args[index + 1].startsWith('--'))) {
      fail(`${flag} requires a value.`);
    }

    const value = equalsIndex === -1 ? args[++index] : argument.slice(equalsIndex + 1);
    if (!value?.trim()) fail(`${flag} requires a value.`);
    options[name] = value.trim();
  }

  return options;
};

const run = (command, args, cwd = workspaceDirectory, captureOutput = false) =>
  spawnSync(command, args, {
    cwd,
    encoding: captureOutput ? 'utf8' : undefined,
    shell: process.platform === 'win32' && ['npm', 'pnpm'].includes(command),
    stdio: captureOutput ? ['ignore', 'pipe', 'pipe'] : 'inherit'
  });

const requireCommand = command => {
  const result = run(command, ['--version'], workspaceDirectory, true);
  if (result.status !== 0) {
    const reason = result.error?.message || result.stderr?.trim() || `exit code ${result.status}`;
    fail(`Cannot run ${command}: ${reason}`);
  }
};

const runGit = (directory, args, captureOutput = false) => run(
  'git',
  ['-c', `safe.directory=${directory}`, '-C', directory, ...args],
  workspaceDirectory,
  captureOutput
);

const hasGitRef = (directory, ref) => runGit(
  directory,
  ['show-ref', '--verify', '--quiet', ref],
  true
).status === 0;

export {
  fail,
  getRepositoryDirectory,
  hasGitRef,
  isGitRepository,
  parseOptions,
  printSection,
  requireCommand,
  run,
  runGit
};
