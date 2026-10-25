'use strict';

/**
 * Indicadores macro por país desde APIs públicas (sin clave):
 *  - Banco Mundial (WDI):  https://api.worldbank.org/v2/country/{ISO3;ISO3}/indicator/{código}?format=json
 *  - FMI (DataMapper/WEO): https://www.imf.org/external/datamapper/api/v1/{indicador}/{ISO3}/{ISO3}
 *
 * Banco Mundial = último dato observado (con año). FMI = serie WEO con estimaciones y proyecciones.
 * Cada indicador se pide por separado: si uno falla, se conserva lo último guardado de ese indicador.
 */

const WB_BASE = 'https://api.worldbank.org/v2';
const IMF_BASE = 'https://www.imf.org/external/datamapper/api/v1';
const UA = 'Mozilla/5.0 (compatible; embi-latam/1.0; +https://github.com)';

// Nombre mostrado (= serie del EMBI) -> ISO3
const COUNTRY_ISO = {
  Argentina: 'ARG', Bolivia: 'BOL', Brasil: 'BRA', Chile: 'CHL', Colombia: 'COL', 'Costa Rica': 'CRI',
  Ecuador: 'ECU', 'El Salvador': 'SLV', Guatemala: 'GTM', Honduras: 'HND', México: 'MEX', Paraguay: 'PRY',
  Perú: 'PER', Panamá: 'PAN', Uruguay: 'URY', Venezuela: 'VEN', 'Rep. Dominicana': 'DOM',
};

// unit: 'pct' | 'usd' | 'months'. kind: 'obs' (Banco Mundial, último observado) | 'weo' (FMI, por año).
const INDICATORS = [
  // --- Actividad y precios
  { key: 'gdppc', label: 'PIB per cápita (USD corrientes)', short: 'PIB p/c', unit: 'usd', dec: 0, src: 'wb', code: 'NY.GDP.PCAP.CD', kind: 'obs', group: 'Actividad' },
  { key: 'gdppcppp', label: 'PIB per cápita PPA (USD intl. corrientes)', short: 'PIB p/c PPA', unit: 'usd', dec: 0, src: 'wb', code: 'NY.GDP.PCAP.PP.CD', kind: 'obs', group: 'Actividad' },
  { key: 'growth', label: 'Crecimiento del PIB real (% a/a)', short: 'Crec. PIB', unit: 'pct', dec: 1, src: 'imf', code: 'NGDP_RPCH', kind: 'weo', group: 'Actividad' },
  { key: 'infl', label: 'Inflación, promedio anual (%)', short: 'Inflación', unit: 'pct', dec: 1, src: 'imf', code: 'PCPIPCH', kind: 'weo', group: 'Actividad' },
  { key: 'unemp', label: 'Desempleo (% de la fuerza laboral)', short: 'Desempleo', unit: 'pct', dec: 1, src: 'imf', code: 'LUR', kind: 'weo', group: 'Actividad' },
  // --- Fiscal
  { key: 'fiscal', label: 'Resultado fiscal global, gob. general (% del PIB)', short: 'Result. fiscal', unit: 'pct', dec: 1, src: 'imf', code: 'GGXCNL_NGDP', kind: 'weo', group: 'Fiscal' },
  { key: 'primary', label: 'Resultado primario, gob. general (% del PIB)', short: 'Result. primario', unit: 'pct', dec: 1, src: 'imf', code: 'GGXONLB_NGDP', kind: 'weo', group: 'Fiscal' },
  { key: 'debt', label: 'Deuda pública bruta, gob. general (% del PIB)', short: 'Deuda pública', unit: 'pct', dec: 1, src: 'imf', code: 'GGXWDG_NGDP', kind: 'weo', group: 'Fiscal' },
  // --- Externo
  { key: 'extdebt', label: 'Deuda externa total (% del INB)', short: 'Deuda externa', unit: 'pct', dec: 1, src: 'wb', code: 'DT.DOD.DECT.GN.ZS', kind: 'obs', group: 'Externo',
    note: 'Banco Mundial (IDS): solo países de ingreso bajo y medio; Chile, Uruguay y Panamá pueden figurar sin dato.' },
  { key: 'extservice', label: 'Servicio de la deuda externa (% de exportaciones)', short: 'Servicio deuda ext.', unit: 'pct', dec: 1, src: 'wb', code: 'DT.TDS.DECT.EX.ZS', kind: 'obs', group: 'Externo',
    note: 'Banco Mundial (IDS): misma cobertura que deuda externa.' },
  { key: 'cab', label: 'Cuenta corriente (% del PIB)', short: 'Cta. corriente', unit: 'pct', dec: 1, src: 'imf', code: 'BCA_NGDPD', kind: 'weo', group: 'Externo' },
  { key: 'reserves', label: 'Reservas internacionales (meses de importaciones)', short: 'Reservas (meses)', unit: 'months', dec: 1, src: 'wb', code: 'FI.RES.TOTL.MO', kind: 'obs', group: 'Externo' },
  { key: 'exports', label: 'Exportaciones de bienes y servicios (% del PIB)', short: 'Exportaciones', unit: 'pct', dec: 1, src: 'wb', code: 'NE.EXP.GNFS.ZS', kind: 'obs', group: 'Externo' },
  { key: 'fdi', label: 'Inversión extranjera directa neta entrante (% del PIB)', short: 'IED neta', unit: 'pct', dec: 1, src: 'wb', code: 'BX.KLT.DINV.WD.GD.ZS', kind: 'obs', group: 'Externo' },
];

