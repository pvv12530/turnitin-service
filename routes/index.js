const status = require('../src/health/routes');
// const validateAuth = require('../middlewares/validateAuth');
// const getData = require('../middlewares/getData');

module.exports = (app) => {
  app.use('/status', status);
  app.use('*', (req, res) => {
    res.send('Not found!!!');
  });
};
