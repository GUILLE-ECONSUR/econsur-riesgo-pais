'use strict';

const assert = require('assert');
const { parseWb, parseImf, fetchMacroLive, INDICATORS } = require('../lib/macro');

// --- Formato Banco Mundial v2: [meta, [registros]]; valores nulos incluidos
const wbJson = [
  { page: 1, pages: 1, per_page: 2000, total: 5 },
  [
    { indicator: { id: 'NY.GDP.PCAP.CD' }, country: { id: 'AR' }, countryiso3code: 'ARG', date: '2024', value: 13650.4 },
    { indicator: { id: 'NY.GDP.PCAP.CD' }, country: { id: 'AR' }, countryiso3code: 'ARG', date: '2025', value: null },
    { indicator: { id: 'NY.GDP.PCAP.CD' }, country: { id: 'CL' }, countryiso3code: 'CHL', date: '2024', value: 17000 },
    { indicator: { id: 'NY.GDP.PCAP.CD' }, country: { id: 'ZZ' }, countryiso3code: 'ZZZ', date: '2024', value: 1 }, // país no usado
    { indicator: { id: 'NY.GDP.PCAP.CD' }, country: { id: 'BR' }, countryiso3code: 'BRA', date: '2023', value: 10300 },
  ],
];
const wb = parseWb(wbJson);
assert.deepStrictEqual(wb.ARG, { 2024: 13650.4 }, 'descarta nulos');
assert.ok(!wb.ZZZ, 'ignora países fuera de la lista');
assert.throws(() => parseWb([{ message: [{ id: '120', value: 'Invalid value' }] }]), /Banco Mundial/);
assert.throws(() => parseWb({}), /inesperada/);

// --- Formato DataMapper FMI
const imfJson = { values: { GGXCNL_NGDP: {
  ARG: { 2008: 1, 2023: -4.2, 2024: 0.3, 2025: 0.8, 2026: 0.5 },
  BRA: { 2024: -7.9, 2025: null },
  XXX: { 2024: 9 },
} }, api: { version: '1' } };
const imf = parseImf(imfJson, 'GGXCNL_NGDP', 2010);
assert.deepStrictEqual(imf.ARG, { 2023: -4.2, 2024: 0.3, 2025: 0.8, 2026: 0.5 }, 'filtra años viejos');
assert.deepStrictEqual(imf.BRA, { 2024: -7.9 });
assert.ok(!imf.XXX);
assert.throws(() => parseImf({ values: {} }, 'GGXCNL_NGDP'), /sin datos/);

// --- Integración con fetch simulado
function mockFetch(failCodes = [], failAll = false) {
  return async (url) => {
    if (failAll) return { ok: false, status: 503 };
    const isWb = url.includes('api.worldbank.org');
    const code = isWb ? url.split('/indicator/')[1].split('?')[0] : url.split('/v1/')[1].split('/')[0];
    if (failCodes.includes(code)) return { ok: false, status: 500 };
    if (isWb) {
      assert.ok(/country\/ARG;BOL;BRA/.test(url) && /per_page=2000/.test(url) && /date=\d{4}:\d{4}/.test(url), 'URL WB bien formada');
      return { ok: true, json: async () => [{ page: 1 }, [{ countryiso3code: 'ARG', date: '2024', value: 5 }, { countryiso3code: 'CHL', date: '2023', value: 7 }]] };
    }
    assert.ok(/v1\/[A-Z_]+\/ARG\/BOL\/BRA/.test(url), 'URL FMI bien formada');
    return { ok: true, json: async () => ({ values: { [code]: { ARG: { 2024: 1, 2025: 2, 2026: 3, 2027: 4 }, URY: { 2025: 9 } } } }) };
  };
}

(async () => {
  const realFetch = global.fetch;
  try {
    global.fetch = mockFetch();
    const ok = await fetchMacroLive(null, new Date('2026-10-25T12:00:00Z'));
    assert.strictEqual(ok.meta.indicators.length, INDICATORS.length);
    assert.strictEqual(ok.meta.refYear, 2026);
    assert.deepStrictEqual(ok.meta.imfYears, [2024, 2025, 2026, 2027]);
    assert.deepStrictEqual(ok.countries.Argentina.values.fiscal, { 2024: 1, 2025: 2, 2026: 3, 2027: 4 });
    assert.deepStrictEqual(ok.countries.Argentina.values.gdppc, { 2024: 5 });
    assert.strictEqual(ok.countries.Chile.values.gdppc[2023], 7);
    assert.strictEqual(ok.countries.Uruguay.iso3, 'URY');
    assert.strictEqual(ok.meta.stale.length, 0);

    // Un indicador falla -> se conserva el snapshot anterior de ese indicador
    const prev = JSON.parse(JSON.stringify(ok));
    prev.countries.Argentina.values.extdebt = { 2022: 55.5 };
    global.fetch = mockFetch(['DT.DOD.DECT.GN.ZS']);
    const part = await fetchMacroLive(prev, new Date('2026-10-26T12:00:00Z'));
    assert.deepStrictEqual(part.meta.stale, ['extdebt']);
    assert.deepStrictEqual(part.countries.Argentina.values.extdebt, { 2022: 55.5 }, 'completa con snapshot');
    assert.ok(/HTTP 500/.test(part.meta.errors.extdebt));

    // Todo cae -> error (la API sirve el snapshot)
    global.fetch = mockFetch([], true);
    await assert.rejects(() => fetchMacroLive(null), /Fallaron \d+\/\d+/);
  } finally {
    global.fetch = realFetch;
  }
  console.log('OK: tests macro pasaron');
})().catch((e) => { console.error(e); process.exit(1); });