const ISO_TO_NAME = Object.fromEntries(Object.entries(COUNTRY_ISO).map(([n, i]) => [i, n]));
const SRC_NAME = { wb: 'Banco Mundial (WDI/IDS)', imf: 'FMI (World Economic Outlook, DataMapper)' };

const TIMEOUT_MS = 8000;

async function getJson(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${url.split('?')[0]}`);
    const txt = await r.text();
    try {
      return JSON.parse(txt);
    } catch (_) {
      throw new Error(`Respuesta no JSON de ${url.split('?')[0]}: ${txt.slice(0, 80)}`);
    }
  } catch (e) {
    if (e && e.name === 'AbortError') throw new Error(`Sin respuesta en ${TIMEOUT_MS / 1000} s de ${url.split('?')[0]}`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

/** Respuesta WB v2 -> { ISO3: { year: value } } (solo valores no nulos) */
function parseWb(json) {
  if (!Array.isArray(json)) throw new Error('Respuesta inesperada del Banco Mundial');
  const meta = json[0] || {};
  if (meta.message) throw new Error('Banco Mundial: ' + JSON.stringify(meta.message).slice(0, 160));
  const out = {};
  for (const rec of json[1] || []) {
    const iso = rec.countryiso3code || (rec.country && rec.country.id);
    const year = Number(rec.date);
    if (!ISO_TO_NAME[iso] || !Number.isFinite(year) || rec.value == null) continue;
    (out[iso] = out[iso] || {})[year] = Number(rec.value);
  }
  return out;
}

/** Respuesta DataMapper del FMI -> { ISO3: { year: value } } desde minYear */
function parseImf(json, code, minYear = 2010) {
  const node = json && json.values && json.values[code];
  if (!node) throw new Error(`FMI: sin datos para ${code}`);
  const out = {};
  for (const [iso, years] of Object.entries(node)) {
    if (!ISO_TO_NAME[iso]) continue;
    for (const [y, v] of Object.entries(years || {})) {
      const year = Number(y);
      if (year >= minYear && v != null && Number.isFinite(Number(v))) (out[iso] = out[iso] || {})[year] = Number(v);
    }
  }
  return out;
}

async function fetchIndicator(ind, year) {
  const isos = Object.values(COUNTRY_ISO);
  if (ind.src === 'wb') {
    const url = `${WB_BASE}/country/${isos.join(';')}/indicator/${ind.code}?format=json&per_page=2000&date=${year - 14}:${year}`;
    return parseWb(await getJson(url));
  }
  const url = `${IMF_BASE}/${ind.code}/${isos.join('/')}`;
  return parseImf(await getJson(url), ind.code, year - 14);
}

/** Ensambla el JSON final a partir de series por indicador. */
function assemble(seriesByKey, prev, failed) {
  const countries = {};
  for (const [name, iso] of Object.entries(COUNTRY_ISO)) {
    const values = {};
    for (const ind of INDICATORS) {
      const s = seriesByKey[ind.key] && seriesByKey[ind.key][iso];
      if (s && Object.keys(s).length) values[ind.key] = s;
    }
    countries[name] = { iso3: iso, values };
  }
  // Para indicadores que fallaron, conservar lo anterior (snapshot)
  if (prev && prev.countries) {
    for (const key of failed) {
      for (const name of Object.keys(countries)) {
        const old = prev.countries[name] && prev.countries[name].values && prev.countries[name].values[key];
        if (old) countries[name].values[key] = old;
      }
    }
  }
  const imfYears = new Set();
  for (const c of Object.values(countries)) {
    for (const ind of INDICATORS) if (ind.kind === 'weo' && c.values[ind.key]) Object.keys(c.values[ind.key]).forEach((y) => imfYears.add(Number(y)));
  }
  return { countries, imfYears: [...imfYears].sort((a, b) => a - b) };
}

/**
 * Descarga todos los indicadores. prev = snapshot anterior (para completar los que fallen).
 * Lanza error si fallan casi todos (fuente caída o formato cambiado).
 */
async function fetchMacroLive(prev = null, now = new Date()) {
  const year = now.getUTCFullYear();
  const results = await Promise.allSettled(INDICATORS.map((ind) => fetchIndicator(ind, year)));
  const seriesByKey = {};
  const failed = [];
  const errors = {};
  results.forEach((r, i) => {
    const ind = INDICATORS[i];
    if (r.status === 'fulfilled' && Object.keys(r.value).length) seriesByKey[ind.key] = r.value;
    else {
      failed.push(ind.key);
      errors[ind.key] = r.status === 'rejected' ? String(r.reason && r.reason.message || r.reason) : 'sin datos';
    }
  });
  if (failed.length > INDICATORS.length - 3) {
    throw new Error(`Fallaron ${failed.length}/${INDICATORS.length} indicadores. Ejemplo: ${Object.values(errors)[0]}`);
  }
  const { countries, imfYears } = assemble(seriesByKey, prev, failed);
  return {
    meta: {
      generatedAt: now.toISOString(),
      sources: SRC_NAME,
      indicators: INDICATORS.map(({ key, label, short, unit, dec, src, code, kind, group, note }) => ({ key, label, short, unit, dec, src, code, kind, group, note })),
      imfYears,
      refYear: year,
      stale: failed,
      errors,
    },
    countries,
  };
}

module.exports = { fetchMacroLive, parseWb, parseImf, assemble, INDICATORS, COUNTRY_ISO };
