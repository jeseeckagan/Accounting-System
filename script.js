(function () {
  var KEY = "ams-books-v1";
  var TYPES = ["Asset", "Liability", "Equity", "Revenue", "Expense"];
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); };
  var cents = function (v) { return Math.round((+v || 0) * 100); };
  var fmt = function (c) { return c ? (c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "–"; };
  var peso = function (c) { return "₱" + (c / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var fmtDate = function (d) { var x = new Date(d + "T00:00:00"); return isNaN(x) ? d : x.toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }); };
  var byCode = function (a, b) { return a.code < b.code ? -1 : a.code > b.code ? 1 : 0; };

  /* ---------- sample books ---------- */
  function sampleState() {
    var accounts = [
      ["1000", "Cash", "Asset", "Debit"], ["1010", "Accounts Receivable", "Asset", "Debit"],
      ["1020", "Supplies", "Asset", "Debit"], ["1030", "Prepaid Insurance", "Asset", "Debit"],
      ["1500", "Equipment", "Asset", "Debit"], ["1510", "Accumulated Depreciation, Equipment", "Asset", "Credit"],
      ["2000", "Accounts Payable", "Liability", "Credit"], ["2010", "Salaries Payable", "Liability", "Credit"],
      ["2020", "Unearned Revenue", "Liability", "Credit"],
      ["3000", "Owner's Capital", "Equity", "Credit"], ["3010", "Owner's Drawings", "Equity", "Debit"],
      ["4000", "Service Revenue", "Revenue", "Credit"],
      ["5000", "Salaries Expense", "Expense", "Debit"], ["5010", "Rent Expense", "Expense", "Debit"],
      ["5020", "Supplies Expense", "Expense", "Debit"], ["5030", "Utilities Expense", "Expense", "Debit"],
      ["5040", "Insurance Expense", "Expense", "Debit"], ["5050", "Depreciation Expense", "Expense", "Debit"]
    ].map(function (a) { return { code: a[0], name: a[1], type: a[2], normal: a[3] }; });
    // [date, ref, description, adj?, [[code, debit, credit], ...]]
    var raw = [
      ["2026-10-01", "J-001", "Owner invested cash in the business", 0, [["1000", 500000, 0], ["3000", 0, 500000]]],
      ["2026-10-02", "J-002", "Purchased printing equipment for cash", 0, [["1500", 120000, 0], ["1000", 0, 120000]]],
      ["2026-10-03", "J-003", "Paid 12-month insurance premium in advance", 0, [["1030", 24000, 0], ["1000", 0, 24000]]],
      ["2026-10-05", "J-004", "Bought paper and ink supplies on account", 0, [["1020", 15000, 0], ["2000", 0, 15000]]],
      ["2026-10-06", "J-005", "Paid October shop rent", 0, [["5010", 18000, 0], ["1000", 0, 18000]]],
      ["2026-10-08", "J-006", "Printing services, paid in cash", 0, [["1000", 85000, 0], ["4000", 0, 85000]]],
      ["2026-10-10", "J-007", "Design services billed to client", 0, [["1010", 60000, 0], ["4000", 0, 60000]]],
      ["2026-10-12", "J-008", "Advance payment received for a December job", 0, [["1000", 30000, 0], ["2020", 0, 30000]]],
      ["2026-10-15", "J-009", "Paid staff salaries", 0, [["5000", 40000, 0], ["1000", 0, 40000]]],
      ["2026-10-17", "J-010", "Collected from client on account", 0, [["1000", 35000, 0], ["1010", 0, 35000]]],
      ["2026-10-18", "J-011", "Paid electricity and water", 0, [["5030", 6500, 0], ["1000", 0, 6500]]],
      ["2026-10-19", "J-012", "Owner withdrew cash for personal use", 0, [["3010", 20000, 0], ["1000", 0, 20000]]],
      ["2026-10-20", "J-013", "Paid part of supplier account", 0, [["2000", 8000, 0], ["1000", 0, 8000]]],
      ["2026-10-31", "AJE-001", "Supplies used during the month (9,000 on hand)", 1, [["5020", 6000, 0], ["1020", 0, 6000]]],
      ["2026-10-31", "AJE-002", "Insurance expired for October (24,000 / 12)", 1, [["5040", 2000, 0], ["1030", 0, 2000]]],
      ["2026-10-31", "AJE-003", "Depreciation of equipment (120,000 / 60 months)", 1, [["5050", 2000, 0], ["1510", 0, 2000]]],
      ["2026-10-31", "AJE-004", "Salaries earned but unpaid at month end", 1, [["5000", 12000, 0], ["2010", 0, 12000]]],
      ["2026-10-31", "AJE-005", "Advance billing earned in October", 1, [["2020", 10000, 0], ["4000", 0, 10000]]]
    ];
    var entries = raw.map(function (r, i) {
      return { id: i + 1, date: r[0], ref: r[1], desc: r[2], adj: !!r[3],
        lines: r[4].map(function (l) { return { code: l[0], dr: l[1], cr: l[2] }; }) };
    });
    return { accounts: accounts, entries: entries, nextId: raw.length + 1 };
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.accounts) && Array.isArray(s.entries)) return s;
    } catch (e) {}
    return null;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  var state = load() || sampleState();

  var acctMap = function () { var m = {}; state.accounts.forEach(function (a) { m[a.code] = a; }); return m; };
  var acctName = function (code) { var a = acctMap()[code]; return a ? a.name : code; };
  var usage = function (code) {
    return state.entries.reduce(function (n, e) { return n + e.lines.filter(function (l) { return l.code === code; }).length; }, 0);
  };

  /* ---------- calculations ---------- */
  function computeTB() {
    var rows = state.accounts.slice().sort(byCode).map(function (a) {
      return { a: a, udr: 0, ucr: 0, adr: 0, acr: 0 };
    });
    var map = {}; rows.forEach(function (r) { map[r.a.code] = r; });
    state.entries.forEach(function (e) {
      e.lines.forEach(function (l) {
        var r = map[l.code]; if (!r) return;
        if (e.adj) { r.adr += cents(l.dr); r.acr += cents(l.cr); }
        else { r.udr += cents(l.dr); r.ucr += cents(l.cr); }
      });
    });
    var t = { udr: 0, ucr: 0, adr: 0, acr: 0, fdr: 0, fcr: 0 };
    rows.forEach(function (r) {
      var un = r.udr - r.ucr, ad = un + r.adr - r.acr;
      r.u = { dr: un > 0 ? un : 0, cr: un < 0 ? -un : 0 };
      r.f = { dr: ad > 0 ? ad : 0, cr: ad < 0 ? -ad : 0 };
      t.udr += r.u.dr; t.ucr += r.u.cr; t.adr += r.adr; t.acr += r.acr; t.fdr += r.f.dr; t.fcr += r.f.cr;
    });
    return { rows: rows, t: t };
  }

  /* ---------- rendering ---------- */
  function renderPills(tb) {
    var tx = state.entries.filter(function (e) { return !e.adj; }).length;
    var aj = state.entries.length - tx;
    var ok = tb.t.udr === tb.t.ucr && tb.t.fdr === tb.t.fcr;
    $("#pills").innerHTML =
      '<span class="pill"><b>' + state.accounts.length + '</b> accounts</span>' +
      '<span class="pill"><b>' + tx + '</b> transactions</span>' +
      '<span class="pill"><b>' + aj + '</b> adjustments</span>' +
      '<span class="pill ' + (ok ? "ok" : "bad") + '">' + (ok ? "Trial balance is in balance" : "Trial balance is out of balance") + "</span>";
  }

  function renderAccounts() {
    var h = '<thead><tr><th>Code</th><th>Account name</th><th>Normal balance</th><th class="num">Entries</th><th></th></tr></thead><tbody>';
    TYPES.forEach(function (t) {
      var list = state.accounts.filter(function (a) { return a.type === t; }).sort(byCode);
      if (!list.length) return;
      h += '<tr class="grp"><td colspan="5">' + { Asset: "Assets", Liability: "Liabilities", Equity: "Equity", Revenue: "Revenue", Expense: "Expenses" }[t] + "</td></tr>";
      list.forEach(function (a) {
        var n = usage(a.code);
        h += '<tr><td class="code">' + esc(a.code) + "</td><td>" + esc(a.name) + '</td><td><span class="tag">' + a.normal + '</span></td><td class="num">' + (n || "–") +
          '</td><td style="text-align:right"><button class="link" data-del="acct:' + esc(a.code) + '">Delete</button></td></tr>';
      });
    });
    $("#coa").innerHTML = h + "</tbody>";
  }

  function journalHTML(adj, q) {
    var es = state.entries.filter(function (e) { return !!e.adj === adj; });
    if (q) {
      q = q.toLowerCase();
      es = es.filter(function (e) {
        return (e.desc + " " + e.ref + " " + e.lines.map(function (l) { return l.code + " " + acctName(l.code); }).join(" ")).toLowerCase().indexOf(q) > -1;
      });
    }
    if (!es.length) return '<p class="empty">' + (q ? "No entries match that search." : adj ? "No adjusting entries yet. Use the form above to post one." : "No transactions yet. Use the form above to post the first one.") + "</p>";
    es.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id; });
    var td = 0, tc = 0;
    var h = '<table class="journal"><thead><tr><th>Date</th><th>Particulars</th><th>Ref</th><th class="num">Debit</th><th class="num">Credit</th><th></th></tr></thead><tbody>';
    es.forEach(function (e) {
      h += '<tr class="e"><td class="dim" style="white-space:nowrap">' + fmtDate(e.date) + "</td><td><b>" + esc(e.desc) + '</b></td><td class="code">' + esc(e.ref) +
        '</td><td></td><td></td><td style="text-align:right"><button class="link" data-del="entry:' + e.id + '">Delete</button></td></tr>';
      e.lines.forEach(function (l, i) {
        var d = cents(l.dr), c = cents(l.cr); td += d; tc += c;
        h += '<tr class="l' + (i === e.lines.length - 1 ? " last" : "") + '"><td></td><td class="' + (c > 0 && d === 0 ? "d2" : "d1") + '">' + esc(acctName(l.code)) +
          ' <span class="code">' + esc(l.code) + '</span></td><td></td><td class="num">' + (d ? fmt(d) : "") + '</td><td class="num">' + (c ? fmt(c) : "") + "</td><td></td></tr>";
      });
    });
    return h + '</tbody><tfoot><tr><td colspan="3">Total</td><td class="num">' + fmt(td) + '</td><td class="num">' + fmt(tc) + "</td><td></td></tr></tfoot></table>";
  }
  function renderJournals() {
    $("#tx-list").innerHTML = journalHTML(false, $("#tx-q").value.trim());
    $("#adj-list").innerHTML = journalHTML(true, "");
  }

  function renderTB(tb) {
    var h = '<table class="tb"><thead><tr><th rowspan="2">Code</th><th rowspan="2">Account</th>' +
      '<th class="grp" colspan="2">Unadjusted</th><th class="grp g-adj" colspan="2">Adjustments</th><th class="grp g-fin" colspan="2">Adjusted</th></tr><tr>' +
      '<th class="num bl">Debit</th><th class="num">Credit</th><th class="num g-adj bl">Debit</th><th class="num g-adj">Credit</th><th class="num g-fin bl">Debit</th><th class="num g-fin">Credit</th></tr></thead><tbody>';
    tb.rows.forEach(function (r) {
      h += '<tr><td class="code">' + esc(r.a.code) + "</td><td>" + esc(r.a.name) + '</td><td class="num bl">' + fmt(r.u.dr) + '</td><td class="num">' + fmt(r.u.cr) +
        '</td><td class="num g-adj bl">' + fmt(r.adr) + '</td><td class="num g-adj">' + fmt(r.acr) + '</td><td class="num g-fin bl">' + fmt(r.f.dr) + '</td><td class="num g-fin">' + fmt(r.f.cr) + "</td></tr>";
    });
    var t = tb.t;
    h += '</tbody><tfoot><tr><td></td><td>Totals</td><td class="num bl">' + fmt(t.udr) + '</td><td class="num">' + fmt(t.ucr) + '</td><td class="num g-adj bl">' + fmt(t.adr) +
      '</td><td class="num g-adj">' + fmt(t.acr) + '</td><td class="num g-fin bl">' + fmt(t.fdr) + '</td><td class="num g-fin">' + fmt(t.fcr) + "</td></tr></tfoot></table>";
    $("#tb-wrap").innerHTML = h;
    var rev = 0, exp = 0;
    tb.rows.forEach(function (r) {
      if (r.a.type === "Revenue") rev += r.f.cr - r.f.dr;
      if (r.a.type === "Expense") exp += r.f.dr - r.f.cr;
    });
    $("#tb-summary").innerHTML =
      "<div><span>Revenue (adjusted)</span><b>" + peso(rev) + "</b></div><div><span>Expenses (adjusted)</span><b>" + peso(exp) + "</b></div><div><span>Net income</span><b>" + peso(rev - exp) + "</b></div>" +
      "<div><span>Difference, adjusted</span><b>" + peso(Math.abs(t.fdr - t.fcr)) + "</b></div>";
  }

  function renderAll() {
    var tb = computeTB();
    renderPills(tb); renderAccounts(); renderJournals(); renderTB(tb); refreshOptions();
  }

  /* ---------- tabs ---------- */
  var TABS = ["accounts", "transactions", "trial-balance", "adjustments"];
  function setTab(name) {
    if (TABS.indexOf(name) < 0) name = "accounts";
    TABS.forEach(function (t) {
      $("#p-" + t).hidden = t !== name;
      $("#t-" + t).setAttribute("aria-selected", t === name ? "true" : "false");
    });
  }
  $(".tabs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab);
  });

  /* ---------- chart of accounts form ---------- */
  $("#a-type").innerHTML = TYPES.map(function (t) { return "<option>" + t + "</option>"; }).join("");
  $("#a-type").addEventListener("change", function () {
    $("#a-normal").value = (this.value === "Asset" || this.value === "Expense") ? "Debit" : "Credit";
  });
  $("#acct-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var code = $("#a-code").value.trim(), name = $("#a-name").value.trim(), m = $("#a-msg");
    function say(t, ok) { m.textContent = t; m.className = "msg " + (ok ? "ok" : "bad"); }
    if (!code || !name) return say("Enter both a code and a name.");
    if (!/^[A-Za-z0-9-]+$/.test(code)) return say("Use letters, digits or hyphens in the account code.");
    if (acctMap()[code]) return say("Code " + code + " is already used by " + acctMap()[code].name + ".");
    state.accounts.push({ code: code, name: name, type: $("#a-type").value, normal: $("#a-normal").value });
    save(); renderAll();
    $("#a-code").value = ""; $("#a-name").value = "";
    say("Added " + code + " " + name + ".", true);
  });

  /* ---------- journal entry forms ---------- */
  var TPL = [
    { label: "Supplies used", desc: "Supplies used during the month", dr: "5020", cr: "1020" },
    { label: "Prepaid insurance expired", desc: "Insurance expense for the month", dr: "5040", cr: "1030" },
    { label: "Depreciation", desc: "Depreciation of equipment for the month", dr: "5050", cr: "1510" },
    { label: "Accrued salaries", desc: "Salaries earned but not yet paid", dr: "5000", cr: "2010" },
    { label: "Unearned revenue earned", desc: "Advance billings now earned", dr: "2020", cr: "4000" },
    { label: "Accrued revenue", desc: "Services rendered but not yet billed", dr: "1010", cr: "4000" },
    { label: "Accrued utilities", desc: "Utilities used but not yet billed", dr: "5030", cr: "2000" }
  ];
  function todayISO() { var d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function monthEndISO() { var d = new Date(); var e = new Date(d.getFullYear(), d.getMonth() + 1, 0); return e.getFullYear() + "-" + String(e.getMonth() + 1).padStart(2, "0") + "-" + String(e.getDate()).padStart(2, "0"); }

  function acctOptions(sel) {
    return '<option value="">Select account</option>' + state.accounts.slice().sort(byCode).map(function (a) {
      return '<option value="' + esc(a.code) + '"' + (a.code === sel ? " selected" : "") + ">" + esc(a.code) + " – " + esc(a.name) + "</option>";
    }).join("");
  }
  function refreshOptions() {
    $$("select.in-acct").forEach(function (s) { var v = s.value; s.innerHTML = acctOptions(v); s.value = v; });
  }
  function addLine(p, code, dr, cr) {
    var tr = document.createElement("tr");
    tr.innerHTML = '<td><select class="in-acct" aria-label="Account">' + acctOptions(code) + "</select></td>" +
      '<td><input class="in-dr" type="number" min="0" step="0.01" inputmode="decimal" aria-label="Debit amount" value="' + (dr || "") + '"></td>' +
      '<td><input class="in-cr" type="number" min="0" step="0.01" inputmode="decimal" aria-label="Credit amount" value="' + (cr || "") + '"></td>' +
      '<td class="rm"><button type="button" class="link" aria-label="Remove line">Remove</button></td>';
    $("#" + p + "-lines").appendChild(tr);
  }
  function resetLines(p) { $("#" + p + "-lines").innerHTML = ""; addLine(p); addLine(p); recalc(p); }
  function readLines(p) {
    return $$("#" + p + "-lines tr").map(function (r) {
      return { code: $(".in-acct", r).value, dr: +$(".in-dr", r).value || 0, cr: +$(".in-cr", r).value || 0 };
    }).filter(function (l) { return l.code && (l.dr > 0 || l.cr > 0); });
  }
  function recalc(p) {
    var ls = readLines(p), td = 0, tc = 0;
    ls.forEach(function (l) { td += cents(l.dr); tc += cents(l.cr); });
    $("#" + p + "-dt").textContent = fmt(td); $("#" + p + "-ct").textContent = fmt(tc);
    var m = $("#" + p + "-msg"), ok = td > 0 && td === tc && ls.length >= 2;
    if (!ls.length) { m.textContent = "Pick accounts and enter amounts."; m.className = "msg"; }
    else if (td === tc && td > 0) { m.textContent = ls.length < 2 ? "Add at least two lines." : "Balanced. Ready to post."; m.className = "msg " + (ls.length < 2 ? "" : "ok"); }
    else { m.textContent = "Out of balance by " + peso(Math.abs(td - tc)) + "."; m.className = "msg bad"; }
    $("#" + p + "-post").disabled = !ok;
  }
  function buildForm(p, adj) {
    $("#" + p + "-form").innerHTML =
      '<form class="card" id="' + p + '-f" autocomplete="off">' +
      (adj ? '<div class="tpl f-row"><label class="wide">Common adjustment<select id="adj-tpl"><option value="">Choose a template</option>' +
        TPL.map(function (t, i) { return '<option value="' + i + '">' + t.label + "</option>"; }).join("") +
        '</select></label><label>Amount<input id="adj-amt" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0.00"></label><button type="button" class="btn" id="adj-apply">Fill entry</button></div>' : "") +
      '<div class="f-row"><label>Date<input type="date" id="' + p + '-date" required></label>' +
      '<label>Reference<input type="text" id="' + p + '-ref" maxlength="20" placeholder="' + (adj ? "AJE-006" : "J-014") + '"></label>' +
      '<label class="grow">Description<input type="text" id="' + p + '-desc" maxlength="120" required placeholder="' + (adj ? "What is being adjusted" : "What happened") + '"></label></div>' +
      '<div class="tbl-wrap"><table class="lines"><thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th><th></th></tr></thead><tbody id="' + p + '-lines"></tbody>' +
      '<tfoot><tr><td>Totals</td><td class="num" id="' + p + '-dt"></td><td class="num" id="' + p + '-ct"></td><td></td></tr></tfoot></table></div>' +
      '<div class="f-actions"><button type="button" class="btn" id="' + p + '-add">Add line</button><span class="msg" id="' + p + '-msg" role="status"></span>' +
      '<button type="submit" class="btn primary" id="' + p + '-post" disabled>' + (adj ? "Post adjustment" : "Post transaction") + "</button></div></form>";
    $("#" + p + "-date").value = adj ? monthEndISO() : todayISO();
    resetLines(p);
    var form = $("#" + p + "-f");
    $("#" + p + "-add").addEventListener("click", function () { addLine(p); });
    form.addEventListener("input", function (e) {
      var t = e.target;
      if (t.classList.contains("in-dr") && t.value) $(".in-cr", t.closest("tr")).value = "";
      if (t.classList.contains("in-cr") && t.value) $(".in-dr", t.closest("tr")).value = "";
      recalc(p);
    });
    form.addEventListener("change", function () { recalc(p); });
    form.addEventListener("click", function (e) {
      var b = e.target.closest("td.rm button"); if (!b) return;
      var tr = b.closest("tr");
      if ($$("#" + p + "-lines tr").length > 2) tr.remove(); else { $(".in-acct", tr).value = ""; $(".in-dr", tr).value = ""; $(".in-cr", tr).value = ""; }
      recalc(p);
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); post(p, adj); });
    if (adj) {
      $("#adj-apply").addEventListener("click", function () {
        var i = $("#adj-tpl").value, amt = +$("#adj-amt").value || 0, m = $("#adj-msg");
        if (i === "") { m.textContent = "Choose a template first."; m.className = "msg bad"; return; }
        var t = TPL[+i], am = acctMap();
        $("#adj-desc").value = t.desc;
        $("#adj-lines").innerHTML = "";
        addLine("adj", am[t.dr] ? t.dr : "", amt || "", "");
        addLine("adj", am[t.cr] ? t.cr : "", "", amt || "");
        recalc("adj");
        if (!amt) { m.textContent = "Enter the amount on each side to balance the entry."; m.className = "msg"; }
      });
    }
  }
  function post(p, adj) {
    var m = $("#" + p + "-msg");
    function say(t) { m.textContent = t; m.className = "msg bad"; }
    var date = $("#" + p + "-date").value, desc = $("#" + p + "-desc").value.trim(), ref = $("#" + p + "-ref").value.trim();
    var ls = readLines(p), td = 0, tc = 0;
    ls.forEach(function (l) { td += cents(l.dr); tc += cents(l.cr); });
    if (!date) return say("Choose a date.");
    if (!desc) return say("Add a description.");
    if (ls.length < 2) return say("An entry needs at least two lines.");
    if (td !== tc || td === 0) return say("Debits and credits must match.");
    var n = state.entries.filter(function (e) { return !!e.adj === adj; }).length + 1;
    if (!ref) ref = (adj ? "AJE-" : "J-") + String(n).padStart(3, "0");
    state.entries.push({ id: state.nextId++, date: date, ref: ref, desc: desc, adj: adj, lines: ls });
    save();
    $("#" + p + "-desc").value = ""; $("#" + p + "-ref").value = "";
    if (adj) { $("#adj-tpl").value = ""; $("#adj-amt").value = ""; }
    resetLines(p); renderAll();
    m.textContent = "Posted " + ref + " for " + peso(td) + "."; m.className = "msg ok";
  }

  /* ---------- delete and reset, with an in-page confirmation step ---------- */
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-del],[data-act]"); if (!b) return;
    var label = b.dataset.label || "Delete";
    if (!b.dataset.armed) {
      b.dataset.armed = "1"; b.textContent = "Click again to confirm"; b.classList.add("armed");
      setTimeout(function () { if (b.isConnected) { delete b.dataset.armed; b.textContent = label; b.classList.remove("armed"); } }, 3500);
      return;
    }
    if (b.dataset.act === "reset") { state = sampleState(); }
    else if (b.dataset.act === "clear") { state.entries = []; }
    else {
      var parts = b.dataset.del.split(":");
      if (parts[0] === "entry") {
        state.entries = state.entries.filter(function (x) { return String(x.id) !== parts[1]; });
      } else {
        var n = usage(parts[1]);
        if (n) {
          var m = $("#a-msg"); m.textContent = "Account " + parts[1] + " has " + n + " posted line" + (n > 1 ? "s" : "") + " and cannot be deleted. Remove those entries first."; m.className = "msg bad";
          delete b.dataset.armed; b.textContent = "Delete"; b.classList.remove("armed"); return;
        }
        state.accounts = state.accounts.filter(function (a) { return a.code !== parts[1]; });
        var m2 = $("#a-msg"); m2.textContent = "Deleted account " + parts[1] + "."; m2.className = "msg ok";
      }
    }
    save(); renderAll();
    if (b.dataset.act) { resetLines("tx"); resetLines("adj"); }
  });

  $("#tx-q").addEventListener("input", renderJournals);

  /* ---------- start ---------- */
  buildForm("tx", false);
  buildForm("adj", true);
  renderAll();
  setTab((location.hash || "").slice(1));
})();