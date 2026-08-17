import { mkdir, copyFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

const safeName = value => String(value).normalize("NFKD").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").trim().slice(0, 90);

async function findVisible(page, texts) {
  for (const text of texts.filter(Boolean)) {
    const locator = page.getByText(text, { exact: false });
    const count = Math.min(await locator.count(), 20);
    for (let index = 0; index < count; index += 1) {
      const item = locator.nth(index);
      if (await item.isVisible().catch(() => false)) return item;
    }
  }
  return null;
}

async function screenshotEvidence(page, source, book, destination) {
  await page.goto(source.url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForTimeout(5000);
  if (source.store === "ביבוקס") {
    let section = page.locator("#menu-4-container");
    if (!await section.count()) throw new Error("אזור רבי־המכר של ביבוקס לא נמצא בעמוד");
    await section.evaluate(element => {
      const clone = element.cloneNode(true);
      document.body.replaceChildren(clone);
      document.body.style.margin = "24px";
      clone.style.setProperty("display", "block", "important");
      clone.style.setProperty("visibility", "visible", "important");
      clone.style.setProperty("position", "static", "important");
      clone.style.setProperty("padding", "30px", "important");
      clone.querySelectorAll("*").forEach(child => child.style.setProperty("visibility", "visible", "important"));
      clone.querySelectorAll(".product-cube").forEach(child => child.style.setProperty("display", "block", "important"));
      clone.querySelectorAll(".row").forEach(child => {
        child.style.setProperty("display", "flex", "important");
        child.style.setProperty("flex-wrap", "wrap", "important");
      });
    });
    section = page.locator("#menu-4-container");
    const title = await findVisible(section, book.candidates);
    if (!title) throw new Error("שם הספר או העטיפה לא נמצאו באזור רבי־המכר של ביבוקס");
    await section.locator("img").evaluateAll(images => images.forEach(image => {
      const lazySource = image.getAttribute("data-original") || image.getAttribute("data-src");
      if (lazySource) image.setAttribute("src", lazySource);
    }));
    await page.waitForTimeout(1500);
    await section.screenshot({ path: destination });
    return;
  }
  const bookLocator = await findVisible(page, book.candidates);
  if (!bookLocator) throw new Error("שם הספר או העטיפה לא נמצאו בעמוד");
  await bookLocator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);

  const bestsellerLocator = await findVisible(page, ["רבי מכר", "רבי־מכר", "רב מכר", "הנמכרים ביותר"]);
  if (!bestsellerLocator) throw new Error("לא נמצאה בעמוד כותרת גלויה שמזהה אזור רבי־מכר");

  const bookBox = await bookLocator.boundingBox();
  const titleBox = await bestsellerLocator.boundingBox();
  if (!bookBox || !titleBox) throw new Error("לא ניתן היה למדוד את אזור הראיה");
  const pageSize = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  const x = Math.max(0, Math.min(bookBox.x, titleBox.x) - 40);
  const y = Math.max(0, Math.min(bookBox.y, titleBox.y) - 80);
  const right = Math.min(pageSize.width, Math.max(bookBox.x + bookBox.width, titleBox.x + titleBox.width) + 40);
  const bottom = Math.min(pageSize.height, Math.max(bookBox.y + bookBox.height, titleBox.y + titleBox.height) + 80);
  if (bottom - y > 2200) throw new Error("כותרת רבי־המכר והספר רחוקים מדי לצילום ברור אחד");
  await page.screenshot({ path: destination, clip: { x, y, width: Math.max(1, right - x), height: Math.max(1, bottom - y) } });
}

export async function collectBestsellerEvidence({ sources, books, currentPairs, exitedPairs, attachmentsDir = ".bestseller-attachments", cacheDir = ".bestseller-proof-cache" }) {
  await rm(attachmentsDir, { recursive: true, force: true });
  await mkdir(attachmentsDir, { recursive: true });
  await mkdir(cacheDir, { recursive: true });
  const results = [];
  let chromium;
  try {
    ({ chromium } = require("playwright"));
  } catch (error) {
    return [...currentPairs, ...exitedPairs].map(pair => ({ ...pair, success: false, error: `מנוע הצילום אינו זמין: ${error.message}` }));
  }
  const browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {})
  });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, locale: "he-IL", timezoneId: "Asia/Jerusalem" });
  try {
    for (const pair of currentPairs) {
      const source = sources.find(item => item.store === pair.store);
      const book = books.find(item => String(item.id) === String(pair.id));
      const cacheName = `${pair.id}--${safeName(pair.store)}.png`;
      const cachedPath = path.join(cacheDir, cacheName);
      const attachmentName = `${safeName(book.title)} -- ${safeName(pair.store)} -- ראיית רבי-מכר.png`;
      const attachmentPath = path.join(attachmentsDir, attachmentName);
      const page = await context.newPage();
      try {
        await screenshotEvidence(page, source, book, attachmentPath);
        await copyFile(attachmentPath, cachedPath);
        results.push({ ...pair, success: true, attachmentName, kind: "current" });
      } catch (error) {
        results.push({ ...pair, success: false, error: error.message, kind: "current" });
      } finally {
        await page.close();
      }
    }
    for (const pair of exitedPairs) {
      const book = books.find(item => String(item.id) === String(pair.id));
      const cacheName = `${pair.id}--${safeName(pair.store)}.png`;
      const cachedPath = path.join(cacheDir, cacheName);
      const attachmentName = `${safeName(book?.title || pair.id)} -- ${safeName(pair.store)} -- ראיה אחרונה לפני יציאה.png`;
      try {
        await copyFile(cachedPath, path.join(attachmentsDir, attachmentName));
        results.push({ ...pair, success: true, attachmentName, kind: "previous" });
      } catch {
        results.push({ ...pair, success: false, error: "לא נשמר צילום תקין מהריצה הקודמת", kind: "previous" });
      }
    }
  } finally {
    await context.close();
    await browser.close();
  }
  return results;
}

