import { readFile, writeFile } from "node:fs/promises";
import { collectBestsellerEvidence, createBestsellerSocialPosts } from "./bestseller-screenshots.mjs";

const catalogUrl = process.env.CATALOG_URL || "https://mayalo22.github.io/sol-publishing-site/data.json";
const mode = process.argv[2] || "monitor";
const statePath = process.env.BESTSELLER_STATE_PATH || ".bestseller-state.json";
const emailPath = process.env.BESTSELLER_EMAIL_PATH || ".bestseller-email.txt";
const skipScreenshots = process.env.BESTSELLER_SKIP_SCREENSHOTS === "true";
const outputPath = process.env.GITHUB_OUTPUT;
const headers = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138 Safari/537.36",
  "accept-language": "he-IL,he;q=0.9,en;q=0.7"
};

const sources = [
  { store: "עברית", url: "https://www.e-vrit.co.il/category/34/רומן-רומנטי?orderby=3", products: true },
  { store: "ביבוקס", url: "https://bbooks.co.il/", section: true },
  { store: "אינדיבוק", url: "https://indiebook.co.il/31/רבי-מכר" }
];

const aliases = {
  "40819": ["דואט סודות וחטאים"],
  "40820": ["דואט סודות וחטאים"]
};

async function fetchResource(url) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers,
        redirect: "follow",
        signal: AbortSignal.timeout(45000)
      });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, attempt * 1500));
    }
  }
  throw lastError;
}

function extractProducts(html) {
  const marker = 'initialProducts\\":';
  const start = html.indexOf(marker);
  if (start < 0) throw new Error("initialProducts was not found");
  const arrayStart = start + marker.length;
  const end = html.indexOf('],\\"listId\\"', arrayStart);
  if (end < 0) throw new Error("initialProducts end was not found");
  return JSON.parse(JSON.parse(`"${html.slice(arrayStart, end + 1)}"`));
}

