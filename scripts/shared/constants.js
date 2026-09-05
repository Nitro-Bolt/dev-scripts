const LINKABLE_REPOSITORIES = [
  'scratch-vm',
  'scratch-blocks',
  'scratch-paint',
  'scratch-render',
  'scratch-parser'
];

const GUI_REPOSITORIES = ['scratch-gui', ...LINKABLE_REPOSITORIES];

const GUI_DEPENDENCIES = LINKABLE_REPOSITORIES.filter(name => name !== 'scratch-parser');

const ALL_REPOSITORIES = [
  ...GUI_REPOSITORIES,
  'scratch-storage',
  'desktop',
  'packager',
  'backend',
  'docs',
  'experiments',
  'extensions',
  'Nitron',
  'packs',
  'scratchblocks',
  'types'
];

const NPM_REPOSITORIES = [
  'Nitron',
  'scratch-storage',
  'scratchblocks'
];

const BASE_BRANCHES = [
  'main',
  'master',
  'develop'
];

export {
  ALL_REPOSITORIES,
  BASE_BRANCHES,
  GUI_DEPENDENCIES,
  GUI_REPOSITORIES,
  LINKABLE_REPOSITORIES,
  NPM_REPOSITORIES
};
