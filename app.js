const state = { books: [], query: "", category: "הכול" };

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

const money = value => new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 1
}).format(value);

const formatLabels = { print: "מודפס", digital: "דיגיטלי", audio: "קולי" };
const storeOrder = ["ביבוקס", "עברית", "סטימצקי", "צומת ספרים", "אינדיבוק"];
const authorPhotos = {
  "מעיין גלעד": "assets/authors/maayan-gilad.png",
  "רותם פלד": "assets/authors/rotem-feld.png"
};

function formatPanel(book, format, offers) {
  const valid = offers.filter(offer => Number.isFinite(offer.price) && offer.url);
  if (!valid.length) return "";
  const best = Math.min(...valid.map(offer => offer.price));
  const rows = [...valid].sort((a, b) => a.price - b.price || storeOrder.indexOf(a.store) - storeOrder.indexOf(b.store)).map(offer => {
    const isBest = offer.price === best;
    return `<a class="price-row${isBest ? " best-offer" : ""}" href="${offer.url}" target="_blank" rel="noopener" aria-label="${book.title} ב${offer.store}, ${money(offer.price)}">
      <span class="store-name">${offer.store}</span>
      <span class="offer-price">${offer.priceBefore && offer.priceBefore > offer.price ? `<del>${money(offer.priceBefore)}</del>` : ""}<strong>${money(offer.price)}</strong></span>
      ${isBest ? `<span class="best-badge">הכי משתלם</span>` : `<span class="store-arrow" aria-hidden="true">↗</span>`}
    </a>`;
  }).join("");
  return `<div class="price-panel" data-panel="${format}"${format === "print" ? "" : " hidden"}>${rows}</div>`;
}

function formatComparison(book) {
  const offers = book.offers || {};
  const formats = ["print", "digital", "audio"].filter(format => offers[format]?.some(offer => Number.isFinite(offer.price) && offer.url));
  if (!formats.length) return "";
  return `<div class="price-comparison" data-price-comparison>
    <div class="format-tabs" role="tablist" aria-label="פורמטים ומחירים של ${book.title}">
      ${formats.map((format, index) => `<button class="format-tab${index === 0 ? " active" : ""}" type="button" role="tab" aria-selected="${index === 0}" data-format="${format}">${formatLabels[format]}</button>`).join("")}
    </div>
    ${formats.map((format, index) => formatPanel(book, format, offers[format]).replace(format === "print" ? "" : "", index === 0 ? "" : "")).join("")}
  </div>`;
}

function bookCard(book, index) {
  const reviewText = book.reviews?.count ? `${book.reviews.count} ביקורות` : "חדש בקטלוג";
  const bestsellerBadges = (book.bestsellers || []).map(item => `<a class="bestseller-badge" href="${item.url}" target="_blank" rel="noopener">★ ${item.label}</a>`).join("");
  const featuredReviews = (book.featuredReviews || []).map(review => `<figure class="reader-review">
    <blockquote>“${escapeHtml(review.excerpt)}”</blockquote>
    <figcaption><span>${"★".repeat(Math.max(0, Math.min(5, review.rating || 0)))}</span> ${escapeHtml(review.nickname)}</figcaption>
  </figure>`).join("");
  return `<article class="book-card reveal visible" style="--book-color:${book.themeColor || "#d88972"}">
    <div class="book-cover-shell">
      <span class="book-number">${String(index + 1).padStart(2, "0")}</span>
      <img class="book-cover" src="${book.cover}" alt="עטיפת ${book.title}" loading="lazy">
    </div>
    <div class="book-body">
      <p class="book-author"><a href="author.html?name=${encodeURIComponent(book.author)}" aria-label="לעמוד הסופרת ${escapeHtml(book.author)}"><strong>${escapeHtml(book.author)}</strong><span>לעמוד הסופרת ←</span></a></p>
      ${bestsellerBadges ? `<div class="book-bestsellers" aria-label="הופעה ברשימות רבי מכר">${bestsellerBadges}</div>` : ""}
      <h3>${book.title}</h3>
      <p class="book-description">${book.description || "ספרות רומנטית ישראלית מבית הוצאת סול."}</p>
      <div class="rating-row">
        ${book.reviews?.average ? `<span><span class="rating-star">★</span> <strong>${book.reviews.average.toFixed(1)}</strong></span>` : ""}
        <span>${reviewText}</span>
      </div>
      ${featuredReviews ? `<section class="featured-reviews" aria-label="ביקורות נבחרות על ${escapeHtml(book.title)}"><h4>קוראות מספרות</h4><div class="reader-reviews">${featuredReviews}</div><a class="reviews-source" href="${book.url}" target="_blank" rel="noopener">לכל הביקורות באתר עברית ↗</a></section>` : ""}
      ${formatComparison(book)}
    </div>
  </article>`;
}

