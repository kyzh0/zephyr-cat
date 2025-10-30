import pLimit from 'p-limit';
import httpClient from '../../../lib/httpClient.js';
import processScrapedData from '../processScrapedData.js';
import logger from '../../../lib/logger.js';

export default async function scrapeWeatherlinkData(stations) {
  const limit = pLimit(5);

  await Promise.allSettled(
    stations.map((station) =>
      limit(async () => {
        try {
          let windAverage = null;
          const windGust = null;
          let windBearing = null;
          let temperature = null;

          const { data } = await httpClient.get(
            `https://www.weatherlink.com/embeddablePage/getData/${station.externalId}`
          );
          if (data) {
            windAverage = data.wind;
            windBearing = data.windDirection;
            temperature = data.temperature;
          }

          await processScrapedData(station, windAverage, windGust, windBearing, temperature);
        } catch (error) {
          logger.warn(`weatherlink error - ${station.externalId}`, {
            service: 'station',
            type: 'weatherlink'
          });

          await processScrapedData(station, null, null, null, null, true);
        }
      })
    )
  );
}
