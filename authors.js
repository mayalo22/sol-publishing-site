const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

const profiles = {
  "אריאלה הראש": { intro: "סופרת ישראלית הכותבת רומנים עכשוויים שבהם אהבה, זהות והתמודדות נפגשות ברגעים שמשנים חיים." },
  "מעיין גלעד": {
    intro: "סופרת ישראלית מבית הוצאת סול. ספריה עוסקים באהבה עוצמתית, בחירה, משפחה והיכולת למצוא אור גם מתוך כאב.",
    photo: "assets/authors/maayan-gilad.png",
    links: [
      { label: "אינסטגרם", url: "https://www.instagram.com/maayan_gilad_writing/" },
      { label: "פייסבוק", url: "https://www.facebook.com/mayalo/" },
      { label: "טיקטוק", url: "https://www.tiktok.com/@maayan_gilad_writing" },
      { label: "האתר האישי", url: "https://mayalo22.github.io/" },
      { label: "המשחק: כוכבים רואים רק בחושך", url: "https://kochavim-bachoshech-game.mayalo.chatgpt.site/" },
      { label: "קבוצת הוואטסאפ", url: "https://chat.whatsapp.com/LPQ618mz1UsBhfV7orMoNE" }
    ]
  },
  "סטלה": { intro: "סופרת רומנטית ישראלית מבית הוצאת סול, הכותבת על בריחה מן העבר, התחלות חדשות והלב שאי אפשר להשתיק." },
  "רינטה אונגר": { intro: "סופרת רומנטית ישראלית מבית הוצאת סול, היוצרת סיפורים על אמון, סודות וקשרים שנבחנים ברגעים המורכבים ביותר." },
  "מיקה פרנקו": { intro: "סופרת רומנטית ישראלית מבית הוצאת סול, הכותבת על דמויות פצועות, גבולות שנשברים ואהבה הצומחת במקומות לא צפויים." },
  "רותם פלד": { intro: "סופרת רומנטית ישראלית מבית הוצאת סול. כתיבתה עוסקת באהבה, שליטה, פערים וגבולות בעולם שבו הרגש מסרב להישאר מוסתר." }
};

const initials = name => name.split(/\s+/).map(part => part[0]).join("").slice(0, 2);
const socialLinks = name => profiles[name]?.links || [
  { label: "Instagram", url: `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(`${name} סופרת`)}` },
  { label: "TikTok", url: `https://www.tiktok.com/search?q=${encodeURIComponent(`${name} סופרת`)}` }
];

function authorBook(book) {
  return `<article class="author-book"><img src="${book.cover}" alt="עטיפת ${escapeHtml(book.title)}"><h3>${escapeHtml(book.title)}</h3><p>${escapeHtml(book.description || "ספרות רומנטית ישראלית מבית הוצאת סול.")}</p><a class="text-link" href="index.html#catalog">למחירים ולפורמטים ←</a></article>`;
}

async function loadBooks() {
  const response = await fetch(`data.json?ts=${Date.now()}`, { cache: "no-store" });
  if (!response.ok) throw new Error("הקטלוג אינו זמין כרגע");
  return (await response.json()).books || [];
}

async function renderDirectory(container) {
  const books = await loadBooks();
  const groups = books.reduce((map, book) => map.set(book.author, [...(map.get(book.author) || []), book]), new Map());
  container.innerHTML = [...groups.entries()].map(([name, authorBooks]) => `<article class="author-tile"><div class="author-monogram" aria-hidden="true">${escapeHtml(initials(name))}</div><h2>${escapeHtml(name)}</h2><p>${escapeHtml(profiles[name]?.intro || "סופרת ישראלית מבית הוצאת סול.")}</p><p><strong>${authorBooks.length}</strong> ${authorBooks.length === 1 ? "ספר" : "ספרים"} בהוצאת סול</p><a class="text-link" href="author.html?name=${encodeURIComponent(name)}">לעמוד הסופרת ←</a></article>`).join("");
}

async function renderAuthor(main) {
  const name = new URLSearchParams(location.search).get("name") || "";
  const books = (await loadBooks()).filter(book => book.author === name);
  if (!books.length) { main.innerHTML = `<section class="inner-hero"><h1>הסופרת לא נמצאה</h1><p><a href="authors.html">חזרה לכל הסופרות</a></p></section>`; return; }
  document.title = `${name} | הוצאת סול`;
  const years = books.map(book => Number(book.year)).filter(Boolean);
  const portrait = profiles[name]?.photo
    ? `<img class="author-photo" src="${profiles[name].photo}" alt="${escapeHtml(name)}" loading="eager">`
    : `<div class="author-monogram" aria-hidden="true">${escapeHtml(initials(name))}</div>`;
  main.innerHTML = `<section class="inner-hero"><p class="eyebrow">סופרת בהוצאת סול</p><h1>${escapeHtml(name)}</h1></section><section class="author-profile">${portrait}<div><h2>נעים להכיר</h2><p class="author-bio">${escapeHtml(profiles[name]?.intro || "סופרת ישראלית מבית הוצאת סול.")}</p><div class="author-stats"><span>${books.length} ${books.length === 1 ? "ספר" : "ספרים"} בסול</span>${years.length ? `<span>בקטלוג מאז ${Math.min(...years)}</span>` : ""}</div><div class="author-socials" aria-label="קישורים לרשתות החברתיות של ${escapeHtml(name)}">${socialLinks(name).map(link => `<a href="${link.url}" target="_blank" rel="noopener">${escapeHtml(link.label)} ↗</a>`).join("")}</div></div></section><section class="author-books"><h2>הספרים של ${escapeHtml(name)}</h2><div class="author-books-grid">${books.map(authorBook).join("")}</div></section>`;
}

const directory = document.querySelector("#authors-directory");
const authorMain = document.querySelector("#author-main");
(directory ? renderDirectory(directory) : renderAuthor(authorMain)).catch(error => {
  (directory || authorMain).innerHTML = `<p class="empty-state">${escapeHtml(error.message)}</p>`;
});
