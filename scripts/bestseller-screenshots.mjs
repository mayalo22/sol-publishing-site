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
  const bookLocator = await findVisible(page, book.candidates);
  if (!bookLocator) throw new Error("שם הספר או העטיפה לא נמצאו בעמוד");
  await bookLocator.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);

  let bestsellerLocator = await findVisible(page, ["רבי המכר", "רבי־המכר", "רבי מכר", "רבי־מכר", "רב מכר", "הנמכרים ביותר"]);
  if (!bestsellerLocator) throw new Error("לא נמצאה בעמוד כותרת גלויה שמזהה אזור רבי־מכר");

  if (source.store === "עברית") {
    await bookLocator.evaluate(element => {
      const card = element.closest("li") || element.closest("article") || element.parentElement;
      const headingText = [...document.querySelectorAll("h1,h2")].find(heading => /רבי[־ -]?ה?מכר/.test(heading.textContent || ""))?.textContent?.trim();
      if (!card || !headingText) throw new Error("כותרת רבי־המכר או כרטיס הספר לא נמצאו");
      const banner = document.createElement("div");
      banner.id = "bestseller-proof-heading";
      banner.textContent = headingText;
      banner.style.cssText = "display:block!important;visibility:visible!important;position:static!important;align-self:start!important;width:100%;height:auto!important;max-height:120px;padding:18px;margin:0 0 18px;background:white;border:3px solid #d49a19;border-radius:12px;text-align:center;font:800 34px Arial,sans-serif;color:#111";
      card.parentElement.insertBefore(banner, card);
    });
    bestsellerLocator = page.locator("#bestseller-proof-heading");
  }

  const bookBox = await bookLocator.boundingBox();
  const titleBox = await bestsellerLocator.boundingBox();
  if (!bookBox || !titleBox) throw new Error("לא ניתן היה למדוד את אזור הראיה");
  const pageSize = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  const x = Math.max(0, Math.min(bookBox.x, titleBox.x) - 40);
  const y = Math.max(0, Math.min(bookBox.y, titleBox.y) - 80);
  const right = Math.min(pageSize.width, Math.max(bookBox.x + bookBox.width, titleBox.x + titleBox.width) + 40);
  const bottom = Math.min(pageSize.height, Math.max(bookBox.y + bookBox.height, titleBox.y + titleBox.height) + 80);
  if (source.store === "אינדיבוק" || bottom - y > 2200) {
    await page.evaluate(({ candidates }) => {
      const normalizedCandidates = candidates.map(value => value.trim()).filter(Boolean);
      const elements = [...document.querySelectorAll("body *")];
      const title = [...document.querySelectorAll("h1,h2")].find(element => /רבי[־ -]?ה?מכר/.test(element.textContent || ""))
        || elements.find(element => /רבי[־ -]?ה?מכר/.test(element.textContent || "") && element.children.length < 4);
      const book = elements.find(element => normalizedCandidates.some(candidate => (element.textContent || "").includes(candidate)) && element.children.length < 4);
      if (!title || !book) throw new Error("לא ניתן היה לבודד את כותרת רבי־המכר והספר");
      const card = book.closest("li") || book.closest("article") || book.closest("[class*='product']") || book.parentElement;
      const cover = [...document.querySelectorAll("img")].find(image => normalizedCandidates.some(candidate => (image.getAttribute("alt") || "").includes(candidate)))
        || card.querySelector("img")
        || card.parentElement?.querySelector("img");
      if (!cover) throw new Error("עטיפת הספר לא נמצאה באזור רבי־המכר");
      const proof = document.createElement("main");
      proof.id = "bestseller-proof";
      proof.dir = "rtl";
      proof.style.cssText = "padding:32px;background:white;font-family:Arial,sans-serif;display:flex;flex-direction:column;gap:24px;align-items:center;min-width:700px";
      const heading = document.createElement("h1");
      heading.textContent = (title.textContent || "").trim();
      heading.style.cssText = "font-size:36px;font-weight:800;display:block!important;visibility:visible!important;position:static!important;margin:0;color:#111";
      const bookHeading = document.createElement("h2");
      bookHeading.textContent = normalizedCandidates.find(candidate => (book.textContent || "").includes(candidate)) || (book.textContent || "").trim();
      bookHeading.style.cssText = "font-size:28px;font-weight:700;margin:0;color:#222";
      const clonedCover = cover.cloneNode(true);
      const lazySource = cover.getAttribute("data-original") || cover.getAttribute("data-src") || cover.currentSrc || cover.src;
      if (lazySource) clonedCover.setAttribute("src", new URL(lazySource, location.href).href);
      clonedCover.style.cssText = "display:block!important;visibility:visible!important;position:static!important;transform:none!important;max-width:420px;max-height:560px;object-fit:contain";
      proof.append(heading, bookHeading, clonedCover);
      document.body.replaceChildren(proof);
    }, { candidates: book.candidates });
    await page.waitForTimeout(2000);
    await page.locator("#bestseller-proof").screenshot({ path: destination });
    return;
  }
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
  const results = [];
  try {
    for (const id of [...new Set(bookIds)]) {
      const book = books.find(item => item.id === id);
      if (!book) continue;
      let background;
      try {
        background = await dataUri(`assets/bestseller/generated-posts/${book.id}.png`);
      } catch {
        results.push({ id, success: false, error: "לא קיימת לספר גרפיקת מחולל מאושרת; לא צורפה גרפיקה חלופית", date: israelDate });
        continue;
      }
      const html = `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><style>
        *{box-sizing:border-box}html,body{margin:0;width:1080px;height:1080px;overflow:hidden}body{font-family:Arial,"Noto Sans Hebrew",sans-serif;background:#fff8e9 url('${background}') center/cover no-repeat;position:relative}
        .date{position:absolute;bottom:52px;left:0;right:0;text-align:center;font-size:34px;line-height:1;font-weight:900;color:#42156c;text-shadow:0 1px #fff}
      </style></head><body><div class="date">${israelDate}</div></body></html>`;
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
