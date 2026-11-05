(function () {
"use strict";
const $ = (id) => document.getElementById(id);
const NAMES = { VIIRS_NOAA20_NRT: "VIIRS NOAA-20", VIIRS_NOAA21_NRT: "VIIRS NOAA-21", VIIRS_SNPP_NRT: "VIIRS S-NPP" };
const COLORS = ["#38bdf8", "#3ddc97", "#f5a524", "#c084fc"];
const nf = new Intl.NumberFormat("en-GB");
const name = (s) => NAMES[s] || s;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
let rows = [], meta = {}, grid = null, charts = {}, map, layer;

function warn(msg) { const a = $("alert"); a.hidden = false; a.textContent = msg; }
async function getJSON(path) {
  const r = await fetch(path, { cache: "no-cache" });
  if (!r.ok) throw new Error(path + " returned HTTP " + r.status);
  return r.json();
}

// ---- validation: returns clean rows, drops malformed entries and reports them
function parseCounts(j) {
  if (!j || typeof j.data !== "object" || j.data === null) throw new Error("daily_counts.json has no 'data' object.");
  const out = []; let bad = 0;
  for (const [src, days] of Object.entries(j.data)) {
    for (const [d, v] of Object.entries(days || {})) {
      const ok = DATE_RE.test(d) && v && [v.detections, v.high_confidence, v.frp_mw_sum].every((x) => Number.isFinite(x) && x >= 0);
      if (ok) out.push({ src, date: d, detections: v.detections, high_confidence: v.high_confidence, frp_mw_sum: v.frp_mw_sum });
      else bad++;
    }
  }
  if (bad) warn(bad + " malformed record(s) in daily_counts.json were ignored.");
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
const sum = (a, k) => a.reduce((t, r) => t + r[k], 0);
const uniq = (a) => [...new Set(a)].sort();
const isPartial = (d) => !!meta.updated_utc && meta.updated_utc.slice(0, 10) === d;
const chartDefaults = () => { Chart.defaults.color = "#8a9bb0"; Chart.defaults.borderColor = "#1f2c3f"; };
function draw(id, cfg) { if (charts[id]) charts[id].destroy(); charts[id] = new Chart($(id), cfg); }
const axis = (title) => ({ title: { display: true, text: title }, grid: { color: "#1f2c3f" } });

// ---- overview
function overview() {
  const dates = uniq(rows.map((r) => r.date)), latest = dates[dates.length - 1];
  $("k-total").textContent = nf.format(sum(rows, "detections"));
  $("k-total-sub").textContent = "VIIRS detections, " + dates[0] + " to " + latest;
  $("k-date").textContent = latest;
  $("k-date-sub").textContent = isPartial(latest) ? "partial day (still accumulating)" : "complete UTC day";
  $("k-span").textContent = dates.length;
  const upd = meta.updated_utc ? new Date(meta.updated_utc) : null;
  const dot = document.querySelector("#k-fresh .dot"), txt = document.querySelector("#k-fresh span");
  if (upd && !isNaN(upd)) {
    const h = (Date.now() - upd) / 36e5;
    dot.className = "dot " + (h <= 9 ? "ok" : h <= 24 ? "warn" : "bad");
    txt.textContent = h < 1 ? "<1 h ago" : Math.round(h) + " h ago";
    $("k-fresh-sub").textContent = "last ingestion " + meta.updated_utc.replace("T", " ").replace("Z", " UTC") + " (updates every 6 h)";
    $("f-updated").textContent = "Last updated " + meta.updated_utc + ".";
  } else { txt.textContent = "unknown"; $("k-fresh-sub").textContent = "no update timestamp in data"; }

  const per = dates.map((d) => sum(rows.filter((r) => r.date === d), "detections"));
  draw("c-trend", { type: "line", data: { labels: dates, datasets: [{ label: "Detections", data: per, borderColor: "#3ddc97", backgroundColor: "rgba(61,220,151,.15)", fill: true, tension: .25,
    pointBackgroundColor: dates.map((d) => (isPartial(d) ? "#f5a524" : "#3ddc97")), pointRadius: 5 }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: (c) => (isPartial(dates[c.dataIndex]) ? "Partial day" : "") } } },
      scales: { y: Object.assign(axis("Detections per UTC day"), { beginAtZero: true }), x: axis("Observation date (UTC)") } } });
  const srcs = uniq(rows.map((r) => r.src));
  draw("c-share", { type: "doughnut", data: { labels: srcs.map(name), datasets: [{ data: srcs.map((s) => sum(rows.filter((r) => r.src === s), "detections")), backgroundColor: COLORS, borderColor: "#121b28" }] },
    options: { maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } } });
}

