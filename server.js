// Aktienrechner Web-System: statische Seite + /api/radar (Kurse und Nachrichten, 5 Minuten Cache)
// Läuft ohne zusätzliche Pakete auf Node.js 18 oder neuer: node server.js
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const TTL = 5 * 60 * 1000;
const UA = { "user-agent": "Mozilla/5.0 (Aktienrechner)" };

// Hier Aktien ergänzen oder entfernen. y = Yahoo-Symbol, q = Suchbegriff für Nachrichten.
const STOCKS = [
  { id: "apple", name: "Apple", ticker: "AAPL", y: "AAPL", q: "Apple Aktie" },
  { id: "microsoft", name: "Microsoft", ticker: "MSFT", y: "MSFT", q: "Microsoft Aktie" },
  { id: "nvidia", name: "NVIDIA", ticker: "NVDA", y: "NVDA", q: "NVIDIA Aktie" },
  { id: "alphabet", name: "Alphabet", ticker: "GOOGL", y: "GOOGL", q: "Alphabet Aktie" },
  { id: "sap", name: "SAP", ticker: "SAP", y: "SAP.DE", q: "SAP Aktie" },
  { id: "siemens", name: "Siemens", ticker: "SIE", y: "SIE.DE", q: "Siemens Aktie" },
  { id: "allianz", name: "Allianz", ticker: "ALV", y: "ALV.DE", q: "Allianz Aktie" },
  { id: "amazon", name: "Amazon", ticker: "AMZN", y: "AMZN", q: "Amazon Aktie" },
  { id: "tesla", name: "Tesla", ticker: "TSLA", y: "TSLA", q: "Tesla Aktie" },
  { id: "coca-cola", name: "Coca-Cola", ticker: "KO", y: "KO", q: "Coca-Cola Aktie" },
  { id: "msci-world", name: "iShares Core MSCI World ETF", ticker: "EUNL", y: "EUNL.DE", q: "MSCI World ETF" },
];

// Kursquelle: inoffizielle Yahoo-Finance-Schnittstelle (ohne Schlüssel, ca. 15 Minuten verzögert).
// Wenn du einen Anbieter mit API-Schlüssel nutzen willst, ersetze nur diese Funktion.
async function getQuote(s) {
  const url = "https://query1.finance.yahoo.com/v8/finance/chart/" + encodeURIComponent(s.y) + "?range=5d&interval=1d";
  const j = await (await fetch(url, { headers: UA })).json();
  const r = j.chart && j.chart.result && j.chart.result[0];
  if (!r) throw new Error("keine Daten");
  const closes = (r.indicators.quote[0].close || []).filter((x) => x != null);
  const price = r.meta.regularMarketPrice;
  const prev = closes.length > 1 ? closes[closes.length - 2] : r.meta.chartPreviousClose;
  return {
    price: price,
    currency: r.meta.currency,
    changePct: prev ? Math.round((price / prev - 1) * 10000) / 100 : undefined,
    asOf: new Date(r.meta.regularMarketTime * 1000).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" }) + " Uhr",
  };
}

const clean = (t) => t.replace(/<!\[CDATA\[|\]\]>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

// Nachrichten: Google-News-RSS (ohne Schlüssel)
async function getNews(s) {
  const url = "https://news.google.com/rss/search?q=" + encodeURIComponent(s.q) + "&hl=de&gl=DE&ceid=DE:de";
  const xml = await (await fetch(url, { headers: UA })).text();
  const items = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(xml)) && items.length < 3) {
    const pick = (tag) => { const x = new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">").exec(m[1]); return x ? clean(x[1]) : ""; };
    const source = pick("source");
    let title = pick("title");
    if (source && title.endsWith(" - " + source)) title = title.slice(0, -(source.length + 3));
    const link = pick("link");
    if (title && link.startsWith("https://")) items.push({ title, source, url: link });
  }
  return items;
}

async function build() {
  const items = await Promise.all(STOCKS.map(async (s) => {
    const o = { id: s.id, name: s.name, ticker: s.ticker, live: "https://finance.yahoo.com/quote/" + s.y, news: [] };
    const [q, n] = await Promise.allSettled([getQuote(s), getNews(s)]);
    if (q.status === "fulfilled") Object.assign(o, q.value);
    if (n.status === "fulfilled") o.news = n.value;
    return o;
  }));
  return { updatedAt: new Date().toISOString(), items };
}

let cache = { at: 0, data: null, pending: null };
async function radar() {
  if (cache.data && Date.now() - cache.at < TTL) return cache.data;
  if (!cache.pending) {
    cache.pending = build().then((d) => { cache = { at: Date.now(), data: d, pending: null }; return d; })
      .catch((e) => { cache.pending = null; if (cache.data) return cache.data; throw e; });
  }
  return cache.pending;
}

const server = http.createServer(async (req, res) => {
  const p = req.url.split("?")[0];
  try {
    if (p === "/api/radar") {
      const d = await radar();
      res.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
      return res.end(JSON.stringify(d));
    }
    if (p === "/" || p === "/index.html") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      const f = [path.join(__dirname, "public", "index.html"), path.join(__dirname, "index.html")].find(fs.existsSync);
      return res.end(fs.readFileSync(f));
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Nicht gefunden");
  } catch (e) {
    res.writeHead(502, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Kursdaten nicht erreichbar" }));
  }
});

if (require.main === module) server.listen(PORT, () => console.log("Aktienrechner läuft auf http://localhost:" + PORT));
module.exports = { build, getQuote, getNews };
