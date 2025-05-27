import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import cron from 'node-cron';
import dotenv from 'dotenv';

import authRoute from './routes/authRoute.js';
import stationRoute from './routes/stationRoute.js';
import camRoute from './routes/camRoute.js';

import logger from './helpers/log.js';
import { removeOldImages, webcamWrapper } from './services/camService.js';
import { stationWrapper, checkForErrors } from './services/stationService.js';

const app = express();
app.use(cors({ origin: [/zephyrapp\.nz$/, /^http(s)?:\/\/localhost:\d{4}.*$/] }));
app.use(express.json());
dotenv.config();

// static files are served by caddy in prod
if (process.env.NODE_ENV !== 'production') {
  app.use(express.static('public'));
}

mongoose.connect(
  process.env.NODE_ENV === 'production'
    ? process.env.DB_CONNECTION_STRING
    : process.env.DEV_CONNECTION_STRING
);

// routes
app.use('/auth', authRoute);
app.use('/stations', stationRoute);
app.use('/cams', camRoute);

// cron jobs
// webcams
cron.schedule('*/10 * * * *', async () => {
  logger.info('--- Update webcams start ---', { service: 'cam' });
  const ts = Date.now();
  await webcamWrapper();
  logger.info(`Update webcams end - ${Date.now() - ts}ms elapsed.`, { service: 'cam' });
});

// stations
cron.schedule('*/10 * * * *', async () => {
  logger.info('--- Update stations start ---', { service: 'station' });
  const ts = Date.now();
  await stationWrapper();
  logger.info(`Update stations end - ${Date.now() - ts}ms elapsed.`, {
    service: 'station'
  });
});

// errors
cron.schedule('0 */6 * * *', async () => {
  logger.info('--- Check errors start ---', { service: 'errors' });
  const ts = Date.now();
  await checkForErrors();
  logger.info(`Check errors end - ${Date.now() - ts}ms elapsed.`, { service: 'errors' });
});

// cleanup
cron.schedule('0 0 * * *', async () => {
  logger.info('--- Remove old images start ---', { service: 'cleanup' });
  const ts = Date.now();
  await removeOldImages();
  logger.info(`Remove old images end - ${Date.now() - ts}ms elapsed.`, { service: 'cleanup' });
});

const port = process.env.NODE_PORT || 5000;
app.listen(port, () => logger.info(`Server running on port ${port}`));
