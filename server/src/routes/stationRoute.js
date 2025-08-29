import express from 'express';
import * as geofire from 'geofire-common';

import { ObjectId } from 'mongodb';
import { Station } from '../models/stationModel.js';
import { User } from '../models/userModel.js';

const router = express.Router();

// get stations
router.get('/', async (req, res) => {
  const { unixTimeFrom, lat, lon, radius, err } = req.query;
  const time = unixTimeFrom ? Number(unixTimeFrom) : NaN;
  const latitude = lat ? Number(lat) : NaN;
  const longitude = lon ? Number(lon) : NaN;
  const rad = radius ? Number(radius) : NaN;

  const query = {};
  const orderby = {};

  if (err) {
    query.isError = true;
    orderby.isOffline = -1;
    orderby.name = 1;
  }

  if (!isNaN(latitude) && !isNaN(longitude) && !isNaN(rad)) {
    query.location = {
      $geoWithin: {
        $centerSphere: [[longitude, latitude], rad / 6378]
      }
    };
  }
  if (!isNaN(time)) {
    query.lastUpdate = { $gte: new Date(time * 1000) };
  }

  let stations = await Station.find(query, { data: 0 }).sort(orderby);

  if (!isNaN(latitude) && !isNaN(longitude) && !isNaN(rad)) {
    stations = JSON.parse(JSON.stringify(stations)); // convert to plain js obj
    for (const s of stations) {
      s.distance =
        Math.round(
          geofire.distanceBetween(
            [s.location.coordinates[1], s.location.coordinates[0]],
            [latitude, longitude]
          ) * 10
        ) / 10;
    }
    stations.sort((a, b) => a.distance - b.distance);
  }

  res.json(stations);
});

// add station
router.post('/', async (req, res) => {
  const user = await User.findOne({ key: req.query.key });
  if (!user) {
    res.status(401).send();
    return;
  }

  const { name, type, coordinates, externalLink, externalId, elevation, validBearings } = req.body;

  const station = new Station({
    name: name,
    type: type,
    location: {
      type: 'Point',
      coordinates: coordinates
    },
    externalLink: externalLink,
    externalId: externalId,
    elevation: elevation,
    currentAverage: null,
    currentGust: null,
    currentBearing: null,
    currentTemperature: null
  });

  if (validBearings) {
    station.validBearings = validBearings;
  }

  await station.save();
  res.status(204).send();
});

// get all station data for timestamp
router.get('/data', async (req, res) => {
  let timeTo = new Date();
  if (req.query.time) timeTo = new Date(req.query.time);
  const timeFrom = new Date(timeTo.getTime() - 30 * 60 * 1000);

  // select data for 30 min interval ending at specified time
  const data = await Station.aggregate([
    {
      $project: {
        _id: 1,
        validBearings: 1,
        data: {
          $filter: {
            input: '$data',
            as: 'd',
            cond: {
              $and: [{ $gte: ['$$d.time', timeFrom] }, { $lte: ['$$d.time', timeTo] }]
            }
          }
        }
      }
    }
  ]);

  if (!data.length) {
    res.json([]);
    return;
  }

  // calculate average for 30 min intervals
  const result = [];
  for (const d of data) {
    let count = 0;
    let sumAvg = 0;
    let sumBearingSin = 0;
    let sumBearingCos = 0;
    for (const d1 of d.data) {
      if (d1.windAverage !== null && d1.windBearing != null) {
        count++;
        sumAvg += d1.windAverage;
        sumBearingSin += Math.sin((d1.windBearing * Math.PI) / 180);
        sumBearingCos += Math.cos((d1.windBearing * Math.PI) / 180);
      }
    }
    const bearing =
      count > 0 ? Math.round(Math.atan2(sumBearingSin, sumBearingCos) / (Math.PI / 180)) : null;
    result.push({
      id: d._id,
      windAverage: count > 0 ? Math.round(sumAvg / count) : null,
      windBearing: bearing < 0 ? bearing + 360 : bearing,
      validBearings: d.validBearings
    });
  }

  res.json({ time: new Date().toISOString(), values: result });
});

// get station
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    res.status(404).send();
    return;
  }

  const s = await Station.findOne({ _id: new ObjectId(id) }, { data: 0 });
  if (!s) {
    res.status(404).send();
    return;
  }

  res.json(s);
});

// patch station
router.patch('/:id', async (req, res) => {
  const { id } = req.params;
  const user = await User.findOne({ key: req.query.key });
  if (!user) {
    res.status(401).send();
    return;
  }

  const { patch, remove } = req.body;
  try {
    const station = await Station.findOne({ _id: new ObjectId(id) }, { data: 0 });

    for (const key of Object.keys(patch)) {
      station[key] = patch[key];
    }
    for (const key of Object.keys(remove)) {
      station[key] = undefined;
    }

    await station.save();
    res.status(204).send();
  } catch {
    res.status(400).send();
  }
});

// get station data
router.get('/:id/data', async (req, res) => {
  const { id } = req.params;

  if (!ObjectId.isValid(id)) {
    res.status(404).send();
    return;
  }

  const result = await Station.aggregate([
    {
      $match: { _id: new ObjectId(id) }
    },
    {
      $project: {
        _id: 0,
        data: {
          $slice: [
            {
              $sortArray: { input: '$data', sortBy: { time: -1 } }
            },
            145 // 145 records in last 24h
          ]
        }
      }
    }
  ]);

  if (!result.length) {
    res.json([]);
    return;
  }

  res.json(result[0].data);
});

export default router;