function connectPriceTabs() {
  document.querySelectorAll("[data-price-comparison]").forEach(comparison => {
    const tabs = [...comparison.querySelectorAll(".format-tab")];
    const panels = [...comparison.querySelectorAll(".price-panel")];
    tabs.forEach(tab => tab.addEventListener("click", () => {
      tabs.forEach(item => { item.classList.toggle("active", item === tab); item.setAttribute("aria-selected", item === tab); });
      panels.forEach(panel => { panel.hidden = panel.dataset.panel !== tab.dataset.format; });
    }));
    if (tabs[0]) tabs[0].click();
  });
}

function renderBooks() {
  const needle = state.query.trim().toLocaleLowerCase("he");
  const filtered = state.books.filter(book => {
    const searchable = `${book.title} ${book.author} ${(book.categories || []).join(" ")}`.toLocaleLowerCase("he");
    return (!needle || searchable.includes(needle)) && (state.category === "הכול" || book.categories?.includes(state.category));
  });
  document.querySelector("#books-grid").innerHTML = filtered.map(bookCard).join("");
  document.querySelector("#empty-state").hidden = filtered.length > 0;
  connectPriceTabs();
}

function renderFilters() {
  const categories = ["הכול", ...new Set(state.books.flatMap(book => book.categories || []))];
  document.querySelector("#category-filters").innerHTML = categories.map(category => `<button class="filter-button${category === state.category ? " active" : ""}" type="button" data-category="${category}" aria-pressed="${category === state.category}">${category}</button>`).join("");
  document.querySelectorAll(".filter-button").forEach(button => button.addEventListener("click", () => {
    state.category = button.dataset.category; renderFilters(); renderBooks();
  }));
}

function renderHeroCovers() {
  document.querySelector("#hero-covers").innerHTML = state.books.slice(-4).reverse().map(book => `<img class="hero-cover" src="${book.cover}" alt="עטיפת ${book.title}">`).join("");
  document.querySelector("#hero-count").textContent = state.books.length;
}

function renderAuthors() {
  const groups = state.books.reduce((map, book) => map.set(book.author, [...(map.get(book.author) || []), book]), new Map());
  document.querySelector("#home-authors-grid").innerHTML = [...groups.entries()].map(([name, books]) => `
    <a class="home-author-card reveal visible" href="author.html?name=${encodeURIComponent(name)}" aria-label="לעמוד הסופרת ${escapeHtml(name)}">
      ${authorPhotos[name]
        ? `<img class="home-author-photo" src="${authorPhotos[name]}" alt="${escapeHtml(name)}" loading="lazy">`
        : `<div class="home-author-covers" aria-hidden="true">${books.slice(0, 3).map(book => `<img src="${book.cover}" alt="">`).join("")}</div>`}
      <div class="home-author-copy"><p>${books.length === 1 ? "ספר אחד" : `${books.length} ספרים`} בהוצאת סול</p><h3>${escapeHtml(name)}</h3><span>לכל הספרים ולעמוד הסופרת ←</span></div>
    </a>`).join("");
}

function connectReveal() {
  if (!("IntersectionObserver" in window)) return document.querySelectorAll(".reveal").forEach(element => element.classList.add("visible"));
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (entry.isIntersecting) { entry.target.classList.add("visible"); observer.unobserve(entry.target); }
  }), { threshold: .1 });
  document.querySelectorAll(".reveal").forEach(element => observer.observe(element));
}

async function init() {
  document.querySelector("#year").textContent = new Date().getFullYear();
  document.querySelector("#catalog-search").addEventListener("input", event => { state.query = event.target.value; renderBooks(); });
  try {
    const response = await fetch("data.json", { cache: "no-store" });
    if (!response.ok) throw new Error("הקטלוג אינו זמין");
    const data = await response.json();
    state.books = data.books || [];
    renderHeroCovers(); renderFilters(); renderBooks(); renderAuthors();
    const date = new Date(data.updatedAt);
    document.querySelector("#sync-status").textContent = `השוואת המחירים עודכנה: ${new Intl.DateTimeFormat("he-IL", { dateStyle: "long", timeZone: "Asia/Jerusalem" }).format(date)} · המחיר הסופי נקבע באתר החנות בעת הרכישה.`;
  } catch (error) {
    document.querySelector("#books-grid").innerHTML = "";
    document.querySelector("#empty-state").hidden = false;
    document.querySelector("#empty-state").textContent = "לא הצלחנו לטעון את הקטלוג כרגע. נסו לרענן את הדף.";
    document.querySelector("#sync-status").textContent = "הסנכרון האחרון לא נטען.";
  }
  connectReveal();
}

init();
