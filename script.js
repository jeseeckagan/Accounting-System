/* Accounting Management System - Supabase version

   Tables used (the same ones you already created):
   accounts, journal_entries, journal_lines
*/
(function () {
  "use strict";

  const SUPABASE_URL = "https://ulxnnzlbrcjqcoapwrtl.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_LsI-4D7GIOcIIgxGRuW1sg_9eftkPpO";

  const TYPES = ["Asset", "Liability", "Equity", "Revenue", "Expense"];

  const VIEW_NAMES = {
    "dashboard": "Home Dashboard",
    "accounts": "Chart of Accounts",
    "transactions": "Business Transactions",
    "trial-balance": "Trial Balance",
    "adjustments": "Adjustments",
    "income-statement": "Income Statement",
    "owners-equity": "Statement of Owner's Equity"
  };
  const TABS = Object.keys(VIEW_NAMES);

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));

  const cents = v => Math.round((Number(v) || 0) * 100);

  const num = c =>
    (c / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });

  const fmt = c => c ? num(c) : "-";

  const fmtDate = d => {
    if (!d) return "";
    const x = new Date(d + "T00:00:00");
    return Number.isNaN(x.getTime())
      ? d
      : x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const todayISO = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  let supabaseClient = null;
  let user = null;
  let state = { accounts: [], entries: [] };
  let heading = { biz: "", period: "" };

  // -------------------------------
  // STATUS AND ERRORS
  // -------------------------------

  function setStatus(text) {
    $("#status").textContent = text;
  }

  function setAuthMessage(message, ok) {
    const el = $("#auth-msg");
    if (!el) return;
    el.textContent = message;
    el.className = "msg " + (ok ? "ok" : "bad");
  }

  function showError(where, error) {
    console.error(where, error);
    const text = where + ": " + (error?.message || "Something went wrong.");
    setStatus(text);
    if (!user) setAuthMessage(text, false);
  }

  function requireLogin() {
    if (user) return true;
    setAuthMessage("Please sign in first.", false);
    return false;
  }

  // -------------------------------
  // AUTHENTICATION
  // -------------------------------

  async function runAuth(action) {
    try {
      setAuthMessage(await action(), true);
    } catch (e) {
      setAuthMessage(e.message || "Authentication failed.", false);
    }
  }

  function bindAuth() {
    $("#auth-form").addEventListener("submit", async e => {
      e.preventDefault();

      const email = $("#auth-email").value.trim();
      const password = $("#auth-password").value;

      await runAuth(async () => {
        const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (error) throw error;
        return "Signed in successfully.";
      });
    });

    $("#auth-signup").addEventListener("click", async () => {
      const email = $("#auth-email").value.trim();
      const password = $("#auth-password").value;

      if (!email || password.length < 6) {
        setAuthMessage("Enter an email and a password with at least 6 characters.", false);
        return;
      }

      await runAuth(async () => {
        const { data, error } = await supabaseClient.auth.signUp({ email, password });
        if (error) throw error;

        if (data.session) return "Account created and signed in.";
        return "Account created. Check your email to confirm it, then sign in.";
      });
    });

    $("#auth-signout").addEventListener("click", async () => {
      closeMenu();
      const { error } = await supabaseClient.auth.signOut();
      if (error) showError("Could not sign out", error);
    });
  }

  function updateAuthUI() {
    document.body.classList.toggle("signed-out", !user);
    $("#login").hidden = !!user;
    $("#views").hidden = !user;

    if (user) {
      const email = user.email || "";
      $("#avatar").textContent = (email.charAt(0) || "U").toUpperCase();
      $("#menu-email").textContent = email ? "Signed in as " + email : "Signed in";
      $("#auth-password").value = "";
    } else {
      state = { accounts: [], entries: [] };
      closeMenu();
      $("#auth-password").value = "";
      renderAll();
      setAuthMessage("Sign in to access your Supabase data.", true);
    }
  }

  // -------------------------------
  // PAGE CHROME: MENU, TABS, ACCOUNT MENU
  // -------------------------------

  const isPhone = () => window.matchMedia("(max-width: 800px)").matches;

  function closeMenu() {
    $("#user-menu").hidden = true;
    $("#avatar").setAttribute("aria-expanded", "false");
  }

  function setTab(name) {
    if (!TABS.includes(name)) name = "dashboard";

    TABS.forEach(t => {
      $("#p-" + t).hidden = t !== name;
      $("#t-" + t).classList.toggle("active", t === name);
    });

    $("#view-title").textContent = VIEW_NAMES[name];

    try { history.replaceState(null, "", "#" + name); } catch (e) {}
  }

  function bindChrome() {
    $("#sidebar").addEventListener("click", e => {
      const b = e.target.closest("[data-tab]");
      if (!b) return;

      setTab(b.dataset.tab);
      document.body.classList.remove("nav-open");
      window.scrollTo(0, 0);
    });

    $("#nav-toggle").addEventListener("click", () => {
      document.body.classList.toggle(isPhone() ? "nav-open" : "nav-collapsed");
    });

    $("#backdrop").addEventListener("click", () => {
      document.body.classList.remove("nav-open");
    });

    $("#avatar").addEventListener("click", e => {
      e.stopPropagation();
      const menu = $("#user-menu");
      menu.hidden = !menu.hidden;
      $("#avatar").setAttribute("aria-expanded", String(!menu.hidden));
    });

    document.addEventListener("click", e => {
      if (!e.target.closest(".user")) closeMenu();
    });

    document.addEventListener("keydown", e => {
      if (e.key === "Escape") {
        closeMenu();
        document.body.classList.remove("nav-open");
      }
    });

    $("#refresh").addEventListener("click", async () => {
      if (!requireLogin()) return;
      setStatus("Loading your Supabase data...");
      await refresh();
    });
  }

  // -------------------------------
  // ACCOUNT HELPERS
  // -------------------------------

  function accSort(a, b) {
    const t = TYPES.indexOf(a.type) - TYPES.indexOf(b.type);
    if (t) return t;

    if ((a.code || "") !== (b.code || "")) {
      return (a.code || "") < (b.code || "") ? -1 : 1;
    }

    return Number(a.id) - Number(b.id);
  }

  const acctMap = () =>
    Object.fromEntries(state.accounts.map(a => [String(a.id), a]));

  const acctName = id => acctMap()[String(id)]?.name || "Unknown account";

  const acctLabel = a => (a.code ? a.code + " - " : "") + a.name;

  const hasCodes = () => state.accounts.some(a => a.code);

  const usage = id =>
    state.entries.reduce(
      (n, e) => n + e.lines.filter(l => String(l.acct) === String(id)).length,
      0
    );

  // -------------------------------
  // LOAD DATA FROM SUPABASE
  // -------------------------------

  async function loadData() {
    if (!user) return;

    setStatus("Loading your Supabase data...");

    const [aRes, eRes] = await Promise.all([
      supabaseClient
        .from("accounts")
        .select("id, code, name, type, normal_balance, user_id")
        .eq("user_id", user.id)
        .order("id"),

      supabaseClient
        .from("journal_entries")
        .select("id, user_id, entry_date, reference, description, is_adjustment, created_at")
        .eq("user_id", user.id)
        .order("entry_date")
        .order("id")
    ]);

    if (aRes.error) throw aRes.error;
    if (eRes.error) throw eRes.error;

    const entryRows = eRes.data || [];
    let lineRows = [];

    if (entryRows.length) {
      const { data, error } = await supabaseClient
        .from("journal_lines")
        .select("id, entry_id, account_id, debit, credit")
        .in("entry_id", entryRows.map(e => e.id))
        .order("id");

      if (error) throw error;
      lineRows = data || [];
    }

    state.accounts = (aRes.data || []).map(a => ({
      id: String(a.id),
      code: a.code || "",
      name: a.name,
      type: a.type,
      normal: a.normal_balance
    }));

    state.entries = entryRows.map(e => ({
      id: Number(e.id),
      date: e.entry_date,
      ref: e.reference || "",
      desc: e.description,
      adj: !!e.is_adjustment,
      lines: lineRows
        .filter(l => Number(l.entry_id) === Number(e.id))
        .map(l => ({
          id: l.id,
          acct: String(l.account_id),
          dr: Number(l.debit),
          cr: Number(l.credit)
        }))
    }));

    renderAll();

    setStatus(
      "Connected to Supabase | Accounts: " + state.accounts.length +
      " | Transactions: " + state.entries.filter(e => !e.adj).length +
      " | Adjustments: " + state.entries.filter(e => e.adj).length
    );
  }

  async function refresh() {
    try {
      await loadData();
    } catch (err) {
      showError("Could not load Supabase data", err);
    }
  }

  // -------------------------------
  // CALCULATIONS
  // -------------------------------

  function computeTB() {
    const rows = state.accounts
      .slice()
      .sort(accSort)
      .map(a => ({ a, udr: 0, ucr: 0, adr: 0, acr: 0 }));

    const map = Object.fromEntries(rows.map(r => [String(r.a.id), r]));

    state.entries.forEach(e => {
      e.lines.forEach(l => {
        const r = map[String(l.acct)];
        if (!r) return;

        if (e.adj) {
          r.adr += cents(l.dr);
          r.acr += cents(l.cr);
        } else {
          r.udr += cents(l.dr);
          r.ucr += cents(l.cr);
        }
      });
    });

    const t = { udr: 0, ucr: 0, adr: 0, acr: 0, fdr: 0, fcr: 0 };

    rows.forEach(r => {
      const un = r.udr - r.ucr;
      const ad = un + r.adr - r.acr;

      r.u = { dr: un > 0 ? un : 0, cr: un < 0 ? -un : 0 };
      r.f = { dr: ad > 0 ? ad : 0, cr: ad < 0 ? -ad : 0 };

      t.udr += r.u.dr;
      t.ucr += r.u.cr;
      t.adr += r.adr;
      t.acr += r.acr;
      t.fdr += r.f.dr;
      t.fcr += r.f.cr;
    });

    return { rows, t };
  }

  // Figures for the income statement and the statement of owner's equity.
  // They use the adjusted balances of each account.
  function computeStatements(tb) {
    const s = {
      rev: [], exp: [], cap: [], drw: [],
      totalRev: 0, totalExp: 0, net: 0,
      begin: 0, invest: 0, drawings: 0, ending: 0,
      capName: "Owner's Capital"
    };

    let capNameFound = false;

    tb.rows.forEach(r => {
      const a = r.a;
      const dr = r.f.dr;
      const cr = r.f.cr;

      if (a.type === "Revenue") {
        const v = cr - dr;
        if (v) s.rev.push({ name: a.name, v });
        s.totalRev += v;
      } else if (a.type === "Expense") {
        const v = dr - cr;
        if (v) s.exp.push({ name: a.name, v });
        s.totalExp += v;
      } else if (a.type === "Equity") {
        if (a.normal === "Credit") {
          const v = cr - dr;
          if (!capNameFound) { s.capName = a.name; capNameFound = true; }
          if (v) s.cap.push({ name: a.name, v });
          s.invest += v;
        } else {
          const v = dr - cr;
          if (v) s.drw.push({ name: a.name, v });
          s.drawings += v;
        }
      }
    });

    s.net = s.totalRev - s.totalExp;
    s.ending = s.begin + s.invest + s.net - s.drawings;

    return s;
  }

  // -------------------------------
  // DASHBOARD
  // -------------------------------

  function tileHTML(value, label, cls) {
    return '<div class="tile"><div class="tile-value ' + (cls || "") + '">' + esc(value) +
      '</div><div class="tile-label">' + esc(label) + "</div></div>";
  }

  function donutHTML(tx, aj) {
    const total = tx + aj;
    const R = 70;
    const C = 2 * Math.PI * R;
    const BLUE = "#0b7be6";
    const AMBER = "#e8a317";

    // The ring starts as one full circle, then the blue arc is drawn over it.
    // This leaves no seam where the two colors meet.
    const base = total && aj ? AMBER : "#e8eaed";

    let svg =
      '<svg class="donut-svg" viewBox="0 0 200 200" role="img" aria-label="' +
      tx + " transactions and " + aj + ' adjusting entries">' +
      '<circle cx="100" cy="100" r="' + R + '" fill="none" stroke="' + base + '" stroke-width="34"/>';

    if (tx) {
      const l1 = C * tx / total;
      svg += '<circle cx="100" cy="100" r="' + R + '" fill="none" stroke="' + BLUE +
        '" stroke-width="34" stroke-dasharray="' + l1 + " " + (C - l1) +
        '" transform="rotate(-90 100 100)"/>';
    }

    svg +=
      '<text x="100" y="102" text-anchor="middle" font-size="30" fill="#202124">' + total + "</text>" +
      '<text x="100" y="122" text-anchor="middle" font-size="12" fill="#5f6368">' +
      (total === 1 ? "entry" : "entries") + "</text></svg>";

    const pct = n => total ? Math.round(n * 100 / total) + "%" : "0%";

    return '<div class="donut">' + svg +
      '<div class="legend">' +
      '<span><i class="swatch" style="background:' + BLUE + '"></i>Transactions: ' + tx + " (" + pct(tx) + ")</span>" +
      '<span><i class="swatch" style="background:' + AMBER + '"></i>Adjusting Entries: ' + aj + " (" + pct(aj) + ")</span>" +
      "</div></div>";
  }

  function renderDashboard(tb) {
    const s = computeStatements(tb);
    const tx = state.entries.filter(e => !e.adj).length;
    const aj = state.entries.length - tx;
    const hasEntries = state.entries.length > 0;
    const balanced = tb.t.udr === tb.t.ucr && tb.t.fdr === tb.t.fcr;

    $("#tiles").innerHTML =
      tileHTML(String(tx), "Total Transactions", "blue") +
      tileHTML(String(aj), "Adjusting Entries", "") +
      tileHTML(String(state.accounts.length), "Accounts", "") +
      tileHTML(
        !hasEntries ? "NO ENTRIES" : balanced ? "BALANCED" : "NOT BALANCED",
        "Trial Balance Status",
        !hasEntries ? "" : balanced ? "good" : "bad"
      ) +
      tileHTML(num(s.totalRev), "Total Revenue", "green") +
      tileHTML(num(s.totalExp), "Total Expenses", "orange") +
      tileHTML(num(Math.abs(s.net)), s.net < 0 ? "Net Loss" : "Net Income", s.net < 0 ? "bad" : "green") +
      tileHTML(num(s.ending), s.capName + ", Ending", "");

    $("#donut").innerHTML = donutHTML(tx, aj);
  }

  // -------------------------------
  // FORMAL STATEMENTS
  // -------------------------------

  function stmtHead(title) {
    return '<div class="stmt-head">' +
      (heading.biz ? '<div class="stmt-biz">' + esc(heading.biz) + "</div>" : "") +
      '<div class="stmt-title">' + title + "</div>" +
      (heading.period ? "<div>" + esc(heading.period) + "</div>" : "") +
      "</div>";
  }

  function srow(label, item, total, opts) {
    opts = opts || {};
    return '<tr class="' + (opts.row || "") + '">' +
      '<td class="' + (opts.indent || "") + " " + (opts.dim ? "dim" : "") + '">' + label + "</td>" +
      '<td class="amt ' + (opts.itemCls || "") + '">' + (item === "" ? "" : item) + "</td>" +
      '<td class="amt ' + (opts.totalCls || "") + '">' + (total === "" ? "" : total) + "</td></tr>";
  }

  function incomeStatementHTML(s) {
    if (!state.entries.length) {
      return '<p class="empty">No entries yet. Post transactions and adjustments to see this statement.</p>';
    }

    let h = '<div class="stmt">' + stmtHead("Income Statement") + "<table><tbody>";

    h += srow("Revenues", "", "", { row: "sec" });
    if (s.rev.length) {
      s.rev.forEach(r => { h += srow(esc(r.name), num(r.v), "", { indent: "ind" }); });
    } else {
      h += srow("None", "", "", { indent: "ind", dim: true });
    }
    h += srow("Total Revenues", "", num(s.totalRev), { indent: "ind", totalCls: "rule" });

    h += srow("Expenses", "", "", { row: "sec" });
    if (s.exp.length) {
      s.exp.forEach(r => { h += srow(esc(r.name), num(r.v), "", { indent: "ind" }); });
    } else {
      h += srow("None", "", "", { indent: "ind", dim: true });
    }
    h += srow("Total Expenses", "", num(s.totalExp), { indent: "ind", totalCls: "rule" });

    h += srow(
      s.net < 0 ? "Net Loss" : "Net Income", "", num(Math.abs(s.net)),
      { row: "grand", totalCls: "dbl" }
    );

    return h + "</tbody></table></div>";
  }

  function equityStatementHTML(s) {
    if (!state.entries.length) {
      return '<p class="empty">No entries yet. Post transactions and adjustments to see this statement.</p>';
    }

    let h = '<div class="stmt">' + stmtHead("Statement of Owner's Equity") + "<table><tbody>";

    h += srow(esc(s.capName) + ", beginning", "", num(s.begin), {});

    if (s.cap.length > 1) {
      h += srow("Add: Investments", "", "", {});
      s.cap.forEach(c => { h += srow(esc(c.name), num(c.v), "", { indent: "ind" }); });
    } else {
      h += srow("Add: Investments", s.cap.length ? num(s.cap[0].v) : "0.00", "", {});
    }

    if (s.net < 0) {
      h += srow("Less: Net loss", num(-s.net), "", {});
    } else {
      h += srow("Add: Net income", num(s.net), "", {});
    }

    h += srow("", "", num(s.begin + s.invest + s.net), { totalCls: "rule" });

    if (s.drw.length > 1) {
      h += srow("Less: Drawings", "", "", {});
      s.drw.forEach(d => { h += srow(esc(d.name), num(d.v), "", { indent: "ind" }); });
    } else {
      h += srow("Less: Drawings", s.drw.length ? num(s.drw[0].v) : "0.00", "", {});
    }

    h += srow(esc(s.capName) + ", ending", "", num(s.ending), { row: "grand", totalCls: "dbl" });

    return h + "</tbody></table></div>";
  }

  function renderStatements(tb) {
    const s = computeStatements(tb);
    $("#is-out").innerHTML = incomeStatementHTML(s);
    $("#oe-out").innerHTML = equityStatementHTML(s);
  }

  function loadHeading() {
    try {
      const h = JSON.parse(localStorage.getItem("ams-heading"));
      if (h && typeof h === "object") {
        heading = { biz: String(h.biz || ""), period: String(h.period || "") };
      }
    } catch (e) {}

    ["is", "oe"].forEach(p => {
      $("#" + p + "-biz").value = heading.biz;
      $("#" + p + "-period").value = heading.period;

      ["biz", "period"].forEach(k => {
        $("#" + p + "-" + k).addEventListener("input", e => {
          heading[k] = e.target.value;

          ["is", "oe"].forEach(q => {
            if (q !== p) $("#" + q + "-" + k).value = heading[k];
          });

          try { localStorage.setItem("ams-heading", JSON.stringify(heading)); } catch (err) {}

          renderStatements(computeTB());
        });
      });
    });
  }

  // -------------------------------
  // TABLE DISPLAYS
  // -------------------------------

  function renderStatus(tb) {
    const tx = state.entries.filter(e => !e.adj).length;
    const aj = state.entries.length - tx;

    const bal = state.entries.length
      ? (tb.t.udr === tb.t.ucr && tb.t.fdr === tb.t.fcr)
        ? " | Trial balance: balanced"
        : " | Trial balance: NOT balanced"
      : "";

    setStatus(
      "Accounts: " + state.accounts.length +
      " | Transactions: " + tx +
      " | Adjustments: " + aj + bal
    );
  }

  function renderAccounts() {
    if (!state.accounts.length) {
      $("#coa").innerHTML = '<p class="empty">No accounts yet. Add your first account above.</p>';
      return;
    }

    const codes = hasCodes();

    let h =
      "<table><thead><tr>" +
      (codes ? "<th>Code</th>" : "") +
      "<th>Account name</th><th>Type</th><th>Normal balance</th>" +
      '<th class="num">Entries</th><th></th></tr></thead><tbody>';

    state.accounts.slice().sort(accSort).forEach(a => {
      h +=
        "<tr>" +
        (codes ? "<td>" + esc(a.code) + "</td>" : "") +
        "<td>" + esc(a.name) + "</td>" +
        "<td>" + esc(a.type) + "</td>" +
        "<td>" + esc(a.normal) + "</td>" +
        '<td class="num">' + usage(a.id) + "</td>" +
        '<td><button type="button" class="link" data-del="acct:' + esc(a.id) + '">Delete</button></td>' +
        "</tr>";
    });

    $("#coa").innerHTML = h + "</tbody></table>";
  }

  function journalHTML(adj) {
    const es = state.entries
      .filter(e => !!e.adj === adj)
      .slice()
      .sort((a, b) =>
        a.date < b.date ? -1 :
        a.date > b.date ? 1 :
        a.id - b.id
      );

    if (!es.length) {
      return '<p class="empty">' +
        (adj ? "No adjusting entries yet." : "No transactions yet.") + "</p>";
    }

    let td = 0;
    let tc = 0;

    let h =
      '<table class="journal"><thead><tr>' +
      "<th>Date</th><th>Transaction</th><th>Ref</th>" +
      '<th class="num">Debit</th><th class="num">Credit</th><th></th></tr></thead><tbody>';

    es.forEach(e => {
      h +=
        '<tr class="entry"><td>' + esc(fmtDate(e.date)) + "</td><td></td><td>" +
        esc(e.ref) + "</td><td></td><td></td><td></td></tr>";

      e.lines.forEach(l => {
        const d = cents(l.dr);
        const c = cents(l.cr);

        td += d;
        tc += c;

        h +=
          '<tr class="line"><td></td><td class="' + (c > 0 && d === 0 ? "ind2" : "ind1") + '">' +
          esc(acctName(l.acct)) + "</td><td></td>" +
          '<td class="num">' + (d ? num(d) : "") + "</td>" +
          '<td class="num">' + (c ? num(c) : "") + "</td><td></td></tr>";
      });

      h +=
        '<tr class="line last"><td></td><td class="ind2"><em>' + esc(e.desc) + "</em></td>" +
        '<td></td><td></td><td></td><td><button type="button" class="link" data-del="entry:' +
        esc(e.id) + '">Delete</button></td></tr>';
    });

    return h +
      '</tbody><tfoot><tr class="total"><td colspan="3">Total</td>' +
      '<td class="num">' + num(td) + '</td><td class="num">' + num(tc) + "</td><td></td></tr></tfoot></table>";
  }

  function renderJournals() {
    $("#tx-list").innerHTML = journalHTML(false);
    $("#adj-list").innerHTML = journalHTML(true);
  }

  function renderTB(tb) {
    if (!tb.rows.length) {
      $("#tb-wrap").innerHTML =
        '<p class="empty">No accounts yet. Add accounts and post entries to see the trial balance.</p>';
      $("#tb-summary").textContent = "";
      return;
    }

    const codes = hasCodes();

    let h =
      '<table class="tb"><thead><tr>' +
      (codes ? '<th rowspan="2">Code</th>' : "") +
      '<th rowspan="2">Account</th>' +
      '<th colspan="2" class="num">Unadjusted</th>' +
      '<th colspan="2" class="num">Adjustments</th>' +
      '<th colspan="2" class="num">Adjusted</th></tr><tr>' +
      '<th class="num">Debit</th><th class="num">Credit</th>' +
      '<th class="num">Debit</th><th class="num">Credit</th>' +
      '<th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>';

    tb.rows.forEach(r => {
      h +=
        "<tr>" +
        (codes ? "<td>" + esc(r.a.code) + "</td>" : "") +
        "<td>" + esc(r.a.name) + "</td>" +
        '<td class="num">' + fmt(r.u.dr) + "</td>" +
        '<td class="num">' + fmt(r.u.cr) + "</td>" +
        '<td class="num">' + fmt(r.adr) + "</td>" +
        '<td class="num">' + fmt(r.acr) + "</td>" +
        '<td class="num">' + fmt(r.f.dr) + "</td>" +
        '<td class="num">' + fmt(r.f.cr) + "</td></tr>";
    });

    const t = tb.t;

    h +=
      '</tbody><tfoot><tr class="total">' + (codes ? "<td></td>" : "") + "<td>Total</td>" +
      '<td class="num">' + num(t.udr) + '</td><td class="num">' + num(t.ucr) + "</td>" +
      '<td class="num">' + num(t.adr) + '</td><td class="num">' + num(t.acr) + "</td>" +
      '<td class="num">' + num(t.fdr) + '</td><td class="num">' + num(t.fcr) + "</td></tr></tfoot></table>";

    $("#tb-wrap").innerHTML = h;

    const s = computeStatements(tb);
    $("#tb-summary").textContent =
      (s.net < 0 ? "Net loss (adjusted): " : "Net income (adjusted): ") + num(Math.abs(s.net));
  }

  function renderAll() {
    const tb = computeTB();

    renderStatus(tb);
    renderDashboard(tb);
    renderAccounts();
    renderJournals();
    renderTB(tb);
    renderStatements(tb);
    refreshOptions();

    // Forms are locked until you sign in.
    $$("#acct-form input, #acct-form select, #acct-form button")
      .forEach(el => { el.disabled = !user; });

    ["tx", "adj"].forEach(p => {
      $$("#" + p + "-f input, #" + p + "-f select, #" + p + "-f button")
        .forEach(el => { el.disabled = !user; });
    });

    ["tx", "adj"].forEach(recalc);
  }

  // -------------------------------
  // ADD ACCOUNT
  // -------------------------------

  function bindAccountForm() {
    $("#a-type").innerHTML = TYPES.map(t => "<option>" + t + "</option>").join("");

    $("#a-type").addEventListener("change", function () {
      $("#a-normal").value =
        (this.value === "Asset" || this.value === "Expense") ? "Debit" : "Credit";
    });

    $("#acct-form").addEventListener("submit", async e => {
      e.preventDefault();

      if (!requireLogin()) return;

      const code = $("#a-code").value.trim();
      const name = $("#a-name").value.trim();
      const m = $("#a-msg");

      const say = (t, ok) => {
        m.textContent = t;
        m.className = "msg " + (ok ? "ok" : "bad");
      };

      if (!name) return say("Enter an account name.", false);

      if (state.accounts.some(a =>
        a.name.toLowerCase() === name.toLowerCase() || (code && a.code === code)
      )) {
        return say("That account name or code already exists.", false);
      }

      const { data, error } = await supabaseClient
        .from("accounts")
        .insert({
          user_id: user.id,
          code: code || null,
          name,
          type: $("#a-type").value,
          normal_balance: $("#a-normal").value
        })
        .select()
        .single();

      if (error) return say(error.message, false);

      state.accounts.push({
        id: String(data.id),
        code: data.code || "",
        name: data.name,
        type: data.type,
        normal: data.normal_balance
      });

      $("#a-code").value = "";
      $("#a-name").value = "";

      renderAll();

      say("Added " + name + ".", true);
    });
  }

  // -------------------------------
  // JOURNAL ENTRY FORMS
  // -------------------------------

  function acctOptions(sel) {
    return '<option value="">Select account</option>' +
      state.accounts
        .slice()
        .sort(accSort)
        .map(a =>
          '<option value="' + esc(a.id) + '"' +
          (String(a.id) === String(sel) ? " selected" : "") +
          ">" + esc(acctLabel(a)) + "</option>"
        )
        .join("");
  }

  function refreshOptions() {
    $$("select.in-acct").forEach(s => {
      const v = s.value;
      s.innerHTML = acctOptions(v);
      s.value = v;
    });
  }

  function addLine(p) {
    const tr = document.createElement("tr");

    tr.innerHTML =
      '<td><select class="in-acct" aria-label="Account">' + acctOptions("") + "</select></td>" +
      '<td><input class="in-dr num" type="number" min="0" step="0.01" aria-label="Debit amount"></td>' +
      '<td><input class="in-cr num" type="number" min="0" step="0.01" aria-label="Credit amount"></td>' +
      '<td><button type="button" class="link rm">Remove</button></td>';

    $("#" + p + "-lines").appendChild(tr);
  }

  function resetLines(p) {
    $("#" + p + "-lines").innerHTML = "";
    addLine(p);
    addLine(p);
    recalc(p);
  }

  function readLines(p) {
    return $$("#" + p + "-lines tr")
      .map(r => ({
        acct: $(".in-acct", r).value,
        dr: +$(".in-dr", r).value || 0,
        cr: +$(".in-cr", r).value || 0
      }))
      .filter(l => l.acct && (l.dr > 0 || l.cr > 0));
  }

  function recalc(p) {
    if (!$("#" + p + "-lines")) return;

    const ls = readLines(p);

    let td = 0;
    let tc = 0;

    ls.forEach(l => {
      td += cents(l.dr);
      tc += cents(l.cr);
    });

    $("#" + p + "-dt").textContent = num(td);
    $("#" + p + "-ct").textContent = num(tc);

    const m = $("#" + p + "-msg");
    const ok = td > 0 && td === tc && ls.length >= 2;

    if (!user) {
      m.textContent = "Sign in to post entries.";
      m.className = "msg";
    } else if (!state.accounts.length) {
      m.textContent = "Add accounts in the Chart of Accounts first.";
      m.className = "msg";
    } else if (!ls.length) {
      m.textContent = "Choose accounts and enter amounts.";
      m.className = "msg";
    } else if (ok) {
      m.textContent = "Debits equal credits. Ready to post.";
      m.className = "msg ok";
    } else if (td === tc) {
      m.textContent = "Add at least two lines.";
      m.className = "msg";
    } else {
      m.textContent = "Out of balance by " + num(Math.abs(td - tc)) + ".";
      m.className = "msg bad";
    }

    $("#" + p + "-post").disabled = !user || !ok;
  }

  function buildForm(p, adj) {
    $("#" + p + "-form").innerHTML =
      '<form class="box" id="' + p + '-f" autocomplete="off">' +
      '<div class="row">' +
      '<label>Date<input type="date" id="' + p + '-date" required></label>' +
      '<label>Reference (optional)<input type="text" id="' + p + '-ref" maxlength="20"></label>' +
      '<label class="grow">Description<input type="text" id="' + p + '-desc" maxlength="120" required></label>' +
      "</div>" +
      '<div class="table-wrap"><table class="lines">' +
      '<thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th><th></th></tr></thead>' +
      '<tbody id="' + p + '-lines"></tbody>' +
      '<tfoot><tr class="total"><td>Total</td>' +
      '<td class="num" id="' + p + '-dt"></td><td class="num" id="' + p + '-ct"></td><td></td></tr></tfoot>' +
      "</table></div>" +
      '<div class="actions">' +
      '<button type="button" class="btn" id="' + p + '-add">Add line</button>' +
      '<span class="msg" id="' + p + '-msg"></span>' +
      '<button type="submit" class="btn primary" id="' + p + '-post" disabled>' +
      (adj ? "Post adjustment" : "Post transaction") + "</button>" +
      "</div></form>";

    $("#" + p + "-date").value = todayISO();

    resetLines(p);

    const form = $("#" + p + "-f");

    $("#" + p + "-add").addEventListener("click", () => addLine(p));

    form.addEventListener("input", e => {
      const t = e.target;

      if (t.classList.contains("in-dr") && t.value) $(".in-cr", t.closest("tr")).value = "";
      if (t.classList.contains("in-cr") && t.value) $(".in-dr", t.closest("tr")).value = "";

      recalc(p);
    });

    form.addEventListener("change", () => recalc(p));

    form.addEventListener("click", e => {
      const b = e.target.closest(".rm");
      if (!b) return;

      const tr = b.closest("tr");

      if ($$("#" + p + "-lines tr").length > 2) {
        tr.remove();
      } else {
        $(".in-acct", tr).value = "";
        $(".in-dr", tr).value = "";
        $(".in-cr", tr).value = "";
      }

      recalc(p);
    });

    form.addEventListener("submit", e => {
      e.preventDefault();
      post(p, adj);
    });
  }

  // -------------------------------
  // SAVE JOURNAL ENTRIES TO SUPABASE
  // -------------------------------

  async function post(p, adj) {
    if (!requireLogin()) return;

    const m = $("#" + p + "-msg");

    const say = t => {
      m.textContent = t;
      m.className = "msg bad";
    };

    const date = $("#" + p + "-date").value;
    const desc = $("#" + p + "-desc").value.trim();
    const ref = $("#" + p + "-ref").value.trim();
    const ls = readLines(p);

    let td = 0;
    let tc = 0;

    ls.forEach(l => {
      td += cents(l.dr);
      tc += cents(l.cr);
    });

    if (!date) return say("Choose a date.");
    if (!desc) return say("Add a description.");
    if (ls.length < 2) return say("An entry needs at least two lines.");
    if (td !== tc || td === 0) return say("Debits and credits must match.");

    $("#" + p + "-post").disabled = true;

    const { data: entry, error: entryError } = await supabaseClient
      .from("journal_entries")
      .insert({
        user_id: user.id,
        entry_date: date,
        reference: ref || null,
        description: desc,
        is_adjustment: adj
      })
      .select()
      .single();

    if (entryError) {
      recalc(p);
      return say(entryError.message);
    }

    const linePayload = ls.map(l => ({
      entry_id: entry.id,
      account_id: Number(l.acct),
      debit: l.dr,
      credit: l.cr
    }));

    const { error: lineError } = await supabaseClient
      .from("journal_lines")
      .insert(linePayload);

    if (lineError) {
      const { error: rollbackError } = await supabaseClient
        .from("journal_entries")
        .delete()
        .eq("id", entry.id)
        .eq("user_id", user.id);

      if (rollbackError) console.error("Entry cleanup failed:", rollbackError);

      recalc(p);

      return say(
        "Could not save journal lines. Check your database policies: " + lineError.message
      );
    }

    $("#" + p + "-desc").value = "";
    $("#" + p + "-ref").value = "";

    resetLines(p);

    await refresh();

    $("#" + p + "-msg").textContent = "Entry posted successfully.";
    $("#" + p + "-msg").className = "msg ok";
  }

  // -------------------------------
  // DELETE AND CLEAR ACTIONS
  // -------------------------------

  function disarm(b) {
    delete b.dataset.armed;
    b.classList.remove("armed");
    if (b.dataset.orig) b.textContent = b.dataset.orig;
  }

  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-del],[data-act]");

    if (!b) return;
    if (!requireLogin()) return;

    if (!b.dataset.armed) {
      b.dataset.armed = "1";
      b.dataset.orig = b.textContent;
      b.textContent = "Click again to confirm";
      b.classList.add("armed");

      setTimeout(() => {
        if (b.isConnected && b.dataset.armed) disarm(b);
      }, 3500);

      return;
    }

    disarm(b);

    if (b.dataset.act === "clear") {
      if (!confirm(
        "Delete all your accounting entries and accounts from Supabase? This cannot be undone."
      )) return;

      const { error: e1 } = await supabaseClient
        .from("journal_entries")
        .delete()
        .eq("user_id", user.id);

      if (e1) return showError("Could not clear entries", e1);

      const { error: e2 } = await supabaseClient
        .from("accounts")
        .delete()
        .eq("user_id", user.id);

      if (e2) return showError("Could not clear accounts", e2);

      await refresh();
      return;
    }

    const [kind, id] = (b.dataset.del || "").split(":");

    if (kind === "entry") {
      const { error } = await supabaseClient
        .from("journal_entries")
        .delete()
        .eq("id", Number(id))
        .eq("user_id", user.id);

      if (error) return showError("Could not delete entry", error);

      await refresh();

    } else if (kind === "acct") {
      if (usage(id)) {
        const m = $("#a-msg");

        m.textContent =
          acctName(id) + " is used in journal entries. Delete those entries first.";
        m.className = "msg bad";
        return;
      }

      const { error } = await supabaseClient
        .from("accounts")
        .delete()
        .eq("id", Number(id))
        .eq("user_id", user.id);

      if (error) return showError("Could not delete account", error);

      await refresh();
    }
  });

  // -------------------------------
  // START APPLICATION
  // -------------------------------

  async function start() {
    bindAuth();
    bindChrome();
    bindAccountForm();
    buildForm("tx", false);
    buildForm("adj", true);
    loadHeading();

    setTab((location.hash || "").slice(1));

    if (isPhone()) document.body.classList.remove("nav-open");

    const { data, error } = await supabaseClient.auth.getSession();

    if (error) {
      showError("Could not check login", error);
      return;
    }

    user = data.session?.user || null;

    updateAuthUI();

    if (user) await refresh();

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      const previous = user;
      user = session?.user || null;

      updateAuthUI();

      if (user && (!previous || previous.id !== user.id)) refresh();
    });
  }

  if (!window.supabase || !window.supabase.createClient) {
    setAuthMessage(
      "Could not load the Supabase library. Check your internet connection and reload.",
      false
    );
    console.error("Missing Supabase client library.");
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

  start().catch(err => showError("Startup error", err));

})();