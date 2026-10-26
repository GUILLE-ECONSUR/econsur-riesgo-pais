'use strict';

/**
 * Valida public/data/imf-programas.json (datos cargados a mano desde tablas y comunicados oficiales).
 * Sirve para detectar errores de tipeo al actualizarlo: coherencia DEG/US$, saldo <= desembolsado <= acordado,
 * fechas bien formadas, estados válidos y fuentes con enlace a dominios oficiales.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'imf-programas.json'), 'utf8'));

const OFFICIAL = /^https:\/\/(www\.)?(imf\.org|bcentral\.cl|bcrp\.gob\.pe|banrep\.gov\.co|bancentral\.gov\.do|banxico\.org\.mx|worldbank\.org|iadb\.org)\//;
const isDate = (d) => d === null || /^\d{4}(-\d{2}(-\d{2})?)?$/.test(d);
const approx = (a, b, tol = 0.02) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

// --- meta
assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(j.meta.verifiedOn), 'meta.verifiedOn con formato AAAA-MM-DD');
assert.ok(j.meta.sdrUsdRate > 1.2 && j.meta.sdrUsdRate < 1.5, 'tipo de cambio DEG/US$ referencial fuera de rango');

// --- crédito pendiente (tabla oficial del FMI)
const o = j.outstanding;
assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(o.asOf) && OFFICIAL.test(o.source.url), 'outstanding: fecha o fuente inválida');
const seenC = new Set();
for (const r of o.rows) {
  assert.ok(!seenC.has(r.country), `outstanding: ${r.country} duplicado`); seenC.add(r.country);
  for (const k of ['graSdrM', 'prgtSdrM', 'rstSdrM']) assert.ok(typeof r[k] === 'number' && r[k] >= 0, `outstanding ${r.country}: ${k} inválido`);
  assert.ok(r.graSdrM + r.prgtSdrM + r.rstSdrM > 0, `outstanding ${r.country}: total en cero (debería ir en «zero»)`);
}
o.zero.forEach((c) => assert.ok(!seenC.has(c), `${c} figura con saldo y en «zero»`));

// --- programas
assert.ok(Array.isArray(j.programs) && j.programs.length > 0);
const ids = new Set();
for (const p of j.programs) {
  const id = p.id || `${p.country}/${p.instrument}`;
  assert.ok(p.id && !ids.has(p.id), `${id}: id faltante o duplicado`); ids.add(p.id);
  assert.ok(p.country && p.instrument, `${id}: falta país o instrumento`);
  assert.ok(['financing', 'precautionary', 'emergency'].includes(p.kind), `${id}: kind inválido`);
  assert.ok(['vigente', 'finalizado', 'cancelado'].includes(p.status), `${id}: status inválido`);
  assert.ok(isDate(p.approval) && isDate(p.expiry), `${id}: fechas inválidas`);
  assert.ok(p.statusText, `${id}: falta statusText`);
  assert.ok(Array.isArray(p.sources) && p.sources.length >= 1, `${id}: sin fuente`);
  p.sources.forEach((s) => assert.ok(OFFICIAL.test(s.url) && s.label, `${id}: fuente no oficial o URL inválida (${s.url})`));
  assert.ok(p.agreedSdrM > 0, `${id}: falta monto acordado en DEG`);

  if (p.drawnSdrM != null) assert.ok(p.drawnSdrM <= p.agreedSdrM * 1.001, `${id}: desembolsado mayor que el acordado`);
  if (p.kind === 'precautionary' && p.status === 'vigente') assert.ok(!p.drawnSdrM, `${id}: una línea precautoria vigente no debería tener desembolsos cargados`);
  if (p.balanceSdrM != null) {
    assert.ok(p.balanceAsOf && /^\d{4}-\d{2}-\d{2}$/.test(p.balanceAsOf), `${id}: saldo sin fecha de corte`);
    if (p.drawnSdrM != null) assert.ok(p.balanceSdrM <= p.drawnSdrM * 1.001, `${id}: saldo mayor que lo desembolsado`);
  }
  if (p.usdM != null) {
    const r = p.usdM / p.agreedSdrM; // tipo de cambio implícito del comunicado; el DEG se movió entre 1,2 y 1,45 desde 2019
    assert.ok(r > 1.15 && r < 1.5, `${id}: relación US$/DEG fuera de rango (${r.toFixed(3)})`);
  }
}

// vigentes: coherencia con la tabla de crédito pendiente
for (const r of o.rows) {
  const vigentes = j.programs.filter((p) => p.country === r.country && p.status === 'vigente' && p.kind !== 'precautionary');
  const total = r.graSdrM + r.prgtSdrM + r.rstSdrM;
  assert.ok(vigentes.length > 0 || j.programs.some((p) => p.country === r.country && p.balanceSdrM > 0),
    `${r.country} tiene crédito pendiente pero ningún acuerdo cargado que lo explique`);
  void total;
}
// Argentina: la suma de saldos del historial debe coincidir con el total de la tabla al 30/09/2026
const arg = j.programs.filter((p) => p.country === 'Argentina' && p.balanceAsOf === '2026-09-30').reduce((a, p) => a + p.balanceSdrM, 0);
assert.ok(approx(arg, 41968.667, 0.001), `Argentina: suma de saldos (${arg}) distinta de la tabla del FMI (41.968,667)`);
// El Salvador: el saldo de la tabla de crédito pendiente coincide con el del EFF
const slv = j.programs.find((p) => p.id === 'SLV-2025-EFF');
assert.ok(approx(slv.balanceSdrM, o.rows.find((r) => r.country === 'El Salvador').graSdrM, 0.001), 'El Salvador: saldo distinto entre tablas');
assert.ok(approx(slv.drawnSdrM, 172.32 + 101.96, 0.001), 'El Salvador: desembolsado = 172,32 + 101,96');

// --- otros bloques
for (const x of [...j.noProgram, ...j.pending]) {
  assert.ok(x.country && x.reason, 'falta país o motivo');
  if (x.source) assert.ok(OFFICIAL.test(x.source.url), `${x.country}: URL inválida`);
}
const withProg = new Set(j.programs.map((p) => p.country));
j.noProgram.forEach((x) => assert.ok(!withProg.has(x.country), `${x.country} figura con y sin acuerdos`));

// cobertura: los 17 países de la app deben estar clasificados
const ALL = ['Argentina', 'Bolivia', 'Brasil', 'Chile', 'Colombia', 'Costa Rica', 'Ecuador', 'El Salvador', 'Guatemala', 'Honduras', 'México', 'Paraguay', 'Perú', 'Panamá', 'Uruguay', 'Venezuela', 'Rep. Dominicana'];
ALL.forEach((c) => assert.ok(withProg.has(c) || j.noProgram.some((x) => x.country === c), `${c} no está clasificado (ni con acuerdos ni en noProgram)`));

console.log(`OK: imf-programas.json válido (${j.programs.length} acuerdos, ${o.rows.length} países con saldo, ${j.noProgram.length} sin acuerdos)`);