const mimeFor = file => file.endsWith(".svg") ? "image/svg+xml" : file.endsWith(".png") ? "image/png" : "image/jpeg";
const dataUri = async file => `data:${mimeFor(file)};base64,${(await readFile(file)).toString("base64")}`;
const escapeHtml = value => String(value).replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

export async function createBestsellerSocialPosts({ books, bookIds, attachmentsDir = ".bestseller-attachments" }) {
  if (!bookIds.length) return [];
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
  const context = await browser.newContext({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1, timezoneId: "Asia/Jerusalem", locale: "he-IL" });
  const dateParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem", day: "numeric", month: "numeric", year: "numeric" }).formatToParts(new Date());
  const value = type => dateParts.find(part => part.type === type)?.value;
  const israelDate = `${value("day")}.${value("month")}.${value("year")}`;
  const logoFiles = { "ביבוקס": "assets/store-logos/bbooks.png", "עברית": "assets/store-logos/e-vrit.svg" };
  const results = [];
  try {
    for (const id of [...new Set(bookIds)]) {
      const book = books.find(item => item.id === id);
      if (!book) continue;
      const cover = await dataUri(book.cover);
      const logos = (await Promise.all(book.sources.filter(store => logoFiles[store]).map(async store => `<div class="source"><img src="${await dataUri(logoFiles[store])}" alt="${escapeHtml(store)}"><span>רב־מכר באתר ${escapeHtml(store)}</span></div>`))).join("");
      const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
        *{box-sizing:border-box}html,body{margin:0;width:1080px;height:1080px;overflow:hidden}body{font-family:Arial,"Noto Sans Hebrew",sans-serif;background:#fff8e9;color:#3f176b;position:relative}
        body:before,body:after{content:"";position:absolute;width:430px;height:430px;border-radius:48%;filter:blur(5px);opacity:.38;background:radial-gradient(circle at 35% 35%,#7c4aa8 0 10%,#b991cc 35%,transparent 70%)}body:before{left:-170px;top:-130px}body:after{right:-180px;bottom:-150px}
        .stars{position:absolute;inset:0;background-image:radial-gradient(#d49a19 1.8px,transparent 2px);background-size:66px 66px;opacity:.65}.wrap{position:relative;height:100%;padding:44px 62px;text-align:center}.kicker{font-size:40px;font-weight:800}.headline{font-size:84px;line-height:.95;font-weight:900;margin:15px 0 22px}.headline span{color:#bd7b00}.middle{display:flex;align-items:center;justify-content:center;gap:40px}.cover{height:650px;max-width:470px;object-fit:contain;border:8px solid white;outline:3px solid #d69b24;box-shadow:0 12px 30px #3f176b44}.medal{position:absolute;right:55px;top:250px;width:190px;height:190px;border-radius:50%;background:radial-gradient(circle at 35% 25%,#fff2a2,#e6a514 48%,#9b5b00);border:9px double #fff0a1;display:grid;place-items:center;color:#42156c;font-size:39px;font-weight:900;box-shadow:0 9px 16px #0004}.logos{position:absolute;left:38px;bottom:82px;display:flex;flex-direction:column;gap:12px;align-items:flex-start}.source{min-width:300px;height:74px;padding:8px 14px;background:#fff;border:3px solid #d69b24;border-radius:14px;display:flex;align-items:center;gap:12px;box-shadow:0 5px 14px #0002}.source img{width:100px;height:50px;object-fit:contain}.source span{font-size:25px;font-weight:900;color:#4a286a;white-space:nowrap}.date{position:absolute;bottom:25px;left:0;right:0;font-size:39px;font-weight:900;color:#3f176b}
      </style></head><body><div class="stars"></div><main class="wrap"><div class="kicker">מככבת השבוע</div><div class="headline">ברשימת <span>רבי־המכר!</span></div><div class="medal">רב־<br>מכר</div><div class="middle"><img class="cover" src="${cover}" alt="${escapeHtml(book.title)}"></div><div class="logos">${logos}</div><div class="date">${israelDate}</div></main></body></html>`;
      const page = await context.newPage();
      const attachmentName = `${book.id} -- ${safeName(book.title)} -- פוסט אינסטגרם -- ${israelDate}.png`;
      try {
        await page.setContent(html, { waitUntil: "load" });
        await page.screenshot({ path: path.join(attachmentsDir, attachmentName) });
        results.push({ id, success: true, attachmentName, date: israelDate });
      } catch (error) {
        results.push({ id, success: false, error: error.message, date: israelDate });
      } finally { await page.close(); }
    }
  } finally { await context.close(); await browser.close(); }
  return results;
}
