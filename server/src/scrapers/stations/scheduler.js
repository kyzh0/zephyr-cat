import cron from 'node-cron';
import { rerunScraper, runScraper } from './orchestrator.js';
import logger from '../../lib/logger.js';
import { checkForErrors } from '../../services/stationService.js';

export async function startStationScheduler() {
  logger.info('----- Initialising station scheduler -----', {
    service: 'station'
  });

  // stations
  cron.schedule('*/10 * * * *', async () => {
    logger.info('----- Starting station scraper -----', {
      service: 'station'
    });
    let ts = Date.now();
    await runScraper();
    logger.info(
      `----- Station scraper finished, ${Math.floor((Date.now() - ts) / 1000)}s elapsed -----`,
      {
        service: 'station'
      }
    );
  });

  // missed readings
  cron.schedule('3,13,23,33,43,53,6,16,26,36,46,56,35 * * * *', async () => {
    logger.info('----- Check missed readings start -----', { service: 'miss' });
    const ts = Date.now();
    await rerunScraper();
    logger.info(`--- Check missed readings end - ${Date.now() - ts}ms elapsed. -----`, {
      service: 'miss'
    });
  });

  // errors
  cron.schedule('5 */6 * * *', async () => {
    logger.info('----- Check errors start -----', { service: 'errors' });
    const ts = Date.now();
    await checkForErrors();
    logger.info(`--- Check errors end - ${Date.now() - ts}ms elapsed. -----`, {
      service: 'errors'
    });
  });
}
