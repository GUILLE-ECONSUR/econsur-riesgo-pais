# Riesgo país · EMBI Latinoamérica

Descarga la serie histórica del spread del EMBI (Argentina y Latinoamérica) publicada por el BCRD, la grafica y la compara según la **calificación crediticia vigente** de cada país (S&P, Moody's y Fitch). Listo para Vercel.

## Qué incluye

- **Gráfico de líneas**: selector de países, períodos (3M a Máx), rango de fechas, **índice base 100** (primer dato de cada serie en el período), escala log y eje Y ajustado a los datos visibles, tarjetas con último valor y variaciones, y CSV.
- **Barras horizontales**: último dato disponible de spread por país, con etiqueta en cada barra, selector propio de países y sin Venezuela (outlier). Los índices EMBI Global/Latino se pueden agregar con un botón.
- **Todos los gráficos** llevan la fuente («Elaboración propia en base a fuentes del mercado») y un botón **Exportar PNG** (el PNG incluye título, período y fuente).
- **Comparación por calificación**: tabla con notas de las tres agencias (con perspectiva y antigüedad), nota promedio, grupo (Grado de inversión / BB / B / CCC o inferior), spread, variación a 30 días y en el período elegido, spread «esperado» según la nota y desvío; gráfico de dispersión nivel vs. nota; spread promedio por grupo en el tiempo.
- **API `/api/embi`**: descarga el Excel del BCRD y devuelve JSON (convierte puntos porcentuales a puntos básicos).
- **API `/api/ratings`**: calificaciones actualizadas, desde las tablas de Wikipedia (ver «Calificaciones»).
- **Snapshots** `data/embi.json` y `data/ratings.json`: respaldo si alguna fuente no responde. Un workflow de GitHub Actions los actualiza cada día hábil y Vercel redespliega.

## Estructura

```
api/embi.js                 GET /api/embi
api/ratings.js              GET /api/ratings
lib/parse.js                Parser del Excel del BCRD
lib/ratings.js              Parser de calificaciones, escala numérica y grupos
public/index.html           Frontend (Chart.js)
scripts/update-data.js      Regenera data/embi.json y data/ratings.json
data/ratings.overrides.json Correcciones manuales de calificaciones (opcional)
test/                       Tests (npm test)
.github/workflows/update-data.yml
vercel.json
```

## Formato del Excel del BCRD

Hoja «Serie Histórica»: título en la fila 1, encabezados en la fila 2 (`Fecha | Global | LATINO | REP DOM | Argentina | …`), fechas como serial de Excel, valores en **puntos porcentuales** (2,10 = 210 pb) y `N/A` donde no hay dato. El parser lo detecta solo, convierte a pb, renombra `REP DOM` → «Rep. Dominicana», `Global`/`LATINO` → «EMBI Global»/«EMBI Latino» (agregados) y descarta la columna de diferencial `RD-LATINO`.

## Calificaciones

Fuente automática: las tablas de S&P, Moody's y Fitch de la página de Wikipedia [List of countries by credit rating](https://en.wikipedia.org/wiki/List_of_countries_by_credit_rating), leídas con la API de MediaWiki. Las agencias no ofrecen API gratuita.

- **Es una fuente secundaria**: puede ir atrasada respecto de un cambio reciente de nota. Si ves una nota desactualizada, corregila en `data/ratings.overrides.json` (se aplica sobre la fuente) y listo:

  ```json
  {
    "Argentina": { "moodys": { "rating": "B3", "outlook": "Positive", "date": "2026-09-01" } }
  }
  ```
  Claves de agencia: `sp`, `moodys`, `fitch`.
- **Escala común**: 1 = AAA/Aaa … 10 = BBB-/Baa3 … 16 = B-/B3 … 17 = CCC+/Caa1 … 22 = default. Nota promedio = media de las agencias con calificación vigente (las retiradas no cuentan).
- **Grupos**: nota redondeada ≤10 Grado de inversión · 11–13 BB · 14–16 B · ≥17 CCC o inferior. Sin calificación vigente: Venezuela (aparece en la tabla pero no en promedios).
- Si Wikipedia cambia el formato y se encuentran menos de 8 países, la API lo trata como falla y sirve el snapshot.
- Para pasar a una fuente paga (p. ej. Trading Economics) alcanza con reemplazar `fetchRatingsLive` en `lib/ratings.js` por una función que devuelva el mismo objeto `{ meta, ratings }`.

## Puesta en marcha

```bash
npm install
npm test
npm run update-data        # regenera ambos snapshots (--only=embi | --only=ratings)
node scripts/update-data.js ./Serie_Historica_Spread_del_EMBI.xlsx --only=embi   # desde un Excel local
npx vercel dev             # http://localhost:3000
```

Requiere Node 20.18 o superior.

## Subir a GitHub

```bash
git init
git add .
git commit -m "EMBI Latam con calificaciones"
git branch -M main
git remote add origin https://github.com/<usuario>/embi-latam.git
git push -u origin main
```

## Deploy en Vercel

1. En [vercel.com/new](https://vercel.com/new) importá el repositorio.
2. Framework Preset: **Other**. Dejá vacíos Build Command y Output Directory (Vercel sirve `public/` y detecta `api/`).
3. Deploy.

Cuando el workflow commitea snapshots nuevos, Vercel redespliega solo.

## Notas metodológicas

- La comparación por grupo usa la calificación **actual** de cada país aplicada a todo el historial; no reconstruye cambios de nota pasados.
- La línea «esperado por nota» es un ajuste log-lineal sobre pocos países: sirve para ver quién está por encima o debajo de lo que sugiere su nota, no como valuación.
