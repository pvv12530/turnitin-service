require('dotenv').config();

const app = require('./app');
const config = require('./config');
const { startEssayUploadPoller } = require('./services/essayUploadPoller');

const PORT = process.env.PORT || config.port;

const server = app.listen(PORT, () => {
  console.log('server is running on port', server.address().port);
  startEssayUploadPoller({ intervalMs: config.essayPollerIntervalMs });
});
