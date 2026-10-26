# Riesgo país · EMBI Latinoamérica

Descarga la serie histórica del spread del EMBI (Argentina y Latinoamérica) publicada por el BCRD, la grafica, la compara según la **calificación crediticia vigente** de cada país y la cruza con indicadores macro del Banco Mundial y el FMI. Listo para Vercel.

## Qué incluye

- **Gráfico de líneas**: selector de países, períodos (3M a Máx), rango de fechas, **índice base 100** (primer dato de cada serie en el período), escala log y eje Y ajustado a los datos visibles, tarjetas con último valor y variaciones, y CSV.
- **Barras horizontales**: último dato disponible de spread por país, con etiqueta en cada barra, selector propio de países y sin Venezuela (outlier). Los índices EMBI Global/Latino se pueden agregar con un botón.
- **Todos los gráficos** llevan la fuente («Elaboración propia en base a fuentes del mercado») y un botón **Exportar PNG** (el PNG incluye título, período y fuente).
- **Comparación por calificación**: tabla con notas de las tres agencias (con perspectiva y antigüedad), nota promedio, grupo (Grado de inversión / BB / B / CCC o inferior), spread, variación a 30 días y en el período elegido, spread «esperado» según la nota y desvío; gráfico de dispersión nivel vs. nota; spread promedio por grupo en el tiempo.
- **Pestaña «Comparativo macro»**: cuadro por país con calificación, spread y 14 indicadores del Banco Mundial y el FMI (PIB per cápita, crecimiento, inflación, desempleo, resultado fiscal y primario, deuda pública, deuda externa, servicio de deuda, cuenta corriente, reservas, exportaciones, IED). Se ordena por cualquier columna, se filtra por grupo (Actividad / Fiscal / Externo), permite elegir el año de los datos del FMI (incluye estimaciones y proyecciones WEO) y se descarga en CSV. Debajo, un gráfico con selector de indicador: barras por país o dispersión contra el spread (con correlación), con fuente y Exportar PNG.
- **API `/api/macro`**: consulta ambas fuentes (sin clave), cache de 24 h; si un indicador falla conserva el último valor guardado.
- **API `/api/embi`**: descarga el Excel del BCRD y devuelve JSON (convierte puntos porcentuales a puntos básicos).
- **API `/api/ratings`**: calificaciones actualizadas, desde las tablas de Wikipedia (ver «Calificaciones»).
- **Snapshots** `data/embi.json` y `data/ratings.json`: respaldo si alguna fuente no responde. Un workflow de GitHub Actions los actualiza cada día hábil y Vercel redespliega.

## Estructura

```
api/embi.js                 GET /api/embi
api/ratings.js              GET /api/ratings
api/macro.js                GET /api/macro
lib/macro.js                Cliente Banco Mundial + FMI, catálogo de indicadores
lib/parse.js                Parser del Excel del BCRD
lib/ratings.js              Parser de calificaciones, escala numérica y grupos
public/index.html           Frontend (Chart.js)
public/data/imf-programas.json  Acuerdos vigentes del FMI (carga manual con fuentes)
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

## Datos macro (Banco Mundial y FMI)

| Fuente | Endpoint | Qué se usa |
|---|---|---|
| Banco Mundial | `https://api.worldbank.org/v2/country/ARG;BRA;…/indicator/{código}?format=json` | Último dato observado por país (WDI e IDS) |
| FMI | `https://www.imf.org/external/datamapper/api/v1/{indicador}/ARG/BRA/…` | Serie WEO por año, con estimaciones y proyecciones |

Los indicadores y sus códigos están en `lib/macro.js` (`INDICATORS`); para agregar uno basta con sumar una línea.

Cosas a tener en cuenta:
- **Deuda externa y servicio de deuda** vienen de las estadísticas de deuda del Banco Mundial (IDS), que cubren solo países de ingreso bajo y medio. Chile, Uruguay y Panamá pueden salir sin dato. La deuda externa está como % del INB, no del PIB (es lo que publica el BM).
- Los datos del Banco Mundial tienen rezago (suele ser 1 o 2 años); el año de cada dato se muestra en gris. Los del FMI se eligen por año; los años desde el actual son estimaciones o proyecciones y se ven en cursiva. Por defecto se muestra el último año cerrado.
- Venezuela casi no tiene datos recientes en estas fuentes y su spread es un valor atípico: se muestra atenuada en la tabla y no entra en los gráficos.
- Hay una falla parcial tolerada: si una API cae, la corrida conserva lo anterior de ese indicador y lo informa en `meta.stale`.

## Financiamiento del FMI (gráfico de torta e historial)

En la pestaña «Comparativo macro» hay un gráfico de torta con tres medidas, siempre en US$ aproximados y en %:

- **Deuda con el FMI (crédito pendiente)** — por defecto. Es lo que cada país debe por *todos* sus acuerdos, vigentes o vencidos (por ejemplo, el EFF 2022 de Argentina, vencido en 12/2024 pero con DEG 30.517 M pendientes). Sale de la tabla oficial «Credit Outstanding for all members» del FMI.
- **Acceso de acuerdos vigentes**, con botón para sumar las líneas precautorias (FCL).
- **Desembolsado en acuerdos vigentes.**

Debajo hay una tabla resumen por país y un **historial de 36 acuerdos desde 2020** (vigentes, finalizados y cancelados) con monto acordado, desembolsado, saldo, estado y enlace a la tabla o comunicado oficial del FMI de cada cifra. También se listan los países sin acuerdos y los casos pendientes (p. ej. Bolivia).

Los datos están en `public/data/imf-programas.json`. El FMI no ofrece una API gratuita de programas vigentes, así que **se cargan a mano** desde sus tablas y comunicados, y hay que actualizarlos con cada revisión del Directorio (aprox. cada 6 meses por país):

1. En GitHub abrí `public/data/imf-programas.json` y tocá el lápiz (Edit).
2. Si salió una revisión nueva: actualizá `drawnSdrM`, el texto de `statusText` y agregá el enlace del comunicado en `sources`. Si el acuerdo venció o se canceló, cambiá `status` a `"finalizado"` o `"cancelado"`.
3. Para un acuerdo nuevo, copiá un bloque de `programs` y cambiá los datos (montos en millones de DEG).
4. Cada tanto (el FMI actualiza la tabla cada trimestre) actualizá el bloque `outstanding` con la nueva tabla «Credit Outstanding for all members» y su fecha (`asOf`).
5. Cambiá `meta.verifiedOn` y guardá con **Commit changes**. Vercel republica solo.

`npm test` valida el archivo: coherencia DEG/US$, saldo ≤ desembolsado ≤ acordado, fechas, estados, enlaces a dominios oficiales, que los 17 países estén clasificados y que la suma de saldos de Argentina coincida con la tabla del FMI.

Tablas del FMI usadas: [Credit Outstanding](https://www.imf.org/external/np/fin/tad/extcred2.aspx), «History of Lending Commitments» y «Transactions with the Fund» por país (se abren desde los enlaces de cada fila).

## Puesta en marcha

```bash
npm install
npm test
npm run update-data        # regenera los snapshots (--only=embi | --only=ratings | --only=macro)
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
