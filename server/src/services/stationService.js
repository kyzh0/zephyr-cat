import axios from 'axios';
import { parse } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import iconv from 'iconv-lite';

import logger from '../helpers/log.js';

import { Station } from '../models/stationModel.js';

function getFlooredTime() {
  // floor data timestamp to 10 min
  let date = new Date();
  let rem = date.getMinutes() % 10;
  if (rem > 0) {
    date = new Date(date.getTime() - rem * 60 * 1000);
  }
  rem = date.getSeconds() % 60;
  if (rem > 0) {
    date = new Date(date.getTime() - rem * 1000);
  }
  date = new Date(Math.floor(date.getTime() / 1000) * 1000);
  return date;
}

function getWindBearingFromDirection(direction) {
  if (!direction) {
    return 0;
  }
  switch (direction.trim().toUpperCase()) {
    case 'N':
      return 0;
    case 'NNE':
      return 22.5;
    case 'NE':
      return 45;
    case 'ENE':
      return 67.5;
    case 'E':
      return 90;
    case 'ESE':
      return 112.5;
    case 'SE':
      return 135;
    case 'SSE':
      return 157.5;
    case 'S':
      return 180;
    case 'SSO':
      return 202.5;
    case 'SO':
      return 225;
    case 'OSO':
      return 247.5;
    case 'O':
      return 270;
    case 'ONO':
      return 292.5;
    case 'NO':
      return 325;
    case 'NNO':
      return 337.5;
    default:
      return 0;
  }
}

