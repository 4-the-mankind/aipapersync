'use strict';

// Usage:
//   npm test                                  — mocks only
//   npm test -- http://192.168.0.69:8090     — mocks + live tablet API tests

const { spawnSync } = require('child_process');

const env = { ...process.env };
const tabletUrl = process.argv[2];
if (tabletUrl) env.TABLET_URL = tabletUrl;

const result = spawnSync(
  'npx',
  ['jest', '--runInBand', '--verbose', '--detectOpenHandles'],
  { stdio: 'inherit', env, shell: true }
);
process.exit(result.status ?? 1);
