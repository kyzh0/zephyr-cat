import mongoose from 'mongoose';
import dotenv from 'dotenv';
import logger from './lib/logger.js';

import { startStationScheduler } from './scrapers/stations/scheduler.js';

dotenv.config();

try {
  await mongoose.connect(process.env.DB_CONNECTION_STRING);

  await startStationScheduler();
} catch (error) {
  logger.error(error);
}
