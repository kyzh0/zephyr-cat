export const APIROOT =
  process.env.NODE_ENV === 'production' ? 'https://api.cat.zephyrapp.nz' : 'http://localhost:5000';

export const FILESERVERROOT =
  process.env.NODE_ENV === 'production' ? 'https://fs.cat.zephyrapp.nz' : 'http://localhost:5000';
