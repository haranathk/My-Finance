/* Finance Tracker - Web App (PWA)
   Tracks bank/cash transactions with a dashboard, rental-income tracking,
   and CSV import/export. Data persists in IndexedDB, auto-saved after
   every add/edit/delete — no Save button for data. */

(function () {
  "use strict";

  // ---------- Storage (IndexedDB) ----------
  const DB_NAME = "FinanceTrackerDB";
  const DB_VERSION = 1;
  const STORE_NAME = "transactions";
  const DARK_KEY = "financeTrackerDarkMode";

  function uuid() {
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0, v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = (e) => reject(e.target.error);
    });
  }

  const dbPromise = openDB();

  function loadTxnsFromDB() {
    return dbPromise.then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const req = tx.objectStore(STORE_NAME).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    })).catch((e) => { console.error("Failed to load transactions", e); return []; });
  }

  function saveTxns() {
    return dbPromise.then((db) => new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      store.clear();
      state.txns.forEach((t) => store.put(t));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    })).catch((e) => console.error("Failed to save transactions", e));
  }

  // transaction shape:
  // { id, serial, bank, date:"YYYY-MM-DD", description, ref, debit, credit,
  //   cat, subcat, key, photoData, file, rate, weight }

  const state = {
    txns: [],
    activeTab: "dashboard",
    dashboard: { periodType: "monthly", anchor: new Date() },
    rentals: { year: new Date().getFullYear() },
    txnSearch: "",
    txnFilters: { bank: "", cat: "", subcat: "" },
    editingId: null,
  };

  // ---------- Date helpers ----------
  function pad2(n) { return String(n).padStart(2, "0"); }
  function toISO(d) { return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; }
  function parseISO(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function parseFlexibleDate(str) {
    if (!str) return null;
    str = str.trim();
    let m = str.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
    if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
    m = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
    if (m) return `${m[3]}-${pad2(m[2])}-${pad2(m[1])}`; // DD/MM/YYYY assumed
    const d = new Date(str);
    if (!isNaN(d)) return toISO(d);
    return null;
  }
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_FULL = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  function fmtDMY(iso) { const d = parseISO(iso); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`; }
  function fmtDMon(iso) { const d = parseISO(iso); return `${pad2(d.getDate())} ${MONTHS[d.getMonth()]}`; }
  function fmtDMonYY(iso) { const d = parseISO(iso); return `${pad2(d.getDate())}-${MONTHS[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`; }

  function parseAmount(val) {
    if (!val) return 0;
    // Strips currency symbols, commas, and whitespace so pasted/imported amounts like "₹25,000" or "1,000.50" parse cleanly.
    const cleaned = String(val).replace(/[₹,$,\s]/g, "").trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? 0 : num;
  }

  function formatINR(n) {
    const v = Math.round(n || 0);
    return "₹" + Math.abs(v).toLocaleString("en-IN");
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- Category color/icon mapping ----------
  const CATEGORY_PALETTE = [
    "#3B82F6", "#EF4444", "#9333EA", "#F59E0B", "#10B981", "#EC4899", "#14B8A6", "#F97316",
  ];
  function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function categoryColor(cat) { return CATEGORY_PALETTE[hashStr((cat || "").toLowerCase()) % CATEGORY_PALETTE.length]; }
  function categoryIcon(cat) {
    const c = (cat || "").toLowerCase();
    if (/rent/.test(c)) return "🏠";
    if (/grocer|market|super/.test(c)) return "🛒";
    if (/salary|income|wage/.test(c)) return "💼";
    if (/gold|silver|bullion/.test(c)) return "💎";
    if (/fuel|petrol|gas station/.test(c)) return "⛽";
    if (/medic|health|hospital|doctor|pharma/.test(c)) return "💊";
    if (/travel|flight|trip|holiday/.test(c)) return "✈️";
    if (/entertain|movie|netflix|ott/.test(c)) return "🎬";
    if (/electric|utilit|water|dth|bill/.test(c)) return "💡";
    if (/food|restaurant|dining|swiggy|zomato/.test(c)) return "🍽️";
    if (/shop|amazon|flipkart/.test(c)) return "🛍️";
    if (/insur/.test(c)) return "🛡️";
    if (/educat|school|tuition|fee/.test(c)) return "🎓";
    if (/transport|taxi|uber|ola|bus|metro/.test(c)) return "🚗";
    if (/mobile|phone|recharge/.test(c)) return "📱";
    if (/loan|emi/.test(c)) return "🏦";
    if (/invest|mutual|stock|sip/.test(c)) return "📈";
    return "🏷️";
  }
  function hexToRgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
  }

  // ---------- Toast ----------
  let toastTimer = null;
  function showToast(msg) {
    const t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 2800);
  }

  // ---------- Confirm dialog ----------
  function showConfirm(title, msg, okLabel, onOk) {
    const overlay = document.getElementById("confirm-overlay");
    document.getElementById("confirm-title").textContent = title;
    document.getElementById("confirm-msg").textContent = msg;
    const okBtn = document.getElementById("confirm-ok");
    okBtn.textContent = okLabel;
    overlay.classList.remove("hidden");
    function cleanup() { overlay.classList.add("hidden"); okBtn.removeEventListener("click", okHandler); cancelBtn.removeEventListener("click", cancelHandler); }
    function okHandler() { cleanup(); onOk(); }
    function cancelHandler() { cleanup(); }
    const cancelBtn = document.getElementById("confirm-cancel");
    okBtn.addEventListener("click", okHandler);
    cancelBtn.addEventListener("click", cancelHandler);
  }

  // ---------- Tabs ----------
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.dataset.tab;
      document.querySelectorAll(".tab").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
      document.getElementById("screen-" + btn.dataset.tab).classList.add("active");
      renderActive();
    });
  });

  function renderActive() {
    if (state.activeTab === "dashboard") renderDashboard();
    else if (state.activeTab === "transactions") renderTransactions();
    else if (state.activeTab === "rentals") renderRentals();
  }

  // ================= DASHBOARD =================
  let expenseChart = null, incomeChart = null;

  function getPeriodRange() {
    const type = state.dashboard.periodType;
    const a = state.dashboard.anchor;
    if (type === "daily") {
      const start = new Date(a.getFullYear(), a.getMonth(), a.getDate());
      const end = start;
      return { start, end, label: `${pad2(a.getDate())} ${MONTHS[a.getMonth()]} ${a.getFullYear()}` };
    }
    if (type === "yearly") {
      const start = new Date(a.getFullYear(), 0, 1);
      const end = new Date(a.getFullYear(), 11, 31);
      return { start, end, label: `${a.getFullYear()}` };
    }
    const start = new Date(a.getFullYear(), a.getMonth(), 1);
    const end = new Date(a.getFullYear(), a.getMonth() + 1, 0);
    return { start, end, label: `${MONTHS_FULL[a.getMonth()]} ${a.getFullYear()}` };
  }

  function shiftPeriod(dir) {
    const type = state.dashboard.periodType;
    const a = state.dashboard.anchor;
    if (type === "daily") state.dashboard.anchor = new Date(a.getFullYear(), a.getMonth(), a.getDate() + dir);
    else if (type === "yearly") state.dashboard.anchor = new Date(a.getFullYear() + dir, a.getMonth(), 1);
    else state.dashboard.anchor = new Date(a.getFullYear(), a.getMonth() + dir, 1);
  }

  ["daily", "monthly", "yearly"].forEach((p) => {
    document.getElementById("pd-" + p).addEventListener("click", () => {
      state.dashboard.periodType = p;
      document.querySelectorAll(".period-btn").forEach((b) => b.classList.remove("active"));
      document.getElementById("pd-" + p).classList.add("active");
      renderDashboard();
    });
  });
  document.getElementById("period-prev").addEventListener("click", () => { shiftPeriod(-1); renderDashboard(); });
  document.getElementById("period-next").addEventListener("click", () => { shiftPeriod(1); renderDashboard(); });

  function txnsInRange(start, end) {
    return state.txns.filter((t) => {
      const d = parseISO(t.date);
      return d >= start && d <= end;
    });
  }

  function buildCategoryBreakdown(txns, field) {
    // field: 'debit' or 'credit'
    const totals = {};
    txns.forEach((t) => {
      const amt = parseFloat(t[field]) || 0;
      if (amt <= 0) return;
      const key = t.cat && t.cat.trim() ? t.cat.trim() : "Uncategorized";
      totals[key] = (totals[key] || 0) + amt;
    });
    let entries = Object.entries(totals).sort((a, b) => b[1] - a[1]);
    if (entries.length > 6) {
      const top = entries.slice(0, 5);
      const otherSum = entries.slice(5).reduce((s, e) => s + e[1], 0);
      entries = top.concat([["Other", otherSum]]);
    }
    return entries;
  }

  function renderDonutBlock(containerId, canvasId, entries, chartRef) {
    const container = document.getElementById(containerId);
    if (entries.length === 0) {
      container.innerHTML = `<div class="empty-mini">No data for this period.</div>`;
      return null;
    }
    const legendHtml = entries.map(([cat, amt]) => {
      const color = cat === "Other" ? "#8E8E93" : categoryColor(cat);
      const icon = cat === "Other" ? "🔹" : categoryIcon(cat);
      return `<div class="cat-legend-row">
        <div class="cat-bubble" style="background:${hexToRgba(color, 0.18)};">${icon}</div>
        <div class="name">${escapeHtml(cat)}</div>
        <div class="amt">${formatINR(amt)}</div>
      </div>`;
    }).join("");
    container.innerHTML = `
      <div class="donut-block">
        <div class="chart-wrap"><canvas id="${canvasId}"></canvas></div>
        <div class="cat-legend">${legendHtml}</div>
      </div>`;
    const colors = entries.map(([cat]) => cat === "Other" ? "#8E8E93" : categoryColor(cat));
    const ctx = document.getElementById(canvasId);
    if (window.Chart && ctx) {
      return new Chart(ctx, {
        type: "doughnut",
        data: { labels: entries.map((e) => e[0]), datasets: [{ data: entries.map((e) => e[1]), backgroundColor: colors, borderWidth: 2, borderColor: getComputedStyle(document.body).getPropertyValue("--bg") || "#fff" }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: "68%", plugins: { legend: { display: false } } },
      });
    }
    return null;
  }

  function renderDashboard() {
    const { start, end, label } = getPeriodRange();
    document.getElementById("period-label").textContent = label;
    const inRange = txnsInRange(start, end);

    const totalCredit = inRange.reduce((s, t) => s + (parseFloat(t.credit) || 0), 0);
    const totalDebit = inRange.reduce((s, t) => s + (parseFloat(t.debit) || 0), 0);
    const net = totalCredit - totalDebit;

    // accounts (by bank)
    const bankTotals = {};
    inRange.forEach((t) => {
      const b = t.bank && t.bank.trim() ? t.bank.trim() : "Cash";
      bankTotals[b] = (bankTotals[b] || 0) + (parseFloat(t.credit) || 0) - (parseFloat(t.debit) || 0);
    });
    const bankEntries = Object.entries(bankTotals).sort((a, b) => b[1] - a[1]);
    const accountsHtml = bankEntries.length ? `
      <div class="section-label">Accounts</div>
      <div class="accounts-row">
        ${bankEntries.map(([bank, amt]) => `
          <div class="account-card">
            <div class="bank">🏦 ${escapeHtml(bank)}</div>
            <div class="amt ${amt >= 0 ? "amt-pos" : "amt-neg"}">${amt >= 0 ? "+" : "-"}${formatINR(amt)}</div>
          </div>`).join("")}
      </div>` : "";

    const summaryHtml = `
      <div class="summary-grid">
        <div class="summary-card credit"><div class="lbl">Credit</div><div class="val">${formatINR(totalCredit)}</div></div>
        <div class="summary-card debit"><div class="lbl">Debit</div><div class="val">${formatINR(totalDebit)}</div></div>
      </div>
      <div class="net-card"><div class="lbl">Net (${escapeHtml(label)})</div><div class="val" style="color:${net >= 0 ? "var(--green)" : "var(--red)"};">${net >= 0 ? "+" : "-"}${formatINR(net)}</div></div>
    `;

    const body = document.getElementById("dashboard-body");
    body.innerHTML = accountsHtml + summaryHtml
      + `<div class="section-label">Expense by category</div><div id="expense-donut-container"></div>`
      + `<div class="section-label">Income by category</div><div id="income-donut-container"></div>`;

    if (expenseChart) { expenseChart.destroy(); expenseChart = null; }
    if (incomeChart) { incomeChart.destroy(); incomeChart = null; }
    const expenseEntries = buildCategoryBreakdown(inRange, "debit");
    const incomeEntries = buildCategoryBreakdown(inRange, "credit");
    expenseChart = renderDonutBlock("expense-donut-container", "expense-donut", expenseEntries);
    incomeChart = renderDonutBlock("income-donut-container", "income-donut", incomeEntries);
  }

  // ================= TRANSACTIONS =================
  // Tracks which year/month sections are expanded. Populated with sensible
  // defaults (most recent year + month open) the first time we have data.
  const txnExpanded = { years: new Set(), months: new Set(), initialized: false };

  function txnRowHtml(t) {
    const credit = parseFloat(t.credit) || 0;
    const debit = parseFloat(t.debit) || 0;
    const isCredit = credit > 0;
    const amt = isCredit ? credit : debit;
    return `
      <div class="txn-table-row" data-open-edit="${t.id}">
        <div class="txn-date">${fmtDMonYY(t.date)}</div>
        <div class="txn-bank">${escapeHtml(t.bank || "—")}</div>
        <div class="txn-cell-desc">${escapeHtml((t.subcat && t.subcat.trim()) ? t.subcat.trim() : (t.description || "(no description)"))}</div>
        <div class="txn-amount" style="color:${isCredit ? "var(--green)" : "var(--red)"};">${formatINR(amt)}</div>
      </div>`;
  }

  function totalsPillHtml(credit, debit) {
    return `<span class="grp-totals"><span class="t-credit">${formatINR(credit)}</span><span class="t-debit">${formatINR(debit)}</span></span>`;
  }

  function renderTransactionsGrouped(list) {
    // Build year -> month -> txns[], plus running totals at each level.
    const years = {};
    list.forEach((t) => {
      const d = parseISO(t.date);
      const y = d.getFullYear(), m = d.getMonth();
      if (!years[y]) years[y] = { credit: 0, debit: 0, months: {} };
      if (!years[y].months[m]) years[y].months[m] = { credit: 0, debit: 0, txns: [] };
      const credit = parseFloat(t.credit) || 0, debit = parseFloat(t.debit) || 0;
      years[y].credit += credit; years[y].debit += debit;
      years[y].months[m].credit += credit; years[y].months[m].debit += debit;
      years[y].months[m].txns.push(t);
    });
    const yearKeys = Object.keys(years).map(Number).sort((a, b) => b - a);

    if (!txnExpanded.initialized && yearKeys.length) {
      const topYear = yearKeys[0];
      txnExpanded.years.add(topYear);
      const monthKeys = Object.keys(years[topYear].months).map(Number).sort((a, b) => b - a);
      if (monthKeys.length) txnExpanded.months.add(`${topYear}-${monthKeys[0]}`);
      txnExpanded.initialized = true;
    }

    let html = "";
    yearKeys.forEach((y) => {
      const yearOpen = txnExpanded.years.has(y);
      html += `
        <div class="grp-header year-hdr" data-toggle-year="${y}">
          <span class="chev">${yearOpen ? "▾" : "▸"}</span>
          <span class="grp-title">${y}</span>
          ${totalsPillHtml(years[y].credit, years[y].debit)}
        </div>`;
      if (yearOpen) {
        const monthKeys = Object.keys(years[y].months).map(Number).sort((a, b) => b - a);
        monthKeys.forEach((m) => {
          const monthKey = `${y}-${m}`;
          const monthOpen = txnExpanded.months.has(monthKey);
          const info = years[y].months[m];
          html += `
            <div class="grp-header month-hdr ${monthOpen ? "is-open" : ""}" data-toggle-month="${monthKey}">
              <span class="grp-title">${MONTHS_FULL[m]}</span>
              ${totalsPillHtml(info.credit, info.debit)}
            </div>`;
          if (monthOpen) {
            info.txns.sort((a, b) => parseISO(b.date) - parseISO(a.date));
            html += `
              <div class="txn-col-hdr">
                <div class="txn-date">Date</div>
                <div class="txn-bank">Bank</div>
                <div class="txn-cell-desc">Details</div>
                <div class="txn-amount">Amount</div>
              </div>`;
            html += info.txns.map(txnRowHtml).join("");
          }
        });
      }
    });
    return html;
  }

  function renderYearOnlyGrouped(list) {
    const years = {};
    list.forEach((t) => {
      const y = parseISO(t.date).getFullYear();
      if (!years[y]) years[y] = { credit: 0, debit: 0, txns: [] };
      years[y].credit += parseFloat(t.credit) || 0;
      years[y].debit += parseFloat(t.debit) || 0;
      years[y].txns.push(t);
    });
    const yearKeys = Object.keys(years).map(Number).sort((a, b) => b - a);
    if (!txnExpanded.initialized && yearKeys.length) {
      txnExpanded.years.add(yearKeys[0]);
      txnExpanded.initialized = true;
    }
    let html = "";
    yearKeys.forEach((y) => {
      const yearOpen = txnExpanded.years.has(y);
      html += `
        <div class="grp-header year-hdr" data-toggle-year="${y}">
          <span class="chev">${yearOpen ? "▾" : "▸"}</span>
          <span class="grp-title">${y}</span>
          ${totalsPillHtml(years[y].credit, years[y].debit)}
        </div>`;
      if (yearOpen) {
        years[y].txns.sort((a, b) => parseISO(b.date) - parseISO(a.date));
        html += `
          <div class="txn-col-hdr">
            <div class="txn-date">Date</div>
            <div class="txn-bank">Bank</div>
            <div class="txn-cell-desc">Details</div>
            <div class="txn-amount">Amount</div>
          </div>` + years[y].txns.map(txnRowHtml).join("");
      }
    });
    return html;
  }

  function categoryOptionsSorted() {
    const cats = distinctValues("cat");
    const idx = cats.findIndex((c) => c.toLowerCase() === "rents");
    if (idx > 0) { const rents = cats.splice(idx, 1)[0]; cats.unshift(rents); }
    return cats;
  }

  function subcatOptionsFor(selectedCat) {
    const set = new Set();
    state.txns.forEach((t) => {
      if (!t.subcat || !t.subcat.trim()) return;
      if (selectedCat && (t.cat || "").trim().toLowerCase() !== selectedCat.trim().toLowerCase()) return;
      set.add(t.subcat.trim());
    });
    return Array.from(set).sort();
  }

  function populateTxnFilterSelects() {
    function fillSelect(sel, options, allLabel, currentVal) {
      sel.innerHTML = `<option value="">${allLabel}</option>` + options.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");
      sel.value = options.includes(currentVal) ? currentVal : "";
    }
    fillSelect(document.getElementById("filter-bank"), distinctValues("bank"), "All Banks", state.txnFilters.bank);
    fillSelect(document.getElementById("filter-cat"), categoryOptionsSorted(), "All Categories", state.txnFilters.cat);
    fillSelect(document.getElementById("filter-subcat"), subcatOptionsFor(state.txnFilters.cat), "All Sub-categories", state.txnFilters.subcat);
  }

  function renderTransactions() {
    populateTxnFilterSelects();

    const q = state.txnSearch.trim().toLowerCase();
    const f = state.txnFilters;
    let list = state.txns.slice();
    if (f.bank) list = list.filter((t) => (t.bank || "").trim() === f.bank);
    if (f.cat) list = list.filter((t) => (t.cat || "").trim().toLowerCase() === f.cat.toLowerCase());
    if (f.subcat) list = list.filter((t) => (t.subcat || "").trim() === f.subcat);
    if (q) {
      list = list.filter((t) =>
        (t.description || "").toLowerCase().includes(q) ||
        (t.ref || "").toLowerCase().includes(q) ||
        (t.bank || "").toLowerCase().includes(q) ||
        (t.cat || "").toLowerCase().includes(q) ||
        (t.subcat || "").toLowerCase().includes(q)
      );
    }

    const container = document.getElementById("txn-list");
    if (state.txns.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="glyph">💳</div><div>No transactions yet. Tap + to add one.</div></div>`;
      return;
    }
    if (list.length === 0) {
      container.innerHTML = `<div class="empty-state"><div class="glyph">🔍</div><div>No transactions match your filters.</div></div>`;
      return;
    }

    let html;
    if (f.subcat) {
      // A specific sub-category is selected — skip the monthly breakdown, list year-wise only.
      html = renderYearOnlyGrouped(list);
    } else if (q) {
      // While actively searching, show a flat list so matches are never hidden inside a collapsed section.
      list.sort((a, b) => parseISO(b.date) - parseISO(a.date));
      html = `
        <div class="txn-col-hdr">
          <div class="txn-date">Date</div>
          <div class="txn-bank">Bank</div>
          <div class="txn-cell-desc">Details</div>
          <div class="txn-amount">Amount</div>
        </div>` + list.map(txnRowHtml).join("");
    } else {
      html = renderTransactionsGrouped(list);
    }
    container.innerHTML = html;

    container.querySelectorAll("[data-open-edit]").forEach((el) => {
      el.addEventListener("click", () => openTxnSheet(el.dataset.openEdit));
    });
    container.querySelectorAll("[data-toggle-year]").forEach((el) => {
      el.addEventListener("click", () => {
        const y = Number(el.dataset.toggleYear);
        if (txnExpanded.years.has(y)) txnExpanded.years.delete(y); else txnExpanded.years.add(y);
        renderTransactions();
      });
    });
    container.querySelectorAll("[data-toggle-month]").forEach((el) => {
      el.addEventListener("click", () => {
        const key = el.dataset.toggleMonth; // "year-month"
        const year = key.split("-")[0];
        const wasOpen = txnExpanded.months.has(key);
        // Accordion: closing this month's siblings in the same year first.
        Array.from(txnExpanded.months).forEach((k) => {
          if (k.split("-")[0] === year) txnExpanded.months.delete(k);
        });
        if (!wasOpen) txnExpanded.months.add(key);
        renderTransactions();
      });
    });
  }

  document.getElementById("btn-add-txn").addEventListener("click", () => openTxnSheet(null));

  document.getElementById("filter-bank").addEventListener("change", (e) => {
    state.txnFilters.bank = e.target.value;
    renderTransactions();
  });
  document.getElementById("filter-cat").addEventListener("change", (e) => {
    state.txnFilters.cat = e.target.value;
    state.txnFilters.subcat = ""; // subcat options depend on category, reset to avoid a stale/invalid selection
    renderTransactions();
  });
  document.getElementById("filter-subcat").addEventListener("change", (e) => {
    state.txnFilters.subcat = e.target.value;
    renderTransactions();
  });

  document.getElementById("txn-search").addEventListener("input", (e) => {
    state.txnSearch = e.target.value;
    renderTransactions();
  });

  // ================= ADD / EDIT TRANSACTION SHEET =================
  let tempPhotoData = null;

  function distinctValues(field) {
    const set = new Set();
    state.txns.forEach((t) => { if (t[field] && t[field].trim()) set.add(t[field].trim()); });
    return Array.from(set).sort();
  }

  function openTxnSheet(id) {
    state.editingId = id;
    const existing = id ? state.txns.find((t) => t.id === id) : null;
    tempPhotoData = existing ? existing.photoData : null;
    const overlay = document.getElementById("txn-sheet-overlay");
    const sheet = document.getElementById("txn-sheet");
    const isCredit = existing ? (parseFloat(existing.credit) || 0) > 0 : false;
    const amount = existing ? (isCredit ? existing.credit : existing.debit) : "";

    sheet.innerHTML = `
      <div class="sheet-header">
        <button data-action="cancel">Cancel</button>
        <div class="sheet-title">${existing ? "Edit Transaction" : "Add Transaction"}</div>
        <button class="save" data-action="save">Save</button>
      </div>
      <div class="sheet-body">
        <div class="photo-picker">
          <div class="photo-circle" id="photo-circle">${tempPhotoData ? `<img src="${tempPhotoData}">` : `<span class="plus">📷</span>`}</div>
          <label for="photo-input">Add Receipt Photo</label>
          <input type="file" id="photo-input" accept="image/*" style="display:none;">
        </div>

        <div class="type-toggle">
          <button type="button" class="${!isCredit ? "active debit" : ""}" id="type-debit">Expense (Debit)</button>
          <button type="button" class="${isCredit ? "active credit" : ""}" id="type-credit">Income (Credit)</button>
        </div>

        <div class="field-label">Amount</div>
        <input type="number" step="0.01" class="text-input" id="input-amount" value="${amount || ""}" placeholder="0.00">

        <div class="field-label">Description</div>
        <input type="text" class="text-input" id="input-desc" value="${escapeHtml(existing ? existing.description : "")}" placeholder="e.g. Rent - Priya (Flat 2B)">

        <div class="two-col">
          <div>
            <div class="field-label">Date</div>
            <input type="date" class="date-input" id="input-date" value="${existing ? existing.date : toISO(new Date())}">
          </div>
          <div>
            <div class="field-label">Bank</div>
            <input type="text" class="text-input" id="input-bank" list="bank-list" value="${escapeHtml(existing ? existing.bank : "")}" placeholder="HDFC">
            <datalist id="bank-list">${distinctValues("bank").map((b) => `<option value="${escapeHtml(b)}">`).join("")}</datalist>
          </div>
        </div>

        <div class="two-col">
          <div>
            <div class="field-label">Category</div>
            <input type="text" class="text-input" id="input-cat" list="cat-list" value="${escapeHtml(existing ? existing.cat : "")}" placeholder="Rents">
            <datalist id="cat-list">${distinctValues("cat").map((c) => `<option value="${escapeHtml(c)}">`).join("")}</datalist>
          </div>
          <div>
            <div class="field-label">Sub-category</div>
            <input type="text" class="text-input" id="input-subcat" list="subcat-list" value="${escapeHtml(existing ? existing.subcat : "")}" placeholder="Tenant name">
            <datalist id="subcat-list">${distinctValues("subcat").map((c) => `<option value="${escapeHtml(c)}">`).join("")}</datalist>
          </div>
        </div>

        <div class="field-label">Reference No.</div>
        <input type="text" class="text-input" id="input-ref" value="${escapeHtml(existing ? existing.ref : "")}">

        <div class="field-label">Key / Tag</div>
        <input type="text" class="text-input" id="input-key" value="${escapeHtml(existing ? existing.key : "")}">

        <div class="field-label">File Reference</div>
        <input type="text" class="text-input" id="input-file" value="${escapeHtml(existing ? existing.file : "")}" placeholder="filename or link">

        <div class="two-col">
          <div>
            <div class="field-label">Rate (gold/silver)</div>
            <input type="number" step="0.01" class="text-input" id="input-rate" value="${existing && existing.rate ? existing.rate : ""}">
          </div>
          <div>
            <div class="field-label">Weight (g)</div>
            <input type="number" step="0.001" class="text-input" id="input-weight" value="${existing && existing.weight ? existing.weight : ""}">
          </div>
        </div>

        ${existing ? `<div style="height:10px;"></div><button class="type-toggle" style="width:100%; color:var(--red); border:1px solid var(--red); background:none; padding:12px; border-radius:10px; font-weight:600; margin-top:10px;" id="btn-delete-txn">Delete Transaction</button>` : ""}
      </div>
    `;
    overlay.classList.remove("hidden");
    wireTxnSheetEvents(existing);
  }

  function closeTxnSheet() {
    document.getElementById("txn-sheet-overlay").classList.add("hidden");
    tempPhotoData = null;
  }

  function wireTxnSheetEvents(existing) {
    const sheet = document.getElementById("txn-sheet");
    sheet.querySelector('[data-action="cancel"]').addEventListener("click", closeTxnSheet);

    const photoInput = document.getElementById("photo-input");
    const photoCircle = document.getElementById("photo-circle");
    photoCircle.addEventListener("click", () => photoInput.click());
    photoInput.addEventListener("change", (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement("canvas");
          const maxSize = 500;
          let w = img.width, h = img.height;
          if (w > h && w > maxSize) { h = h * (maxSize / w); w = maxSize; }
          else if (h > maxSize) { w = w * (maxSize / h); h = maxSize; }
          canvas.width = w; canvas.height = h;
          canvas.getContext("2d").drawImage(img, 0, 0, w, h);
          tempPhotoData = canvas.toDataURL("image/jpeg", 0.8);
          photoCircle.innerHTML = `<img src="${tempPhotoData}">`;
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });

    let txnType = existing ? ((parseFloat(existing.credit) || 0) > 0 ? "credit" : "debit") : "debit";
    const debitBtn = document.getElementById("type-debit");
    const creditBtn = document.getElementById("type-credit");
    debitBtn.addEventListener("click", () => {
      txnType = "debit";
      debitBtn.classList.add("active", "debit"); creditBtn.classList.remove("active", "credit");
    });
    creditBtn.addEventListener("click", () => {
      txnType = "credit";
      creditBtn.classList.add("active", "credit"); debitBtn.classList.remove("active", "debit");
    });

    sheet.querySelector('[data-action="save"]').addEventListener("click", () => {
      const desc = document.getElementById("input-desc").value.trim();
      const dateVal = document.getElementById("input-date").value;
      const amountVal = parseAmount(document.getElementById("input-amount").value);
      if (!desc) { showToast("Please enter a description"); return; }
      if (!dateVal) { showToast("Please choose a date"); return; }
      if (amountVal <= 0) { showToast("Please enter an amount"); return; }

      const record = {
        id: existing ? existing.id : uuid(),
        serial: existing ? existing.serial : "",
        bank: document.getElementById("input-bank").value.trim(),
        date: dateVal,
        description: desc,
        ref: document.getElementById("input-ref").value.trim(),
        debit: txnType === "debit" ? amountVal : 0,
        credit: txnType === "credit" ? amountVal : 0,
        cat: document.getElementById("input-cat").value.trim(),
        subcat: document.getElementById("input-subcat").value.trim(),
        key: document.getElementById("input-key").value.trim(),
        photoData: tempPhotoData,
        file: document.getElementById("input-file").value.trim(),
        rate: parseAmount(document.getElementById("input-rate").value) || "",
        weight: parseAmount(document.getElementById("input-weight").value) || "",
      };

      if (existing) {
        const idx = state.txns.findIndex((t) => t.id === existing.id);
        state.txns[idx] = record;
      } else {
        state.txns.push(record);
      }
      saveTxns();
      closeTxnSheet();
      renderActive();
    });

    const delBtn = document.getElementById("btn-delete-txn");
    if (delBtn) {
      delBtn.addEventListener("click", () => {
        showConfirm("Delete Transaction", `Delete "${existing.description}"? This can't be undone.`, "Delete", () => {
          state.txns = state.txns.filter((t) => t.id !== existing.id);
          saveTxns();
          closeTxnSheet();
          renderActive();
        });
      });
    }
  }

  document.getElementById("txn-sheet-overlay").addEventListener("click", (e) => {
    if (e.target.id === "txn-sheet-overlay") closeTxnSheet();
  });

  // ================= RENTALS =================
  document.getElementById("rent-year-prev").addEventListener("click", () => { state.rentals.year--; renderRentals(); });
  document.getElementById("rent-year-next").addEventListener("click", () => { state.rentals.year++; renderRentals(); });

  function renderRentals() {
    document.getElementById("rent-year-label").textContent = state.rentals.year;
    const year = state.rentals.year;
    const rentTxns = state.txns.filter((t) => /rent/i.test(t.cat || "") && (parseFloat(t.credit) || 0) > 0 && parseISO(t.date).getFullYear() === year);

    const byTenant = {};
    rentTxns.forEach((t) => {
      const tenant = t.subcat && t.subcat.trim() ? t.subcat.trim() : "Unspecified tenant";
      if (!byTenant[tenant]) byTenant[tenant] = { total: 0, months: new Set(), txns: [] };
      byTenant[tenant].total += parseFloat(t.credit) || 0;
      byTenant[tenant].months.add(parseISO(t.date).getMonth());
      byTenant[tenant].txns.push(t);
    });

    const body = document.getElementById("rentals-body");
    const tenants = Object.keys(byTenant).sort();
    if (tenants.length === 0) {
      body.innerHTML = `<div class="empty-state"><div class="glyph">🏠</div><div>No rental income recorded for ${year}. Add a transaction with category "Rents" and the tenant's name as the sub-category.</div></div>`;
      return;
    }

    const yearTotal = tenants.reduce((s, t) => s + byTenant[t].total, 0);
    let html = `<div class="net-card"><div class="lbl">Total rent collected — ${year}</div><div class="val" style="color:var(--green);">${formatINR(yearTotal)}</div></div>`;
    html += `<div class="section-label">By tenant</div>`;
    tenants.forEach((tenant) => {
      const info = byTenant[tenant];
      const monthsPaid = info.months.size;
      const chips = MONTHS.map((m, i) => `<span class="month-chip ${info.months.has(i) ? "paid" : ""}">${m}</span>`).join("");
      html += `
        <div class="tenant-card" data-tenant="${escapeHtml(tenant)}">
          <div class="row1"><div class="name">${escapeHtml(tenant)}</div><div class="total">${formatINR(info.total)}</div></div>
          <div class="status" style="color:${monthsPaid >= 12 ? "var(--green)" : "var(--yellow)"};">${monthsPaid} of 12 months paid</div>
          <div class="month-chips">${chips}</div>
        </div>`;
    });
    body.innerHTML = html;
    body.querySelectorAll("[data-tenant]").forEach((el) => {
      el.addEventListener("click", () => openTenantSheet(el.dataset.tenant, byTenant[el.dataset.tenant], year));
    });
  }

  function openTenantSheet(tenant, info, year) {
    const overlay = document.getElementById("tenant-sheet-overlay");
    const sheet = document.getElementById("tenant-sheet");
    const sorted = info.txns.slice().sort((a, b) => parseISO(b.date) - parseISO(a.date));
    sheet.innerHTML = `
      <div class="sheet-header">
        <button data-action="close-tenant">Close</button>
        <div class="sheet-title">${escapeHtml(tenant)}</div>
        <span style="width:44px;"></span>
      </div>
      <div class="sheet-body">
        <div class="net-card" style="margin:0 0 16px;"><div class="lbl">Total in ${year}</div><div class="val" style="color:var(--green);">${formatINR(info.total)}</div></div>
        ${sorted.map((t) => `
          <div class="txn-row" style="padding:9px 0; cursor:default;">
            <div class="txn-main">
              <div class="txn-desc">${escapeHtml(fmtDMon(t.date))}</div>
              <div class="txn-sub">${escapeHtml(t.bank || "")}</div>
            </div>
            <div class="txn-amt" style="color:var(--green);">+${formatINR(t.credit)}</div>
          </div>`).join("")}
      </div>`;
    overlay.classList.remove("hidden");
    sheet.querySelector('[data-action="close-tenant"]').addEventListener("click", () => overlay.classList.add("hidden"));
  }
  document.getElementById("tenant-sheet-overlay").addEventListener("click", (e) => {
    if (e.target.id === "tenant-sheet-overlay") e.currentTarget.classList.add("hidden");
  });

  // ================= SETTINGS =================
  function applyDarkMode(on) {
    document.body.classList.toggle("dark", on);
    document.getElementById("dark-icon").textContent = on ? "🌙" : "☀️";
    document.getElementById("dark-toggle").checked = on;
    localStorage.setItem(DARK_KEY, on ? "1" : "0");
  }
  document.getElementById("dark-toggle").addEventListener("change", (e) => applyDarkMode(e.target.checked));
  applyDarkMode(localStorage.getItem(DARK_KEY) === "1");

  document.getElementById("btn-delete-all").addEventListener("click", () => {
    showConfirm("Delete All Transactions", "Are you sure you want to delete all transactions? This action cannot be undone.", "Delete", () => {
      state.txns = [];
      saveTxns();
      renderActive();
      showToast("All transactions have been deleted");
    });
  });

  function csvEscape(v) {
    if (v == null) return "";
    const s = String(v);
    if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  const CSV_HEADER = ["1", "Bank", "Date", "Description", "Ref", "Debit", "Credit", "Cat", "Subcat", "Key", "Photo", "File", "Rate", "Weight"];

  document.getElementById("btn-export-csv").addEventListener("click", () => {
    const rows = [CSV_HEADER.join(",")];
    state.txns.slice().sort((a, b) => parseISO(a.date) - parseISO(b.date)).forEach((t, i) => {
      const row = [
        t.serial || (i + 1), t.bank, t.date, t.description, t.ref,
        t.debit || 0, t.credit || 0, t.cat, t.subcat, t.key,
        t.photoData || "", t.file, t.rate || "", t.weight || "",
      ].map(csvEscape);
      rows.push(row.join(","));
    });
    const csv = rows.join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "transactions_export.csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Transactions exported successfully to CSV");
  });

  function parseCSV(text) {
    const rows = [];
    let row = [], field = "", inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else { inQuotes = false; } }
        else field += c;
      } else {
        if (c === '"') inQuotes = true;
        else if (c === ",") { row.push(field); field = ""; }
        else if (c === "\n" || c === "\r") {
          if (c === "\r" && text[i + 1] === "\n") i++;
          row.push(field); field = ""; rows.push(row); row = [];
        } else field += c;
      }
    }
    if (field.length || row.length) { row.push(field); rows.push(row); }
    return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0] !== ""));
  }

  function importCsvText(text) {
    try {
      const rows = parseCSV(text);
      if (rows.length < 2) { showToast("No transactions found in file"); return; }
      const header = rows[0].map((h) => h.trim().toLowerCase());
      const idx = (name) => header.indexOf(name.toLowerCase());
      const iSerial = idx("1"), iBank = idx("bank"), iDate = idx("date"), iDesc = idx("description"),
        iRef = idx("ref"), iDebit = idx("debit"), iCredit = idx("credit"), iCat = idx("cat"),
        iSubcat = idx("subcat"), iKey = idx("key"), iPhoto = idx("photo"), iFile = idx("file"),
        iRate = idx("rate"), iWeight = idx("weight");

      const existingSignatures = new Set(state.txns.map((t) => `${t.date}|${t.description}|${t.debit}|${t.credit}|${t.ref}|${t.bank}`));
      let added = 0, skipped = 0;
      for (let i = 1; i < rows.length; i++) {
        const r = rows[i];
        const dateVal = parseFlexibleDate(iDate >= 0 ? r[iDate] : "");
        const desc = iDesc >= 0 ? (r[iDesc] || "").trim() : "";
        if (!dateVal) continue;  // Only skip if date is missing
        const debit = iDebit >= 0 ? parseAmount(r[iDebit]) : 0;
        const credit = iCredit >= 0 ? parseAmount(r[iCredit]) : 0;
        const bank = iBank >= 0 ? (r[iBank] || "").trim() : "";
        const ref = iRef >= 0 ? (r[iRef] || "").trim() : "";
        const sig = `${dateVal}|${desc || "(no desc)"}|${debit}|${credit}|${ref}|${bank}`;
        if (existingSignatures.has(sig)) { skipped++; continue; }
        existingSignatures.add(sig);
        state.txns.push({
          id: uuid(),
          serial: iSerial >= 0 ? (r[iSerial] || "").trim() : "",
          bank, date: dateVal, description: desc, ref,
          debit, credit,
          cat: iCat >= 0 ? (r[iCat] || "").trim() : "",
          subcat: iSubcat >= 0 ? (r[iSubcat] || "").trim() : "",
          key: iKey >= 0 ? (r[iKey] || "").trim() : "",
          photoData: iPhoto >= 0 && r[iPhoto] && r[iPhoto].startsWith("data:") ? r[iPhoto] : null,
          file: iFile >= 0 ? (r[iFile] || "").trim() : "",
          rate: iRate >= 0 ? parseAmount(r[iRate]) || "" : "",
          weight: iWeight >= 0 ? parseAmount(r[iWeight]) || "" : "",
        });
        added++;
      }
      saveTxns();
      renderActive();
      showToast(`Import complete. Added ${added} transaction${added === 1 ? "" : "s"}, skipped ${skipped} duplicate${skipped === 1 ? "" : "s"}.`);
    } catch (err) {
      console.error(err);
      showToast("Failed to import: " + err.message);
    }
  }

  document.getElementById("btn-import-csv").addEventListener("click", () => document.getElementById("csvFileInput").click());
  document.getElementById("csvFileInput").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      importCsvText(reader.result);
      document.getElementById("csvFileInput").value = "";
    };
    reader.readAsText(file);
  });

  // ---------- Google Drive Import ----------
  const GOOGLE_CLIENT_ID_KEY = "financeTrackerGoogleClientId";
  const GOOGLE_API_KEY_KEY = "financeTrackerGoogleApiKey";
  const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";

  function loadGoogleCreds() {
    document.getElementById("google-client-id").value = localStorage.getItem(GOOGLE_CLIENT_ID_KEY) || "";
    document.getElementById("google-api-key").value = localStorage.getItem(GOOGLE_API_KEY_KEY) || "";
  }
  loadGoogleCreds();

  document.getElementById("btn-save-google-creds").addEventListener("click", () => {
    const clientId = document.getElementById("google-client-id").value.trim();
    const apiKey = document.getElementById("google-api-key").value.trim();
    if (!clientId || !apiKey) { showToast("Please enter both the Client ID and API Key"); return; }
    localStorage.setItem(GOOGLE_CLIENT_ID_KEY, clientId);
    localStorage.setItem(GOOGLE_API_KEY_KEY, apiKey);
    showToast("Google credentials saved on this device");
  });

  let driveTokenClient = null;
  let driveAccessToken = null;
  let pickerLoaded = false;

  function ensurePickerLoaded() {
    return new Promise((resolve) => {
      if (pickerLoaded) return resolve();
      if (typeof gapi === "undefined") { showToast("Google API script hasn't loaded yet — check your internet connection and try again."); return; }
      gapi.load("picker", () => { pickerLoaded = true; resolve(); });
    });
  }

  function openDrivePicker() {
    const apiKey = localStorage.getItem(GOOGLE_API_KEY_KEY);
    const clientId = localStorage.getItem(GOOGLE_CLIENT_ID_KEY) || "";
    // The Cloud project number is the leading digits of the OAuth Client ID
    // (e.g. "123456789012-abc...apps.googleusercontent.com" -> "123456789012").
    // With the restrictive drive.file scope, Picker MUST be told the app id so
    // that a picked file is actually granted to this app; otherwise the Drive/
    // Sheets REST calls that follow will fail with 403/404 even though the
    // user just selected the file.
    const appId = clientId.split("-")[0];
    const view1 = new google.picker.DocsView(google.picker.ViewId.SPREADSHEETS).setIncludeFolders(true);
    const view2 = new google.picker.DocsView(google.picker.ViewId.DOCS)
      .setIncludeFolders(true)
      .setMimeTypes("text/csv,text/plain,text/comma-separated-values");
    const picker = new google.picker.PickerBuilder()
      .addView(view1)
      .addView(view2)
      .setOAuthToken(driveAccessToken)
      .setDeveloperKey(apiKey)
      .setAppId(appId)
      .setCallback(onDriveFilePicked)
      .build();
    picker.setVisible(true);
  }

  function onDriveFilePicked(data) {
    if (data.action !== google.picker.Action.PICKED) return;
    const file = data.docs[0];
    fetchDriveFileAsCsv(file.id, file.mimeType, file.name);
  }

  function fetchDriveFileAsCsv(fileId, mimeType, name) {
    const isSheet = mimeType === "application/vnd.google-apps.spreadsheet";
    if (isSheet) {
      showToast("Loading tabs in " + name + "…");
      fetch(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}?fields=sheets.properties`, {
        headers: { Authorization: "Bearer " + driveAccessToken },
      })
        .then((res) => { if (!res.ok) throw new Error("Couldn't read sheet tabs (" + res.status + ")"); return res.json(); })
        .then((data) => {
          const tabs = (data.sheets || []).map((s) => s.properties.title);
          if (tabs.length === 0) { showToast("No tabs found in this spreadsheet"); return; }
          if (tabs.length === 1) { importDriveSheetTab(fileId, tabs[0]); return; }
          showSheetTabPicker(fileId, tabs, name);
        })
        .catch((err) => {
          console.error(err);
          showToast("Failed to read spreadsheet: " + err.message);
        });
    } else {
      showToast("Fetching " + name + "…");
      fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
        headers: { Authorization: "Bearer " + driveAccessToken },
      })
        .then((res) => {
          if (!res.ok) throw new Error("Drive request failed (" + res.status + ")");
          return res.text();
        })
        .then((text) => importCsvText(text))
        .catch((err) => {
          console.error(err);
          showToast("Failed to fetch file from Drive: " + err.message);
        });
    }
  }

  function importDriveSheetTab(fileId, tabName) {
    showToast(`Importing "${tabName}"…`);
    fetch(`https://sheets.googleapis.com/v4/spreadsheets/${fileId}/values/${encodeURIComponent(tabName)}`, {
      headers: { Authorization: "Bearer " + driveAccessToken },
    })
      .then((res) => { if (!res.ok) throw new Error("Couldn't read tab data (" + res.status + ")"); return res.json(); })
      .then((data) => {
        const values = data.values || [];
        if (values.length === 0) { showToast(`Tab "${tabName}" is empty`); return; }
        const csv = values.map((row) => row.map(csvEscape).join(",")).join("\n");
        importCsvText(csv);
      })
      .catch((err) => {
        console.error(err);
        showToast("Failed to import tab: " + err.message);
      });
  }

  function showSheetTabPicker(fileId, tabs, fileName) {
    const overlay = document.getElementById("drive-tab-overlay");
    const sheet = document.getElementById("drive-tab-sheet");
    sheet.innerHTML = `
      <div class="sheet-header">
        <button data-action="cancel-tab-pick">Cancel</button>
        <div class="sheet-title">Choose a tab</div>
        <span style="width:44px;"></span>
      </div>
      <div class="sheet-body">
        <div class="field-label" style="margin-top:0;">${escapeHtml(fileName)}</div>
        ${tabs.map((t) => `<div class="type-card" data-tab-name="${escapeHtml(t)}">📄<span class="lbl">${escapeHtml(t)}</span><span class="go">Import</span></div>`).join("")}
      </div>`;
    overlay.classList.remove("hidden");
    sheet.querySelector('[data-action="cancel-tab-pick"]').addEventListener("click", () => overlay.classList.add("hidden"));
    sheet.querySelectorAll("[data-tab-name]").forEach((el) => {
      el.addEventListener("click", () => {
        overlay.classList.add("hidden");
        importDriveSheetTab(fileId, el.dataset.tabName);
      });
    });
  }
  document.getElementById("drive-tab-overlay").addEventListener("click", (e) => {
    if (e.target.id === "drive-tab-overlay") e.currentTarget.classList.add("hidden");
  });

  document.getElementById("btn-import-drive").addEventListener("click", async () => {
    const clientId = localStorage.getItem(GOOGLE_CLIENT_ID_KEY);
    const apiKey = localStorage.getItem(GOOGLE_API_KEY_KEY);
    if (!clientId || !apiKey) {
      showToast("First save your Google Client ID and API Key below, then try again");
      return;
    }
    if (typeof google === "undefined" || !google.accounts) {
      showToast("Google sign-in script hasn't loaded yet — check your internet connection and try again.");
      return;
    }
    await ensurePickerLoaded();
    if (!driveTokenClient) {
      driveTokenClient = google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (resp) => {
          if (resp.error) { showToast("Google sign-in failed: " + resp.error); return; }
          driveAccessToken = resp.access_token;
          openDrivePicker();
        },
      });
    }
    driveTokenClient.requestAccessToken({ prompt: driveAccessToken ? "" : "consent" });
  });

  // ---------- Service worker ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => {
        reg.update();
        reg.addEventListener("updatefound", () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener("statechange", () => {
            if (newWorker.state === "activated") window.location.reload();
          });
        });
        // Re-check for a newer version every time the app is opened or
        // brought back to the foreground (e.g. reopening from the home
        // screen), not just on first load.
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") reg.update();
        });
      }).catch((e) => console.log("SW registration failed", e));
    });
  }

  // ---------- Init ----------
  (async function initApp() {
    state.txns = await loadTxnsFromDB();
    renderDashboard();
    renderTransactions();
    renderRentals();
  })();
})();
