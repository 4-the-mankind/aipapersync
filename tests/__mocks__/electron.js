'use strict';

const os   = require('os');
const path = require('path');

module.exports = {
  app: {
    getPath: (key) => path.join(os.tmpdir(), 'aipapersync-jest', key),
  },
};
