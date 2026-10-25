'use strict';

/**
 * Calificaciones soberanas (S&P, Moody's, Fitch).
 *
 * Fuente automática: tablas de https://en.wikipedia.org/wiki/List_of_countries_by_credit_rating
 * (vía API de MediaWiki). Es una fuente secundaria: puede tener rezago frente a las agencias,
 * por eso existe data/ratings.overrides.json para corregir a mano sin tocar código.
 */

const cheerio = require('cheerio');

const WIKI_API =
  'https://en.wikipedia.org/w/api.php?action=parse&page=List_of_countries_by_credit_rating&prop=text&format=json&formatversion=2&redirects=1';
const WIKI_PAGE = 'https://en.wikipedia.org/wiki/List_of_countries_by_credit_rating';

// Nombre mostrado en el gráfico (= nombre de la serie del EMBI) -> nombre en Wikipedia
const COUNTRY_MAP = {
  Argentina: 'Argentina',
  Bolivia: 'Bolivia',
  Brasil: 'Brazil',
  Chile: 'Chile',
  Colombia: 'Colombia',
  'Costa Rica': 'Costa Rica',
  Ecuador: 'Ecuador',
  'El Salvador': 'El Salvador',
  Guatemala: 'Guatemala',
  Honduras: 'Honduras',
  México: 'Mexico',
  Paraguay: 'Paraguay',
  Perú: 'Peru',
  Panamá: 'Panama',
  Uruguay: 'Uruguay',
  Venezuela: 'Venezuela',
  'Rep. Dominicana': 'Dominican Republic',
};

// Escala numérica común (1 = AAA/Aaa ... mayor = peor)
const SP_SCALE = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D'];
const MOODYS_SCALE = ['Aaa', 'Aa1', 'Aa2', 'Aa3', 'A1', 'A2', 'A3', 'Baa1', 'Baa2', 'Baa3', 'Ba1', 'Ba2', 'Ba3', 'B1', 'B2', 'B3', 'Caa1', 'Caa2', 'Caa3', 'Ca', 'C'];

const AGENCIES = ['sp', 'moodys', 'fitch'];

