import scrapeMeteocatData from './types/meteocat.js';
import scrapeMeteoclimaticData from './types/meteoclimatic.js';
import scrapeWeatherlinkData from './types/weatherlink.js';

export default {
  meteocat: scrapeMeteocatData,
  meteoclimatic: scrapeMeteoclimaticData,
  weatherlink: scrapeWeatherlinkData
};