// ---- analytics
function filtered() {
  const f = $("a-from").value, t = $("a-to").value;
  return rows.filter((r) => (!f || r.date >= f) && (!t || r.date <= t));
}
const METRIC_LABEL = { detections: "Detections (count)", high_confidence: "High-confidence detections (count)", frp_mw_sum: "FRP sum (MW)" };
function analytics() {
  const m = $("a-metric").value, data = filtered(), dates = uniq(data.map((r) => r.date)), srcs = uniq(rows.map((r) => r.src));
  draw("c-daily", { type: "bar", data: { labels: dates, datasets: srcs.map((s, i) => ({ label: name(s), backgroundColor: COLORS[i % 4],
    data: dates.map((d) => (data.find((r) => r.src === s && r.date === d) || { [m]: 0 })[m]) })) },
    options: { maintainAspectRatio: false, scales: { x: Object.assign(axis("Observation date (UTC)"), { stacked: false }), y: Object.assign(axis(METRIC_LABEL[m]), { beginAtZero: true }) } } });
  draw("c-cmp", { type: "bar", data: { labels: srcs.map(name), datasets: [{ label: METRIC_LABEL[m], data: srcs.map((s) => sum(data.filter((r) => r.src === s), m)), backgroundColor: COLORS }] },
    options: { maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: Object.assign(axis("Total, " + METRIC_LABEL[m]), { beginAtZero: true }) } } });
  $("a-note").textContent = dates.length
    ? "Range " + dates[0] + " to " + dates[dates.length - 1] + " (" + dates.length + " days). Historical trends are limited to the days stored so far; the record grows with each ingestion run."
    : "No data in the selected range.";
}
function csv() {
  const lines = ["date_utc,satellite,detections,high_confidence,frp_mw_sum"].concat(filtered().map((r) => [r.date, r.src, r.detections, r.high_confidence, r.frp_mw_sum].join(",")));
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n") + "\n"], { type: "text/csv" }));
  a.download = "earth-intelligence-firms.csv"; a.click(); URL.revokeObjectURL(a.href);
}

