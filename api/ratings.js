'use strict';

const fs = require('fs');
const path = require('path');
const { fetchRatingsLive, buildRatings } = require('../lib/ratings');

const DATA = path.join(__dirname, '..', 'data');

function readJson(name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA, name), 'utf8'));
  } catch (_) {
    return null;
  }
}

function send(res, status, body, cache) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (cache) res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(body));
}

/**
 * GET /api/ratings
 * Calificaciones soberanas actualizadas (S&P, Moody's, Fitch) para los países del EMBI.
 * Orden de prioridad: fuente en vivo (+ overrides manuales) -> snapshot data/ratings.json.
 * Cache de CDN: 12 h.
 */
module.exports = async function handler(req, res) {
  const overrides = readJson('ratings.overrides.json') || {};
  try {
    const data = await fetchRatingsLive(overrides);
    data.meta.origin = 'live';
    return send(res, 200, data, 'public, s-maxage=43200, stale-while-revalidate=172800');
  } catch (err) {
    const snap = readJson('ratings.json');
    if (snap) {
      snap.meta = { ...snap.meta, origin: 'snapshot', liveError: String(err.message || err) };
      return send(res, 200, snap, 'public, s-maxage=900, stale-while-revalidate=3600');
    }
    return send(res, 502, { error: 'No se pudieron obtener las calificaciones.', detail: String(err.message || err) }, 'no-store');
  }
};

module.exports.buildRatings = buildRatings;
