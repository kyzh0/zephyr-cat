import axios from 'axios';
import { parse } from 'date-fns';
import { fromZonedTime } from 'date-fns-tz';
import sharp from 'sharp';
import md5 from 'md5';
import fs from 'fs/promises';
import dir from 'node-dir';

import logger from '../helpers/log.js';

import { Cam } from '../models/camModel.js';

async function getLakeWanakaImage(id, lastUpdate) {
  let updated = null;
  let base64 = null;

  try {
    const { data } = await axios.get(`https://api.lakewanaka.co.nz/webcam/feed/${id}`, {
      headers: {
        Connection: 'keep-alive'
      }
    });
    const d = data.latest_image;
    if (d && d.timestamp) {
      updated = fromZonedTime(parse(d.timestamp, 'yyyy-MM-dd HH:mm:ss', new Date()), 'CET');
      // skip if image already up to date
      if (updated > lastUpdate && d.url) {
        const response = await axios.get(d.url, {
          responseType: 'arraybuffer',
          headers: {
            Connection: 'keep-alive'
          }
        });
        base64 = Buffer.from(response.data, 'binary').toString('base64');
      }
    }
  } catch (error) {
    logger.warn(`An error occured while fetching images for lake wanaka - ${id}`, {
      service: 'cam',
      type: 'lw'
    });
  }

  return {
    updated,
    base64
  };
}

async function getCamFtpImage(lastUpdate) {
  let updated = null;
  let base64 = null;

  try {
    const response = await axios.get(
      'https://cameraftpapi.drivehq.com/api/Camera/GetCameraThumbnail.ashx?shareID=16834851',
      {
        responseType: 'arraybuffer',
        headers: {
          Connection: 'keep-alive'
        }
      }
    );

    updated = new Date(response.headers['last-modified']);
    // skip if image already up to date
    if (updated > lastUpdate) {
      base64 = Buffer.from(response.data, 'binary').toString('base64');
    }
  } catch (error) {
    logger.warn('An error occured while fetching images for cameraftp', {
      service: 'cam',
      type: 'camftp'
    });
  }

  return {
    updated,
    base64
  };
}

async function getWanakaAirportImage(id) {
  let updated = null;
  let base64 = null;

  try {
    const dateTimeFormat = new Intl.DateTimeFormat('en-NZ', {
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
      timeZone: 'CET'
    });
    const parts = dateTimeFormat.formatToParts(new Date());

    let year = '';
    let month = '';
    let day = '';
    let hour = '';
    let minute = '';
    for (const p of parts) {
      switch (p.type) {
        case 'year':
          year = p.value;
          break;
        case 'month':
          month = p.value.padStart(2, '0');
          break;
        case 'day':
          day = p.value.padStart(2, '0');
          break;
        case 'hour':
          hour = p.value.padStart(2, '0');
          break;
        case 'minute':
          minute = p.value.padStart(2, '0');
          break;
      }
    }

    const response = await axios.get(
      `https://www.wanakaairport.com/WebCam/${id}.jpg?dt=${year}-${month}-${day}-${hour}-${minute}`,
      {
        responseType: 'arraybuffer',
        headers: {
          Connection: 'keep-alive'
        }
      }
    );
    if (response.status == 200 && response.headers['content-type'] === 'image/jpeg') {
      base64 = Buffer.from(response.data, 'binary').toString('base64');
      updated = new Date();
    }
  } catch (error) {
    logger.warn(`An error occured while fetching images for wanaka airport - ${id}`, {
      service: 'cam',
      type: 'wa'
    });
  }

  return {
    updated,
    base64
  };
}

export async function webcamWrapper() {
  try {
    const cams = await Cam.find({});
    if (!cams.length) {
      logger.error('No webcams found.', { service: 'cam' });
      return null;
    }

    for (const c of cams) {
      let data = null;
      const lastUpdate = new Date(c.lastUpdate);

      if (c.type === 'lw') {
        data = await getLakeWanakaImage(c.externalId, lastUpdate);
      } else if (c.type === 'camftp') {
        data = await getCamFtpImage(lastUpdate);
      } else if (c.type === 'wa') {
        data = await getWanakaAirportImage(c.externalId);
      }

      try {
        if (data && data.updated && data.base64) {
          const imgBuff = Buffer.from(data.base64, 'base64');

          const img = {
            time: data.updated
          };

          // for types that don't have embedded timestamps, check for duplicate image
          if (c.type === 'wa') {
            img.hash = md5(imgBuff);
            img.fileSize = imgBuff.length;

            if (c.images.length) {
              const latestImg = c.images.reduce((prev, current) =>
                prev && new Date(prev.time) > new Date(current.time) ? prev : current
              );
              if (latestImg && latestImg.fileSize == img.fileSize && latestImg.hash == img.hash) {
                logger.info(
                  `${c.type} image update skipped${c.externalId ? ` - ${c.externalId}` : ''}`,
                  { service: 'cam', type: c.type }
                );
                continue;
              }
            }
          }

          const dir = `public/cams/${c.type}/${c._id}`;
          await fs.mkdir(dir, { recursive: true });

          const resizedBuf = await sharp(imgBuff).resize({ width: 600 }).toBuffer();
          const path = `${dir}/${data.updated.toISOString()}.jpg`;
          await fs.writeFile(path, resizedBuf);

          img.url = path.replace('public/', '');

          // update cam
          c.lastUpdate = new Date();
          c.currentTime = data.updated;
          c.currentUrl = img.url;
          await c.save();

          // add image
          await Cam.updateOne(
            { _id: c._id },
            {
              $push: {
                images: img
              }
            }
          );

          logger.info(`${c.type} image updated${c.externalId ? ` - ${c.externalId}` : ''}`, {
            service: 'cam',
            type: c.type
          });
        } else {
          logger.info(`${c.type} image update skipped${c.externalId ? ` - ${c.externalId}` : ''}`, {
            service: 'cam',
            type: c.type
          });
        }
      } catch (error) {
        logger.error(
          `An error occured while saving image for ${c.type}${c.externalId ? ` - ${c.externalId}` : ''}`,
          { service: 'cam', type: c.type }
        );
        logger.error(error);
      }
    }
  } catch (error) {
    logger.error('An error occured while fetching webcam images', { service: 'cam' });
    logger.error(error);
    return null;
  }
}

export async function removeOldImages() {
  try {
    const cams = await Cam.find({});
    if (!cams.length) {
      logger.error(`No cams found.`, { service: 'cleanup' });
      return null;
    }

    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    for (const c of cams) {
      await Cam.updateOne({ _id: c._id }, { $pull: { images: { time: { $lte: cutoff } } } });
    }

    dir.files('public/cams', async (err, files) => {
      if (err) {
        throw err;
      }
      for (const file of files) {
        const stats = await fs.stat(file);
        if (stats.birthtimeMs <= cutoff.getTime()) {
          await fs.rm(file);
        }
      }
    });
  } catch (error) {
    logger.error('An error occured while removing old images', { service: 'cleanup' });
    return null;
  }
}
