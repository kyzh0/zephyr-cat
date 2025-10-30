import pLimit from 'p-limit';
import httpClient from '../../../lib/httpClient.js';
import processScrapedData from '../processScrapedData.js';
import logger from '../../../lib/logger.js';

export default async function scrapeMeteocatData(stations) {
  const limit = pLimit(5);

  await Promise.allSettled(
    stations.map((station) =>
      limit(async () => {
        try {
          let windAverage = null;
          let windGust = null;
          let windBearing = null;
          let temperature = null;

          const { data } = await httpClient.get(
            `https://www.meteo.cat/observacions/xema/dades?codi=${station.externalId}`
          );
          if (data.length) {
            let dataAgeMinutes = 0;

            // find col indices
            let avgIdx = -1;
            let gustIdx = -1;
            let dirIdx = -1;
            let tempIdx = -1;

            let startStr = '<caption>Dades de per&iacute;ode</caption>';
            let i = data.indexOf(startStr);
            if (i > 0) {
              const j = data.indexOf('</tr>', i + startStr.length);
              if (j > i) {
                const headerText = data
                  .slice(i + startStr.length, j)
                  .replace('<tr>', '')
                  .trim();
                const headers = headerText.split('</th>');
                for (let i = 1; i < headers.length; i++) {
                  const val = headers[i]; // skip 1st utc header
                  if (val.includes('Temperatura mitjana (&deg;C)')) {
                    tempIdx = i - 1;
                  } else if (val.includes('Velocitat mitjana del vent (km/h)')) {
                    avgIdx = i - 1;
                  } else if (val.includes('Direcci&oacute; mitjana del vent (graus)')) {
                    dirIdx = i - 1;
                  } else if (val.includes('Ratxa m&agrave;xima del vent (km/h)')) {
                    gustIdx = i - 1;
                  }
                }
              }
            }

            startStr = '<th scope="row">';
            i = data.lastIndexOf(startStr);
            if (i >= 0) {
              let j = data.indexOf('</th>', i + startStr.length);
              if (j > i) {
                const latestTime = data
                  .slice(i, j)
                  .replace(startStr, '')
                  .replace(/\s/g, '')
                  .slice(-5);
                const latestHour = Number(latestTime.slice(0, 2));
                const latestMinute = Number(latestTime.slice(-2));
                let currentHour = new Date().getUTCHours();
                const currentMinute = new Date().getUTCMinutes();
                // if current is next day
                if (latestHour > currentHour) {
                  currentHour += 24;
                }
                const hourDiff = currentHour - latestHour;
                const minuteDiff =
                  latestHour === currentHour
                    ? currentMinute - latestMinute
                    : 60 - latestMinute + currentMinute;
                dataAgeMinutes = hourDiff * 60 + minuteDiff;
              }

              // ignore old data
              if (dataAgeMinutes <= 40) {
                j = data.indexOf('</tr>', i + startStr.length);
                if (j > i) {
                  const lastRowData = data
                    .slice(i, j)
                    .replaceAll('<td class="trans">', '<td>')
                    .replaceAll('<em>', '')
                    .replaceAll('</em>', '');
                  i = lastRowData.indexOf('<td>');
                  if (i >= 0) {
                    j = lastRowData.lastIndexOf('</td>');
                    if (j > i) {
                      const cellData = lastRowData.slice(i, j);
                      const values = cellData
                        .replaceAll('<td>', '')
                        .replace(/\s/g, '')
                        .split('</td>');

                      if (avgIdx > -1 && values[avgIdx] !== '(s/d)') {
                        windAverage = Number(values[avgIdx]);
                      }
                      if (gustIdx > -1 && values[gustIdx] !== '(s/d)') {
                        windGust = Number(values[gustIdx]);
                      }
                      if (dirIdx > -1 && values[dirIdx] !== '(s/d)') {
                        windBearing = Number(values[dirIdx]);
                      }
                      if (tempIdx > -1 && values[tempIdx] !== '(s/d)') {
                        temperature = Number(values[tempIdx]);
                      }
                    }
                  }
                }
              }
            }
          }

          await processScrapedData(station, windAverage, windGust, windBearing, temperature);
        } catch (error) {
          logger.warn(`meteocat error - ${station.externalId}`, {
            service: 'station',
            type: 'meteocat'
          });

          await processScrapedData(station, null, null, null, null, true);
        }
      })
    )
  );
}