async function getMeteoclimaticData(stationId) {
  let windAverage = null;
  const windGust = null;
  let windBearing = null;
  let temperature = null;

  try {
    const response = await axios.request({
      method: 'GET',
      url: `https://www.meteoclimatic.net/perfil/${stationId}`,
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
          lastUpdate = fromZonedTime(parse(timeString, 'dd-MM-yyyy HH:mm', new Date()), 'UTC');
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
  } catch (error) {
    logger.warn(`An error occured while fetching data for meteocat - ${stationId}`, {
      service: 'station',
      type: 'other'
    });
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function getMeteoCatData(stationId) {
  let windAverage = null;
  let windGust = null;
  let windBearing = null;
  let temperature = null;

  try {
    const { data } = await axios.get(
      `https://www.meteo.cat/observacions/xema/dades?codi=${stationId}`,
      {
        headers: {
          Connection: 'keep-alive'
        }
      }
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
          const latestTime = data.slice(i, j).replace(startStr, '').replace(/\s/g, '').slice(-5);
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
                const values = cellData.replaceAll('<td>', '').replace(/\s/g, '').split('</td>');

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
  } catch (error) {
    logger.warn(`An error occured while fetching data for meteocat - ${stationId}`, {
      service: 'station',
      type: 'other'
    });
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function getWeatherLinkData(stationId) {
  let windAverage = null;
  const windGust = null;
  let windBearing = null;
  let temperature = null;

  try {
    const { data } = await axios.get(
      `https://www.weatherlink.com/embeddablePage/getData/${stationId}`,
      {
        headers: {
          Connection: 'keep-alive'
        }
      }
    );

    if (data) {
      windAverage = data.wind;
      windBearing = data.windDirection;
      temperature = data.temperature;
    }
  } catch (error) {
    logger.warn(`An error occured while fetching data for weatherlink - ${stationId}`, {
      service: 'station',
      type: 'other'
    });
  }

  return {
    windAverage,
    windGust,
    windBearing,
    temperature
  };
}

async function saveData(station, data, date) {
  // handle likely erroneous values
  let avg = data.windAverage;
  if (isNaN(avg) || avg < 0 || avg > 500) {
    avg = null;
  }
  let gust = data.windGust;
  if (isNaN(gust) || gust < 0 || gust > 500) {
    gust = null;
  }
  let bearing = data.windBearing;
  if (isNaN(bearing) || bearing < 0 || bearing > 360) {
    bearing = null;
  }
  let temperature = data.temperature;
  if (isNaN(temperature) || temperature < -40 || temperature > 60) {
    temperature = null;
  }

  // update station
  station.lastUpdate = new Date();
  station.currentAverage = avg ?? null;
  station.currentGust = gust ?? null;
  station.currentBearing = bearing ?? null;
  station.currentTemperature = temperature ?? null;

  if (avg != null || gust != null) {
    station.isOffline = false;
  }
  if (avg != null && gust != null && bearing != null && temperature != null) {
    station.isError = false;
  }
  await station.save();

  // add data
  await Station.updateOne(
    { _id: station._id },
    {
      $push: {
        data: {
          time: date,
          windAverage: avg ?? null,
          windGust: gust ?? null,
          windBearing: bearing ?? null,
          temperature: temperature ?? null
        }
      }
    }
  );
}

export async function stationWrapper() {
  try {
    const stations = await Station.find({}, { data: 0 });
    if (!stations.length) {
      logger.error(`No stations found.`, {
        service: 'station'
      });
      return null;
    }

    const date = getFlooredTime();
    for (const s of stations) {
      let data = null;
      if (s.type === 'meteoclimatic') {
        data = await getMeteoclimaticData(s.externalId);
      } else if (s.type === 'meteocat') {
        data = await getMeteoCatData(s.externalId);
      } else if (s.type === 'weatherlink') {
        data = await getWeatherLinkData(s.externalId);
      }

      if (data) {
        logger.info(`${s.type} data updated${s.externalId ? ` - ${s.externalId}` : ''}`, {
          service: 'station',
          type: s.type
        });
        logger.info(JSON.stringify(data), { service: 'station', type: s.type });
        await saveData(s, data, date);
      }
    }
  } catch (error) {
    logger.error(`An error occurred while fetching station data`, {
      service: 'station'
    });
    logger.error(error, { service: 'station' });
    return null;
  }
}

function groupBy(xs, key) {
  return xs.reduce(function (rv, x) {
    (rv[x[key]] = rv[x[key]] || []).push(x);
    return rv;
  }, {});
}
export async function checkForErrors() {
  try {
    const stations = await Station.find(
      {},
      {
        _id: 1,
        type: 1,
        name: 1,
        externalLink: 1,
        isOffline: 1,
        isError: 1,
        data: {
          $slice: [
            {
              $sortArray: { input: '$data', sortBy: { time: -1 } }
            },
            36 // last 6h
          ]
        }
      }
    );
    if (!stations.length) {
      logger.error('No stations found.', { service: 'errors' });
      return null;
    }

    const errors = [];
    const timeNow = Date.now();

    for (const s of stations) {
      let isDataError = true;
      let isWindError = true;
      let isBearingError = true;
      let isTempError = true;

      // check last 6h data
      const data = s.data.filter((x) => new Date(x.time) >= new Date(timeNow - 6 * 60 * 60 * 1000));

      if (data.length) {
        data.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()); // time desc

        // check that data exists up to 20min before current time
        if (timeNow - new Date(data[0].time).getTime() <= 20 * 60 * 1000) {
          isDataError = false;
          for (const d of data) {
            if (d.windAverage != null || d.windGust != null) {
              isWindError = false;
            }
            if (d.windBearing != null) {
              isBearingError = false;
            }
            if (d.temperature != null) {
              isTempError = false;
            }
          }
        }
      }

      let errorMsg = '';
      if (isDataError) {
        errorMsg = 'ERROR: Data scraper has stopped.\n';
      } else if (isWindError) {
        errorMsg += 'ERROR: No wind avg/gust data.\n';
      }

      if (isDataError || isWindError) {
        if (!s.isOffline) {
          s.isOffline = true;
          await s.save();
          errors.push({
            type: s.type,
            msg: `${errorMsg}Name: ${s.name}\nURL: ${s.externalLink}\nDatabase ID: ${s._id}\n`
          });
        }
      }

      if (isDataError || isWindError || isBearingError || isTempError) {
        if (!s.isError) {
          s.isError = true;
          await s.save();
        }
      }
    }

    if (errors.length) {
      // send email if >2 stations of the same type went offline simultaneously
      let msg = '';
      const g = groupBy(errors, 'type');
      const singleStations = ['lpc'];
      for (const [key, value] of Object.entries(g)) {
        if (singleStations.includes(key) || value.length > 2) {
          msg += `\n${key.toUpperCase()}\n\n`;
          msg += value.map((x) => x.msg).join('\n');
        }
      }
      if (msg.length) {
        // await axios.post(`https://api.emailjs.com/api/v1.0/email/send`, {
        //   service_id: process.env.EMAILJS_SERVICE_ID,
        //   template_id: process.env.EMAILJS_TEMPLATE_ID,
        //   user_id: process.env.EMAILJS_PUBLIC_KEY,
        //   template_params: {
        //     message: `Scheduled check ran successfully at ${new Date().toISOString()}\n${msg}`
        //   },
        //   accessToken: process.env.EMAILJS_PRIVATE_KEY
        // });
      }
    }

    logger.info(`Checked for errors - ${errors.length} stations newly offline.`, {
      service: 'errors'
    });
  } catch (error) {
    logger.error('An error occurred while checking for station errors', { service: 'errors' });
    logger.error(error, { service: 'errors' });
    return null;
  }
}

export async function removeOldData() {
  try {
    const stations = await Station.find({});
    if (!stations.length) {
      logger.error('No stations found.', { service: 'cleanup' });
      return null;
    }

    const cutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000); // 7 days
    for (const s of stations) {
      await Station.updateOne({ _id: s._id }, { $pull: { data: { time: { $lte: cutoff } } } });
    }
  } catch (error) {
    logger.error('An error occurred while removing old data', { service: 'cleanup' });
    logger.error(error, { service: 'cleanup' });
    return null;
  }
}