// ---- map
function fill(sel, items) { sel.innerHTML = ""; items.forEach(([v, t]) => sel.add(new Option(t, v))); }
function initMap() {
  map = L.map("mapbox", { worldCopyJump: true, minZoom: 1, preferCanvas: true }).setView([20, 10], 2);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", { attribution: "© OpenStreetMap contributors © CARTO", maxZoom: 10 }).addTo(map);
  layer = L.layerGroup().addTo(map);
  const msg = $("map-msg");
  if (!grid || !grid.sources || !Object.keys(grid.sources).length) {
    msg.hidden = false;
    msg.innerHTML = "<div><b>No hotspot locations available yet.</b><br>The stored data so far contains only daily counts. The updated ingestion script saves gridded hotspot locations to <code>data/firms/grid.json</code> on its next run; markers will then appear here. No locations are estimated or invented.</div>";
    return;
  }
  const srcs = Object.keys(grid.sources), dates = uniq(srcs.flatMap((s) => Object.keys(grid.sources[s])));
  fill($("m-sat"), [["all", "All satellites"]].concat(srcs.map((s) => [s, name(s)])));
  fill($("m-date"), [["all", "All stored dates"]].concat(dates.slice().reverse().map((d) => [d, d + (isPartial(d) ? " (partial)" : "")])));
  $("m-date").value = dates[dates.length - 1];
  $("m-sat").onchange = $("m-date").onchange = paint;
  map.on("moveend", viewCount);
  paint();
}
function color(n, max) { const t = Math.log(1 + n) / Math.log(1 + max); return t > .75 ? "#ef5b5b" : t > .5 ? "#f5a524" : t > .25 ? "#3ddc97" : "#38bdf8"; }
let cells = [];
function paint() {
  const sat = $("m-sat").value, day = $("m-date").value, acc = new Map();
  for (const [s, days] of Object.entries(grid.sources)) {
    if (sat !== "all" && s !== sat) continue;
    for (const [d, list] of Object.entries(days)) {
      if (day !== "all" && d !== day) continue;
      for (const c of list) {
        if (!Array.isArray(c) || c.length < 4 || !c.every(Number.isFinite)) continue;
        const k = c[0] + "," + c[1], p = acc.get(k) || [c[0], c[1], 0, 0];
        p[2] += c[2]; p[3] += c[3]; acc.set(k, p);
      }
    }
  }
  cells = [...acc.values()]; layer.clearLayers();
  const h = (grid.meta && grid.meta.cell_deg ? grid.meta.cell_deg : 2) / 2, max = Math.max(1, ...cells.map((c) => c[2]));
  for (const c of cells) {
    L.rectangle([[c[0] - h, c[1] - h], [c[0] + h, c[1] + h]], { stroke: false, fillColor: color(c[2], max), fillOpacity: .65 })
      .bindPopup("<b>" + nf.format(c[2]) + " detections</b><br>FRP sum " + nf.format(Math.round(c[3])) + " MW<br>Cell " + (c[0] - h) + "° to " + (c[0] + h) + "° N, " + (c[1] - h) + "° to " + (c[1] + h) + "° E").addTo(layer);
  }
  viewCount();
}
function viewCount() {
  const b = map.getBounds(), n = cells.filter((c) => b.contains([c[0], c[1]])).reduce((t, c) => t + c[2], 0);
  $("m-view").textContent = nf.format(n) + " detections in view · " + nf.format(sum(cells.map((c) => ({ n: c[2] })), "n")) + " shown in total";
}

// ---- framework sections (no data shown)
function frameworks() {
  [["Global temperature anomalies", "NASA GISTEMP"], ["Atmospheric CO₂", "NOAA Global Monitoring Laboratory"], ["Arctic & Antarctic sea ice", "NSIDC sea ice index"],
   ["Precipitation & drought", "Global precipitation and drought indices"], ["Vegetation & land degradation", "Satellite vegetation indices"]].forEach(([t, s]) => {
    const d = document.createElement("div"); d.className = "card env";
    d.innerHTML = "<h3></h3><p class='muted'></p><span class='tag'>Not yet integrated</span>";
    d.querySelector("h3").textContent = t; d.querySelector("p").textContent = "Planned source: " + s; $("env-cards").append(d);
  });
  const days = uniq(rows.map((r) => r.date)).length;
  $("f-status").textContent = "No forecasts are shown. The stored record currently spans " + days + " day(s) of one dataset, which is not enough to build or backtest a 24-month forecast.";
}

async function main() {
  chartDefaults();
  try { const j = await getJSON("data/firms/daily_counts.json"); meta = j.meta || {}; rows = parseCounts(j); if (!rows.length) throw new Error("no valid records"); }
  catch (e) { warn("Could not load FIRMS data (" + e.message + "). Charts are unavailable."); frameworks(); return; }
  try { grid = await getJSON("data/firms/grid.json"); } catch (e) { grid = null; }
  const dates = uniq(rows.map((r) => r.date));
  ["a-from", "a-to"].forEach((id) => { $(id).min = dates[0]; $(id).max = dates[dates.length - 1]; });
  $("a-from").value = dates[0]; $("a-to").value = dates[dates.length - 1];
  ["a-from", "a-to", "a-metric"].forEach((id) => $(id).addEventListener("change", analytics));
  $("a-csv").addEventListener("click", csv);
  overview(); analytics(); frameworks(); initMap();
}
main();
})();