function cleanText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[־–—-]/g, " ")
    .replace(/[׳’']/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase("he");
}

async function loadSource(source) {
  const html = await (await fetchResource(source.url)).text();
  let text = source.products
    ? extractProducts(html).map(product => product.ProductName).join(" ")
    : cleanText(html);
  if (source.section) {
    const start = text.indexOf("רבי מכר");
    if (start < 0) throw new Error("The bestseller section was not found");
    text = text.slice(start, start + 5000);
  }
  return normalize(text);
}

async function loadPreviousState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function memberships(state) {
  return new Set((state?.books || []).flatMap(book => book.sources.map(store => `${book.id}\t${store}`)));
}

function formatCurrent(state) {
  const active = state.books.filter(book => book.sources.length);
  if (!active.length) return "אין בכלל ספרים ברבי מכר השבוע.";
  return active.map(book => `• ${book.title}: ${book.sources.join(", ")}`).join("\n");
}

function sourceLinks() {
  return sources.map(source => `• ${source.store}: ${source.url}`).join("\n");
}

async function setOutputs(values) {
  if (!outputPath) return;
  await writeFile(outputPath, Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { flag: "a" });
}

const catalog = await (await fetchResource(`${catalogUrl}${catalogUrl.includes("?") ? "&" : "?"}ts=${Date.now()}`)).json();
const books = (catalog.books || []).filter(book => !/^\s*(?:מארז|דואט)(?:\s|$)/.test(book.title));
const previous = await loadPreviousState();
const loaded = await Promise.all(sources.map(async source => {
  try {
    return [source.store, { success: true, text: await loadSource(source) }];
  } catch (error) {
    console.warn(`${source.store}: ${error.message}`);
    return [source.store, { success: false, error: error.message }];
  }
}));
const sourceResults = new Map(loaded);
const failedSources = sources.filter(source => !sourceResults.get(source.store)?.success).map(source => source.store);
const previousById = new Map((previous?.books || []).map(book => [String(book.id), book]));

const currentBooks = books.map(book => {
  const candidates = [book.title, book.sourceTitle, ...(aliases[String(book.id)] || [])]
    .map(normalize)
    .filter(candidate => candidate.length > 3);
  const previousSources = new Set(previousById.get(String(book.id))?.sources || []);
  const bookSources = sources.flatMap(source => {
    const result = sourceResults.get(source.store);
    if (!result?.success) return previousSources.has(source.store) ? [source.store] : [];
    return candidates.some(candidate => result.text.includes(candidate)) ? [source.store] : [];
  });
  return { id: String(book.id), title: book.title, cover: book.cover, sources: bookSources, candidates: [book.title, book.sourceTitle, ...(aliases[String(book.id)] || [])].filter(Boolean) };
});

const now = new Date();
const checkedAt = new Intl.DateTimeFormat("he-IL", {
  dateStyle: "full",
  timeStyle: "short",
  timeZone: "Asia/Jerusalem"
}).format(now);
const current = { version: 1, checkedAt: now.toISOString(), books: currentBooks };

if (mode === "monitor") {
  const before = memberships(previous);
  const after = memberships(current);
  const entered = [...after].filter(item => !before.has(item));
  const exited = [...before].filter(item => !after.has(item));
  const titleById = new Map(currentBooks.map(book => [book.id, book.title]));
  const formatChanges = items => items.length
    ? items.map(item => {
      const [id, store] = item.split("\t");
      return `• ${titleById.get(id) || previousById.get(id)?.title || id} — ${store}`;
    }).join("\n")
    : "אין";

  await writeFile(statePath, `${JSON.stringify(current, null, 2)}\n`, "utf8");
  if (!previous) {
    console.log("Initial bestseller baseline saved; no email will be sent.");
    await setOutputs({ send: "false", subject: "" });
  } else if (!entered.length && !exited.length) {
    console.log("No bestseller membership changes; no email will be sent.");
    await setOutputs({ send: "false", subject: "" });
  } else {
    const changedPairs = [...new Set([...entered, ...exited])].map(item => {
      const [id, store] = item.split("\t");
      return { id, store };
    });
    const enteredSet = new Set(entered);
    const evidence = skipScreenshots ? [] : await collectBestsellerEvidence({
      sources,
      books: currentBooks,
      currentPairs: changedPairs.filter(pair => enteredSet.has(`${pair.id}\t${pair.store}`)),
      exitedPairs: changedPairs.filter(pair => !enteredSet.has(`${pair.id}\t${pair.store}`))
    });
    const evidenceText = changedPairs.map(pair => {
      const title = titleById.get(pair.id) || previousById.get(pair.id)?.title || pair.id;
      const result = evidence.find(item => item.id === pair.id && item.store === pair.store);
      if (result?.success) return `• ${title} — ${pair.store}: ${result.kind === "previous" ? "מצורפת הראיה האחרונה שנשמרה לפני היציאה" : "מצורף צילום עדכני מאזור רבי־המכר"} (${result.attachmentName})`;
      return `• ${title} — ${pair.store}: לא ניתן היה לצלם הוכחה אמינה${result?.error ? ` (${result.error})` : ""}`;
    }).join("\n");
    const social = skipScreenshots ? [] : await createBestsellerSocialPosts({ books: currentBooks, bookIds: [...new Set(entered.map(item => item.split("\t")[0]))] });
    const socialText = social.length ? social.map(item => item.success ? `• ${titleById.get(item.id)}: מצורף פוסט אינסטגרם לתאריך ${item.date} (${item.attachmentName})` : `• ${titleById.get(item.id)}: לא ניתן היה ליצור פוסט (${item.error})`).join("\n") : "אין ספרים שנכנסו ולכן לא נוצר פוסט חדש.";
    const warning = failedSources.length
      ? `\n\nלא ניתן היה לאמת כרגע: ${failedSources.join(", ")}. הסטטוס הקודם נשמר עבור מקורות אלה כדי למנוע התראת יציאה שגויה.`
      : "";
    const body = `עדכון ברשימות רבי־המכר של הוצאת סול\n\nנכנסו לרבי־המכר:\n${formatChanges(entered)}\n\nיצאו מרבי־המכר:\n${formatChanges(exited)}\n\nראיות מצולמות:\n${evidenceText}\n\nפוסטים מוכנים לאינסטגרם:\n${socialText}\n\nהמצב הנוכחי:\n${formatCurrent(current)}${warning}\n\nזמן הבדיקה: ${checkedAt}\n\nמקורות:\n${sourceLinks()}\n`;
    await writeFile(emailPath, body, "utf8");
    await setOutputs({ send: "true", subject: `עדכון רבי־מכר של הוצאת סול — ${checkedAt.replace(/[\r\n]/g, " ")}` });
  }
} else if (mode === "weekly") {
  const currentPairs = currentBooks.flatMap(book => book.sources.map(store => ({ id: book.id, store })));
  const evidence = skipScreenshots ? [] : await collectBestsellerEvidence({ sources, books: currentBooks, currentPairs, exitedPairs: [] });
  const evidenceText = currentPairs.length ? currentPairs.map(pair => {
    const book = currentBooks.find(item => item.id === pair.id);
    const result = evidence.find(item => item.id === pair.id && item.store === pair.store);
    return result?.success
      ? `• ${book.title} — ${pair.store}: מצורף צילום מאזור רבי־המכר (${result.attachmentName})`
      : `• ${book.title} — ${pair.store}: לא ניתן היה לצלם הוכחה אמינה${result?.error ? ` (${result.error})` : ""}`;
  }).join("\n") : "אין ספרים פעילים ולכן אין צילומים לצרף.";
  const social = skipScreenshots ? [] : await createBestsellerSocialPosts({ books: currentBooks, bookIds: currentBooks.filter(book => book.sources.length).map(book => book.id) });
  const socialText = social.length ? social.map(item => {
    const book = currentBooks.find(entry => entry.id === item.id);
    return item.success ? `• ${book.title}: מצורף פוסט אינסטגרם לתאריך ${item.date} (${item.attachmentName})` : `• ${book.title}: לא ניתן היה ליצור פוסט (${item.error})`;
  }).join("\n") : "אין ספרים פעילים ולכן לא נוצרו פוסטים.";
  const warning = failedSources.length
    ? `\n\nלא ניתן היה לאמת לאחר שלושה ניסיונות: ${failedSources.join(", ")}.`
    : "";
  const body = `דוח רבי־המכר השבועי של הוצאת סול\n\n${formatCurrent(current)}${warning}\n\nראיות מצולמות:\n${evidenceText}\n\nפוסטים מוכנים לאינסטגרם:\n${socialText}\n\nזמן הבדיקה: ${checkedAt}\n\nמקורות:\n${sourceLinks()}\n`;
  await writeFile(emailPath, body, "utf8");
  await setOutputs({ send: "true", subject: `דוח רבי־המכר השבועי של הוצאת סול — ${checkedAt.replace(/[\r\n]/g, " ")}` });
} else {
  throw new Error(`Unknown mode: ${mode}`);
}
