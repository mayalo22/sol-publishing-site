import { mkdir, readFile, writeFile } from "node:fs/promises";

const dataUrl = new URL("../data.json", import.meta.url);
const coversDir = new URL("../assets/covers/", import.meta.url);
const publisherUrl = "https://www.e-vrit.co.il/Publisher/3051/%D7%A1%D7%95%D7%9C";
const headers = { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36", "accept-language": "he-IL,he;q=0.9,en;q=0.7" };

const productSources = {
  "31855": { steimatzky: "https://www.steimatzky.co.il/012010346" },
  "38170": { booknet: "https://www.booknet.co.il/מוצרים/לא-אוותר-לעולם--מעיין-גלעד", steimatzky: "https://www.steimatzky.co.il/012010524" },
  "38171": { booknet: "https://www.booknet.co.il/מוצרים/בין-בריחה-לאהבה-1-160100000024", steimatzky: "https://www.steimatzky.co.il/012010525" },
  "39393": { booknet: "https://www.booknet.co.il/מוצרים/אאמין-לך-1-160100000031", steimatzky: "https://www.steimatzky.co.il/012010555" },
  "39416": { booknet: "https://www.booknet.co.il/מוצרים/הדרקון-היהודי-160100000055", steimatzky: "https://www.steimatzky.co.il/012010556" },
  "39508": { booknet: "https://www.booknet.co.il/מוצרים/קוצים-160100000048", steimatzky: "https://www.steimatzky.co.il/012010557" },
  "39908": { booknet: "https://www.booknet.co.il/מוצרים/כוכבים-רואים-רק-בחושך-160100000079", steimatzky: "https://www.steimatzky.co.il/012010569" },
  "40126": { booknet: "https://www.booknet.co.il/מוצרים/הטעם-החמישי-160100000062" }
};

async function fetchResource(url) {
  const response = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(45000) });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response;
}

function extractProducts(html) {
  const marker = 'initialProducts\\":';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("initialProducts was not found on the publisher page");
  const arrayStart = start + marker.length;
  const end = html.indexOf('],\\"listId\\"', arrayStart);
  if (end < 0) throw new Error("Could not find the end of initialProducts");
  return JSON.parse(JSON.parse(`"${html.slice(arrayStart, end + 1)}"`));
}

const slug = value => value.trim().replace(/\s+/g, "-");
const coverRemoteUrl = imagePath => `https://images.e-vrit.co.il/cdn-cgi/image/width=760,format=jpg,quality=88/${imagePath.replace(/\/Image_([^/]+)$/i, "/$1")}`;

function evritPricing(productPricing = {}) {
  const map = { digital: productPricing.DigitalPricing, print: productPricing.PrintedPricing, audio: productPricing.AudioPricing };
  return Object.fromEntries(Object.entries(map).filter(([, value]) => value?.priceFinal).map(([key, value]) => [key, { price: Number(value.priceFinal), priceBefore: value.priceBefore == null ? null : Number(value.priceBefore) }]));
}

function cleanText(html) {
  return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ").replace(/&quot;/gi, '"').replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function productText(html, title) {
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  const heading = headings.find(match => cleanText(match[1]).includes(title)) || headings.at(-1);
  const start = heading?.index ?? Math.max(0, html.indexOf(title));
  return cleanText(html.slice(start, start + 18000));
}

function priceNear(text, labels) {
  for (const label of labels) {
    const index = text.indexOf(label);
    if (index < 0) continue;
    const after = text.slice(index + label.length, index + label.length + 105);
    const nextFormat = after.search(/(?:ספר\s*)?(?:דיגיטלי|מודפס|קולי)|תקציר/);
    const section = nextFormat > 0 ? after.slice(0, nextFormat) : after.slice(0, 58);
    const values = [...section.matchAll(/(\d+(?:\.\d+)?)\s*₪/g)].map(match => Number(match[1])).filter(value => value > 0 && value < 400);
    if (values.length) return { price: values.at(-1), priceBefore: values.length > 1 && values[0] > values.at(-1) ? values[0] : null };
  }
  return null;
}

function parseSteimatzky(html) {
  const result = {};
  const labels = { digital: "ספר דיגיטלי", print: "ספר מודפס", audio: "ספר קולי" };
  for (const [format, label] of Object.entries(labels)) {
    const start = html.search(new RegExp(`<div class="title">\\s*${label}`));
    if (start < 0) continue;
    const block = html.slice(start, start + 6500);
    const current = block.match(/data-price-amount="([\d.]+)"\s*data-price-type="finalPrice"/);
    const old = block.match(/data-price-amount="([\d.]+)"\s*data-price-type="oldPrice"/);
    if (current && Number(current[1]) > 0) result[format] = { store: "סטימצקי", price: Number(current[1]), priceBefore: old && Number(old[1]) > Number(current[1]) ? Number(old[1]) : null };
  }
  return result;
}

function parseFormats(html, title, store) {
  const text = productText(html, title);
  const labels = { digital: ["ספר דיגיטלי", "דיגיטלי"], print: ["ספר מודפס", "מודפס"], audio: ["ספר קולי", "קולי"] };
  const result = {};
  for (const [format, formatLabels] of Object.entries(labels)) {
    const price = priceNear(text, formatLabels);
    if (price) result[format] = { store, ...price };
  }
  return result;
}

