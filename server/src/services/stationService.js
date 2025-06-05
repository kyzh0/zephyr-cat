import axios from 'axios';

import logger from '../helpers/log.js';

import { Station } from '../models/stationModel.js';

function getFlooredTime() {
  // floor data timestamp to 10 min
  let date = new Date();
  let rem = date.getMinutes() % 10;
  if (rem > 0) date = new Date(date.getTime() - rem * 60 * 1000);
  rem = date.getSeconds() % 60;
  if (rem > 0) date = new Date(date.getTime() - rem * 1000);
  date = new Date(Math.floor(date.getTime() / 1000) * 1000);
  return date;
}

// function getWindBearingFromDirection(direction) {
//   if (!direction) return 0;
//   switch (direction.trim().toUpperCase()) {
//     case 'N':
//       return 0;
//     case 'NNE':
//       return 22.5;
//     case 'NE':
//       return 45;
//     case 'ENE':
//       return 67.5;
//     case 'E':
//       return 90;
//     case 'ESE':
//       return 112.5;
//     case 'SE':
//       return 135;
//     case 'SSE':
//       return 157.5;
//     case 'S':
//       return 180;
//     case 'SSW':
//       return 202.5;
//     case 'SW':
//       return 225;
//     case 'WSW':
//       return 247.5;
//     case 'W':
//       return 270;
//     case 'WNW':
//       return 292.5;
//     case 'NW':
//       return 325;
//     case 'NNW':
//       return 337.5;
//     default:
//       return 0;
//   }
// }

async function getKrasonData() {
  const result = new Map();

  try {
    const { data } = await axios.get(
      `https://zephyr-data-provider.fermyon.app/api/v1/measurements?token=${process.env.KRASON_TOKEN}`
    );
    if (data && data.length) {
      for (const d of data) {
        let item = {
          windAverage: null,
          windGust: null,
          windBearing: null,
          temperature: null
        };
        if (d) {
          const lastUpdate = new Date(d.last_update);
          // only update if data < 40 mins old
          if (Date.now() - lastUpdate.getTime() < 40 * 60 * 1000) {
            item = {
              windAverage: d.wind_speed,
              windGust: d.gusts_speed,
              windBearing: d.wind_direction,
              temperature: d.temperature
            };
          }
        }
        result.set(d.station_id, item);
      }
    }
  } catch (error) {
    logger.warn('An error occured while fetching data for krason', {
      service: 'station',
      type: 'krason'
    });
  }

  return result;
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

      const startStr = '<th scope="row">';
      let i = data.lastIndexOf(startStr);
      if (i >= 0) {
        let j = data.indexOf('</th>', i + 16);
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

        if (dataAgeMinutes <= 40) {
          j = data.indexOf('</tr>', i + 16);
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

                if (values.length === 10) {
                  if (values[6] !== '(s/d)') windAverage = Number(values[6]);
                  if (values[8] !== '(s/d)') windGust = Number(values[8]);
                  if (values[7] !== '(s/d)') windBearing = Number(values[7]);
                  if (values[0] !== '(s/d)') temperature = Number(values[0]);
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

    const krasonData = await getKrasonData();

    const date = getFlooredTime();
    for (const s of stations) {
      let data = null;
      if (s.type === 'krason') {
        data = krasonData.get(s.externalId);
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
      const data = s.data.filter((x) => {
        return new Date(x.time) >= new Date(timeNow - 6 * 60 * 60 * 1000);
      });

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