function norm(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanText(s) {
  return String(s || '')
    .replace(/\[[^\]]*\]/g, '') // referencias [1]
    .replace(/[−–—‐‑]/g, '-') // menos tipográfico -> '-'
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function ratingScore(agency, rating) {
  if (!rating) return null;
  if (agency === 'moodys') {
    const i = MOODYS_SCALE.findIndex((r) => r.toLowerCase() === rating.toLowerCase());
    return i >= 0 ? i + 1 : null;
  }
  const r = rating.toUpperCase();
  if (r === 'SD' || r === 'RD') return 22;
  const i = SP_SCALE.indexOf(r);
  return i >= 0 ? i + 1 : null;
}

const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

function parseDate(s) {
  const t = cleanText(s);
  let m = t.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/); // 10 June 2026
  if (!m) {
    const m2 = t.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/); // June 10, 2026
    if (m2) m = [null, m2[2], m2[1], m2[3]];
  }
  if (m) {
    const mo = MONTHS[m[2].toLowerCase()];
    if (mo) return `${m[3]}-${String(mo).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
  }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return iso ? iso[0] : null;
}

function agencyFromHeading(text) {
  if (/standard|s&p|s&amp;p/i.test(text)) return 'sp';
  if (/fitch/i.test(text)) return 'fitch';
  if (/moody/i.test(text)) return 'moodys';
  return null;
}

/** Texto del encabezado (h2-h4) más cercano por encima de la tabla. */
function headingFor($, table) {
  let cur = $(table);
  for (let up = 0; up < 6 && cur.length; up++) {
    const prevs = cur.prevAll().toArray();
    for (const el of prevs) {
      const $el = $(el);
      const isH = /^h[2-4]$/i.test(el.tagName || el.name || '');
      const h = isH ? $el : $el.find('h2,h3,h4').last();
      if (h.length) return h.text();
    }
    cur = cur.parent();
  }
  return '';
}

function cellText($, cell) {
  const c = $(cell).clone();
  c.find('sup, style, .reference, .noprint').remove();
  return cleanText(c.text());
}

/**
 * HTML de la página -> { sp: {normName: {rating, outlook, date}}, moodys: {...}, fitch: {...} }
 */
function parseAgencyTables(html) {
  const $ = cheerio.load(html);
  const out = { sp: {}, moodys: {}, fitch: {} };

  $('table').each((_, table) => {
    const rows = $(table).find('tr').toArray();
    if (!rows.length) return;

    // Fila de encabezado: la primera con "country" y "rating"
    let hdrIdx = -1;
    let cols = null;
    for (let i = 0; i < Math.min(rows.length, 4); i++) {
      const heads = $(rows[i]).children('th,td').toArray().map((c) => cellText($, c).toLowerCase());
      const ci = heads.findIndex((h) => /country|territory|sovereign/.test(h));
      const ri = heads.findIndex((h) => /^rating/.test(h));
      if (ci >= 0 && ri >= 0) {
        hdrIdx = i;
        cols = {
          country: ci,
          rating: ri,
          outlook: heads.findIndex((h) => /outlook/.test(h)),
          date: heads.findIndex((h) => /date/.test(h)),
          n: heads.length,
        };
        break;
      }
    }
    if (!cols) return;

    const agency = agencyFromHeading(headingFor($, table));
    if (!agency) return;

    for (let i = hdrIdx + 1; i < rows.length; i++) {
      const cells = $(rows[i]).children('th,td').toArray();
      if (cells.length < cols.n) continue; // filas con rowspan/colspan: se ignoran
      const country = cellText($, cells[cols.country]);
      const rating = cellText($, cells[cols.rating]);
      if (!country || !rating) continue;
      const outlook = cols.outlook >= 0 ? cellText($, cells[cols.outlook]) : '';
      const date = cols.date >= 0 ? parseDate(cellText($, cells[cols.date])) : null;
      out[agency][norm(country)] = { rating, outlook, date };
    }
  });

  return out;
}

function entryFrom(agency, raw) {
  if (!raw) return null;
  const rating = cleanText(raw.rating).replace(/\s*\(.*\)$/, '');
  const outlook = cleanText(raw.outlook || '');
  const withdrawn = /withdrawn/i.test(outlook) || /withdrawn|^NR$/i.test(rating);
  const score = withdrawn ? null : ratingScore(agency, rating);
  return { rating, outlook: outlook.replace(/^["']|["']$/g, ''), date: raw.date || null, withdrawn, score };
}

function groupOf(score) {
  if (score == null) return 'Sin calificación vigente';
  if (score <= 10) return 'Grado de inversión';
  if (score <= 13) return 'BB';
  if (score <= 16) return 'B';
  return 'CCC o inferior';
}

/**
 * Combina las tres agencias para cada país mostrado en el EMBI.
 * overrides: { "Argentina": { moodys: {rating, outlook, date} } }  (opcional)
 */
function buildRatings(agencyData, overrides = {}) {
  const ratings = {};
  for (const [display, wiki] of Object.entries(COUNTRY_MAP)) {
    const rec = {};
    for (const ag of AGENCIES) {
      const ov = overrides[display] && overrides[display][ag];
      rec[ag] = entryFrom(ag, ov || agencyData[ag][norm(wiki)]);
    }
    const scores = AGENCIES.map((a) => rec[a] && rec[a].score).filter((s) => s != null);
    const avg = scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : null;
    const rounded = avg == null ? null : Math.round(avg);
    ratings[display] = {
      ...rec,
      score: avg == null ? null : Math.round(avg * 100) / 100,
      composite: rounded == null ? null : SP_SCALE[Math.min(rounded, SP_SCALE.length) - 1],
      group: groupOf(rounded),
      agencies: scores.length,
    };
  }
  return ratings;
}

async function fetchRatingsHtml() {
  const r = await fetch(WIKI_API, {
    headers: { 'user-agent': 'embi-latam/1.0 (proyecto de datos; contacto: ver repositorio)', accept: 'application/json' },
  });
  if (!r.ok) throw new Error(`Wikipedia respondió HTTP ${r.status}`);
  const j = await r.json();
  const html = j && j.parse && j.parse.text;
  if (!html) throw new Error('Respuesta de Wikipedia sin HTML');
  return html;
}

/** Descarga, parsea y valida. Lanza error si el layout cambió (muy pocos países encontrados). */
async function fetchRatingsLive(overrides = {}) {
  const html = await fetchRatingsHtml();
  const agencyData = parseAgencyTables(html);
  const ratings = buildRatings(agencyData, overrides);
  const withData = Object.values(ratings).filter((r) => r.agencies > 0).length;
  if (withData < 8) {
    throw new Error(`Solo se encontraron calificaciones para ${withData} países: el formato de la fuente pudo haber cambiado.`);
  }
  return {
    meta: {
      source: WIKI_PAGE,
      sourceNote: 'Tablas S&P, Moody\'s y Fitch de Wikipedia (fuente secundaria; puede tener rezago frente a las agencias).',
      generatedAt: new Date().toISOString(),
      scale: 'Escala numérica: 1 = AAA/Aaa … 10 = BBB-/Baa3 … 16 = B-/B3 … 22 = default',
      scaleLetters: SP_SCALE,
    },
    ratings,
  };
}

module.exports = { parseAgencyTables, buildRatings, fetchRatingsLive, ratingScore, groupOf, COUNTRY_MAP, SP_SCALE, norm, parseDate };