function addOffer(offers, format, offer, url) {
  if (!offer?.price || !url) return;
  (offers[format] ||= []).push({ ...offer, url });
}

async function storeOffers(product, evritUrl, previous = {}) {
  const offers = {};
  for (const [format, price] of Object.entries(evritPricing(product.ProductPricing))) addOffer(offers, format, { store: "עברית", ...price }, evritUrl);
  const title = product.ProductName.replace(/^הכוכבים\s*1\s*-\s*/, "");
  const titleSlug = slug(title);
  const sources = productSources[String(product.ProductID)] || {};
  const stores = [
    { key: "bbooks", name: "ביבוקס", url: `https://bbooks.co.il/book/${titleSlug}`, parse: (html) => parseFormats(html, title, "ביבוקס") },
    { key: "indiebook", name: "אינדיבוק", url: `https://indiebook.co.il/shop/${titleSlug}`, parse: (html) => {
      const parsed = parseFormats(html, title, "אינדיבוק");
      if (!parsed.digital) {
        const text = productText(html, title); const match = text.match(/(\d+(?:\.\d+)?)\s*₪/);
        if (match) parsed.digital = { store: "אינדיבוק", price: Number(match[1]), priceBefore: null };
      }
      return parsed;
    }},
    ...(sources.booknet ? [{ key: "booknet", name: "צומת ספרים", url: sources.booknet, parse: (html) => {
      const parsed = parseFormats(html, title, "צומת ספרים");
      if (!parsed.print) { const text = productText(html, title); const match = text.match(/(?:מחיר באתר|מחיר מכירה מודפס|מחיר נוכחי)\D{0,25}(\d+(?:\.\d+)?)/); if (match) parsed.print = { store: "צומת ספרים", price: Number(match[1]), priceBefore: null }; }
      return parsed;
    }}] : []),
    ...(sources.steimatzky ? [{ key: "steimatzky", name: "סטימצקי", url: sources.steimatzky, parse: parseSteimatzky }] : [])
  ];
  await Promise.all(stores.map(async source => {
    try {
      const html = await (await fetchResource(source.url)).text();
      const parsed = source.parse(html);
      for (const [format, offer] of Object.entries(parsed)) addOffer(offers, format, offer, source.url);
    } catch (error) {
      console.warn(`${source.name} failed for ${title}: ${error.message}`);
      for (const [format, oldOffers] of Object.entries(previous || {})) {
        const old = oldOffers.find(offer => offer.store === source.name);
        if (old) addOffer(offers, format, old, old.url);
      }
    }
  }));
  return offers;
}

async function saveCover(product) {
  const remote = coverRemoteUrl(product.Image);
  const relative = `assets/covers/${product.ProductID}.jpg`;
  try { const response = await fetchResource(remote); await writeFile(new URL(`../${relative}`, import.meta.url), Buffer.from(await response.arrayBuffer())); return relative; }
  catch (error) { console.warn(`Keeping remote cover for ${product.ProductName}: ${error.message}`); return remote; }
}

const existing = JSON.parse(await readFile(dataUrl, "utf8"));
await mkdir(coversDir, { recursive: true });
const products = extractProducts(await (await fetchResource(publisherUrl)).text());
if (!products.length) throw new Error("The publisher page returned an empty catalog");

const books = [];
for (const product of products) {
  const title = product.ProductName.replace(/^הכוכבים\s*1\s*-\s*/, "");
  const url = `https://www.e-vrit.co.il/product/${product.ProductID}/${encodeURIComponent(slug(title))}`;
  const previous = existing.books?.find(book => String(book.id) === String(product.ProductID));
  books.push({
    id: String(product.ProductID), title, sourceTitle: product.ProductName,
    author: product.Authors?.map(author => author.Name).join(", ") || "הוצאת סול",
    description: product.ShortDescription?.trim() || "ספרות רומנטית ישראלית מבית הוצאת סול.",
    cover: await saveCover(product), url, year: product.PublishYear, month: product.PublishMonth,
    pages: product.NumOfPages ? Number(product.NumOfPages) : null,
    categories: product.Categories?.map(category => category.Name) || [], pricing: evritPricing(product.ProductPricing),
    offers: await storeOffers(product, url, previous?.offers),
    sales: Number(product.AllTimeOrders) || 0,
    reviews: { count: Number(product.CountReviews) || 0, average: Number(product.AvgReviews) || 0 },
    themeColor: product.ThemeColor || "#D88972"
  });
}

books.sort((a, b) => (a.year - b.year) || (a.month - b.month) || (Number(a.id) - Number(b.id)));
const next = { ...existing, updatedAt: new Date().toISOString(), sourceUrl: publisherUrl, stores: ["עברית", "ביבוקס", "סטימצקי", "צומת ספרים", "אינדיבוק"], books };
await writeFile(dataUrl, `${JSON.stringify(next, null, 2)}\n`, "utf8");
console.log(`Updated ${books.length} books and compared five stores at ${next.updatedAt}`);
