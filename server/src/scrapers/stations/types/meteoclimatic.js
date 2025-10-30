import pLimit from 'p-limit';
import axios from 'axios';
import { parse } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import iconv from 'iconv-lite';
import processScrapedData from '../processScrapedData.js';
import { getWindBearingFromDirection } from '../../../lib/utils.js';
import logger from '../../../lib/logger.js';

export default async function scrapeMeteoclimaticData(stations) {
  const limit = pLimit(5);

  await Promise.allSettled(
    stations.map((station) =>
      limit(async () => {
        try {
          let windAverage = null;
          const windGust = null;
          let windBearing = null;
          let temperature = null;

          const response = await axios.request({
            method: 'GET',
            url: `https://www.meteoclimatic.net/perfil/${station.externalId}`,
            responseType: 'arraybuffer',
            responseEncoding: 'binary'
          });
          const data = iconv.decode(response.data, 'ISO-8859-15'); // encoded in iso8859-15
          if (data.length) {
            let lastUpdate = new Date();
            let startStr = 'EL TIEMPO ACTUAL Última actualización';
            let i = data.indexOf(startStr);
            if (i >= 0) {
              const j = data.indexOf('UTC', i + startStr.length);
              if (j > i) {
                const timeString = data.slice(i + startStr.length, j).trim();
                lastUpdate = fromZonedTime(
                  parse(timeString, 'dd-MM-yyyy HH:mm', new Date()),
                  'UTC'
                );
              }
            }

            // update if <40 mins
            if (Date.now() - lastUpdate.getTime() < 40 * 60 * 1000) {
              // temperature
              startStr = 'class="dadesactuals">';
              i = data.indexOf(startStr);
              if (i > 0) {
                const j = data.indexOf('ºC</td>', i + startStr.length);
                if (j > i) {
                  temperature = Number(data.slice(i + startStr.length, j).trim());
                }
              }

              // wind avg + direction
              i = data.indexOf(startStr, i + startStr.length); // skip next occurence
              i = data.indexOf(startStr, i + startStr.length);
              if (i > 0) {
                // direction
                const startStr1 = '&nbsp;&nbsp;';
                const j = data.indexOf(startStr1, i + startStr.length);
                if (j > i) {
                  const direction = data.slice(i + startStr.length, j).trim();
                  windBearing = getWindBearingFromDirection(direction);
                }
                // avg
                const k = data.indexOf('km/h', j + startStr1.length);
                if (k > j) {
                  windAverage = Number(data.slice(j + startStr1.length, k).trim());
                }
              }
            }
          }

          await processScrapedData(station, windAverage, windGust, windBearing, temperature);
        } catch (error) {
          logger.warn(`meteoclimatic error - ${station.externalId}`, {
            service: 'station',
            type: 'meteoclimatic'
          });

          await processScrapedData(station, null, null, null, null, true);
        }
      })
    )
  );
}
