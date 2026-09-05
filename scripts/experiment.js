import fs from 'node:fs';
import path from 'node:path';
import {BASE_BRANCHES} from './shared/constants.js';
import {
  fail,
  getRepositoryDirectory,
  isGitRepository,
  parseOptions,
  requireCommand,
  run,
  runGit
} from './shared/runtime.js';

const guiDirectory = getRepositoryDirectory('scratch-gui');
const experimentsDirectory = getRepositoryDirectory('experiments');
const experimentsStaticDirectory = path.join(experimentsDirectory, 'static');
const experimentsFile = path.join(experimentsDirectory, 'src', 'playground', 'experiments.json');

const printUsage = () => {
  console.log(
    'Usage: node scripts/experiment.js [--description <text>] [--status <text>]'
  );
};

const getExperimentId = branch => {
  const id = branch.replace(/[\\/]+/g, '-');
  const isWindowsReservedName = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(id);
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ||
    id.endsWith('.') ||
    isWindowsReservedName
  ) {
    fail(`The GUI branch name cannot be used as a cross-platform experiment folder: ${branch}`);
  }
  return id;
};

const getDisplayName = branch => branch
  .split('/')
  .at(-1)
  .split(/[-_.]+/)
  .filter(Boolean)
  .map(word => word.charAt(0).toUpperCase() + word.slice(1))
  .join(' ');

const assertRepository = (directory, name) => {
  if (!isGitRepository(directory)) {
    fail(`${name} must be installed next to dev-scripts.`);
  }
};

const replaceExperiment = (sourceDirectory, destinationDirectory, metadata) => {
  const destinationParent = path.dirname(destinationDirectory);
  if (destinationParent !== path.resolve(experimentsStaticDirectory)) {
    fail('Refusing to replace an experiment outside the experiments static directory.');
  }

  const suffix = `${process.pid}-${Date.now()}`;
  const temporaryDirectory = path.join(destinationParent, `.experiment-${suffix}`);
  const backupDirectory = path.join(destinationParent, `.experiment-backup-${suffix}`);
  const temporaryMetadata = `${experimentsFile}.${suffix}.tmp`;
  const backupMetadata = `${experimentsFile}.${suffix}.backup`;
  let backedUpDirectory = false;
  let backedUpMetadata = false;
  let installedDirectory = false;

  try {
    fs.cpSync(sourceDirectory, temporaryDirectory, {recursive: true, errorOnExist: true});
    fs.writeFileSync(temporaryMetadata, `${JSON.stringify(metadata, null, 2)}\n`);

    if (fs.existsSync(destinationDirectory)) {
      fs.renameSync(destinationDirectory, backupDirectory);
      backedUpDirectory = true;
    }

    fs.renameSync(experimentsFile, backupMetadata);
    backedUpMetadata = true;
    fs.renameSync(temporaryDirectory, destinationDirectory);
    installedDirectory = true;
    fs.renameSync(temporaryMetadata, experimentsFile);
  } catch (error) {
    if (installedDirectory && fs.existsSync(destinationDirectory)) {
      fs.rmSync(destinationDirectory, {recursive: true, force: true});
    }
    if (backedUpDirectory && fs.existsSync(backupDirectory)) {
      fs.renameSync(backupDirectory, destinationDirectory);
    }
    if (backedUpMetadata && fs.existsSync(backupMetadata)) {
      fs.renameSync(backupMetadata, experimentsFile);
    }
    throw error;
  } finally {
    if (fs.existsSync(temporaryDirectory)) {
      fs.rmSync(temporaryDirectory, {recursive: true, force: true});
    }
    if (fs.existsSync(temporaryMetadata)) fs.rmSync(temporaryMetadata, {force: true});
  }

  try {
    if (backedUpDirectory) fs.rmSync(backupDirectory, {recursive: true, force: true});
    fs.rmSync(backupMetadata, {force: true});
  } catch (error) {
    console.warn(`Experiment was updated, but a backup could not be removed: ${error.message}`);
  }
};

const options = parseOptions(process.argv.slice(2), ['description', 'status'], printUsage);
assertRepository(guiDirectory, 'scratch-gui');
assertRepository(experimentsDirectory, 'experiments');
requireCommand('git');
requireCommand('pnpm');

const branchResult = runGit(guiDirectory, ['branch', '--show-current'], true);
if (branchResult.status !== 0) fail('Could not determine the current scratch-gui branch.');

const branch = branchResult.stdout.trim();
if (!branch) fail('scratch-gui is in detached HEAD state. Check out a feature branch first.');
if (BASE_BRANCHES.includes(branch)) {
  fail(`Refusing to publish the scratch-gui base branch: ${branch}`);
}

const experimentId = getExperimentId(branch);
let experiments;
try {
  experiments = JSON.parse(fs.readFileSync(experimentsFile, 'utf8'));
} catch (error) {
  fail(`Could not read experiments.json: ${error.message}`);
}
if (!Array.isArray(experiments)) fail('experiments.json must contain an array.');

const existingIndex = experiments.findIndex(experiment => experiment.id === experimentId);
const existingExperiment = experiments[existingIndex];
const description = options.description || existingExperiment?.description;
const status = options.status || existingExperiment?.status;
if (!description) fail('--description is required when creating a new experiment.');
if (!status) fail('--status is required when creating a new experiment.');

const experiment = {
  id: experimentId,
  name: existingExperiment?.name || getDisplayName(branch),
  description,
  status
};

if (existingIndex === -1) {
  experiments.push(experiment);
} else {
  experiments[existingIndex] = experiment;
}

console.log(`Building scratch-gui branch ${branch}...`);
const buildResult = run('pnpm', ['run', 'build'], guiDirectory);
if (buildResult.status !== 0) fail('scratch-gui build failed.');

const buildDirectory = path.join(guiDirectory, 'build');
if (!fs.existsSync(path.join(buildDirectory, 'index.html'))) {
  fail('scratch-gui build did not produce build/index.html.');
}

const destinationDirectory = path.resolve(experimentsStaticDirectory, experimentId);
try {
  replaceExperiment(buildDirectory, destinationDirectory, experiments);
} catch (error) {
  fail(`Could not update the experiments repository: ${error.message}`);
}

console.log(`${existingExperiment ? 'Updated' : 'Created'} experiment ${experimentId}.`);
