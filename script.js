(function () {
  var KEY = "accounting-system-v1";
  var TYPES = ["Asset", "Liability", "Equity", "Revenue", "Expense"];

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  var cents = function (v) { return Math.round((+v || 0) * 100); };
  var fmt = function (c) {
    return c ? (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";
  };
  var num = function (c) {
    return (c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  var fmtDate = function (d) {
    var x = new Date(d + "T00:00:00");
    return isNaN(x) ? d : x.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };
  var byCode = function (a, b) { return a.code < b.code ? -1 : a.code > b.code ? 1 : 0; };
  var todayISO = function () {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  };

  /* ---------- data (starts empty) ---------- */
  function emptyState() { return { accounts: [], entries: [], nextId: 1 }; }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && Array.isArray(s.accounts) && Array.isArray(s.entries)) return s;
    } catch (e) {}
    return null;
  }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} }
  var state = load() || emptyState();

  var acctMap = function () { var m = {}; state.accounts.forEach(function (a) { m[a.code] = a; }); return m; };
  var acctName = function (code) { var a = acctMap()[code]; return a ? a.name : code; };
  var usage = function (code) {
    return state.entries.reduce(function (n, e) {
      return n + e.lines.filter(function (l) { return l.code === code; }).length;
    }, 0);
  };

  /* ---------- trial balance ---------- */
  function computeTB() {
    var rows = state.accounts.slice().sort(byCode).map(function (a) {
      return { a: a, udr: 0, ucr: 0, adr: 0, acr: 0 };
    });
    var map = {};
    rows.forEach(function (r) { map[r.a.code] = r; });
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
  function renderStatus(tb) {
    var tx = state.entries.filter(function (e) { return !e.adj; }).length;
    var aj = state.entries.length - tx;
    var bal = "";
    if (state.entries.length) {
      bal = (tb.t.udr === tb.t.ucr && tb.t.fdr === tb.t.fcr) ? " | Trial balance: balanced" : " | Trial balance: NOT balanced";
    }
    $("#status").textContent = "Accounts: " + state.accounts.length + " | Transactions: " + tx + " | Adjustments: " + aj + bal;
  }

  function renderAccounts() {
    if (!state.accounts.length) {
      $("#coa").innerHTML = '<p class="empty">No accounts yet. Add your first account above.</p>';
      return;
    }
    var h = '<table><thead><tr><th>Code</th><th>Account name</th><th>Type</th><th>Normal balance</th><th class="num">Entries</th><th></th></tr></thead><tbody>';
    state.accounts.slice().sort(byCode).forEach(function (a) {
      var n = usage(a.code);
      h += "<tr><td>" + esc(a.code) + "</td><td>" + esc(a.name) + "</td><td>" + a.type + "</td><td>" + a.normal +
        '</td><td class="num">' + n + '</td><td><button type="button" class="link" data-del="acct:' + esc(a.code) + '">Delete</button></td></tr>';
    });
    $("#coa").innerHTML = h + "</tbody></table>";
  }

  function journalHTML(adj) {
    var es = state.entries.filter(function (e) { return !!e.adj === adj; });
    if (!es.length) {
      return '<p class="empty">' + (adj ? "No adjusting entries yet." : "No transactions yet.") + "</p>";
    }
    es.sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id; });
    var td = 0, tc = 0;
    var h = '<table class="journal"><thead><tr><th>Date</th><th>Transaction</th><th>Ref</th><th class="num">Debit</th><th class="num">Credit</th><th></th></tr></thead><tbody>';
    es.forEach(function (e) {
      h += '<tr class="entry"><td>' + fmtDate(e.date) + "</td><td></td><td>" + esc(e.ref || "") + "</td><td></td><td></td><td></td></tr>";
      e.lines.forEach(function (l) {
        var d = cents(l.dr), c = cents(l.cr); td += d; tc += c;
        h += '<tr class="line"><td></td><td class="' + (c > 0 && d === 0 ? "ind2" : "ind1") + '">' + esc(acctName(l.code)) +
          '</td><td></td><td class="num">' + (d ? num(d) : "") + '</td><td class="num">' + (c ? num(c) : "") + "</td><td></td></tr>";
      });
      h += '<tr class="line last"><td></td><td class="ind2"><em>' + esc(e.desc) + '</em></td><td></td><td></td><td></td>' +
        '<td><button type="button" class="link" data-del="entry:' + e.id + '">Delete</button></td></tr>';
    });
    return h + '</tbody><tfoot><tr class="total"><td colspan="3">Total</td><td class="num">' + num(td) + '</td><td class="num">' + num(tc) + "</td><td></td></tr></tfoot></table>";
  }
  function renderJournals() {
    $("#tx-list").innerHTML = journalHTML(false);
    $("#adj-list").innerHTML = journalHTML(true);
  }

  function renderTB(tb) {
    if (!tb.rows.length) {
      $("#tb-wrap").innerHTML = '<p class="empty">No accounts yet. Add accounts and post entries to see the trial balance.</p>';
      $("#tb-summary").textContent = "";
      return;
    }
    var h = '<table class="tb"><thead><tr><th rowspan="2">Code</th><th rowspan="2">Account</th>' +
      '<th colspan="2" class="num">Unadjusted</th><th colspan="2" class="num">Adjustments</th><th colspan="2" class="num">Adjusted</th></tr><tr>' +
      '<th class="num">Debit</th><th class="num">Credit</th><th class="num">Debit</th><th class="num">Credit</th><th class="num">Debit</th><th class="num">Credit</th></tr></thead><tbody>';
    tb.rows.forEach(function (r) {
      h += "<tr><td>" + esc(r.a.code) + "</td><td>" + esc(r.a.name) + '</td><td class="num">' + fmt(r.u.dr) + '</td><td class="num">' + fmt(r.u.cr) +
        '</td><td class="num">' + fmt(r.adr) + '</td><td class="num">' + fmt(r.acr) + '</td><td class="num">' + fmt(r.f.dr) + '</td><td class="num">' + fmt(r.f.cr) + "</td></tr>";
    });
    var t = tb.t;
    h += '</tbody><tfoot><tr class="total"><td></td><td>Total</td><td class="num">' + num(t.udr) + '</td><td class="num">' + num(t.ucr) + '</td><td class="num">' + num(t.adr) +
      '</td><td class="num">' + num(t.acr) + '</td><td class="num">' + num(t.fdr) + '</td><td class="num">' + num(t.fcr) + "</td></tr></tfoot></table>";
    $("#tb-wrap").innerHTML = h;
    var rev = 0, exp = 0;
    tb.rows.forEach(function (r) {
      if (r.a.type === "Revenue") rev += r.f.cr - r.f.dr;
      if (r.a.type === "Expense") exp += r.f.dr - r.f.cr;
    });
    $("#tb-summary").textContent = "Net income (adjusted): " + num(rev - exp);
  }

  function renderAll() {
    var tb = computeTB();
    renderStatus(tb); renderAccounts(); renderJournals(); renderTB(tb); refreshOptions();
    ["tx", "adj"].forEach(recalc);
  }

  /* ---------- tabs ---------- */
  var TABS = ["accounts", "transactions", "trial-balance", "adjustments"];
  function setTab(name) {
    if (TABS.indexOf(name) < 0) name = "accounts";
    TABS.forEach(function (t) {
      $("#p-" + t).hidden = t !== name;
      $("#t-" + t).classList.toggle("active", t === name);
    });
  }
  $(".tabs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-tab]");
    if (b) { setTab(b.dataset.tab); window.scrollTo(0, 0); }
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
    if (acctMap()[code]) return say("Code " + code + " is already used by " + acctMap()[code].name + ".");
    state.accounts.push({ code: code, name: name, type: $("#a-type").value, normal: $("#a-normal").value });
    save(); renderAll();
    $("#a-code").value = ""; $("#a-name").value = "";
    say("Added " + code + " " + name + ".", true);
  });

  /* ---------- journal entry forms ---------- */
  function acctOptions(sel) {
    return '<option value="">Select account</option>' + state.accounts.slice().sort(byCode).map(function (a) {
      return '<option value="' + esc(a.code) + '"' + (a.code === sel ? " selected" : "") + ">" + esc(a.code) + " - " + esc(a.name) + "</option>";
    }).join("");
  }
  function refreshOptions() {
    $$("select.in-acct").forEach(function (s) { var v = s.value; s.innerHTML = acctOptions(v); s.value = v; });
  }
  function addLine(p) {
    var tr = document.createElement("tr");
    tr.innerHTML = '<td><select class="in-acct" aria-label="Account">' + acctOptions("") + "</select></td>" +
      '<td><input class="in-dr num" type="number" min="0" step="0.01" aria-label="Debit amount"></td>' +
      '<td><input class="in-cr num" type="number" min="0" step="0.01" aria-label="Credit amount"></td>' +
      '<td><button type="button" class="link rm">Remove</button></td>';
    $("#" + p + "-lines").appendChild(tr);
  }
  function resetLines(p) { $("#" + p + "-lines").innerHTML = ""; addLine(p); addLine(p); recalc(p); }
  function readLines(p) {
    return $$("#" + p + "-lines tr").map(function (r) {
      return { code: $(".in-acct", r).value, dr: +$(".in-dr", r).value || 0, cr: +$(".in-cr", r).value || 0 };
    }).filter(function (l) { return l.code && (l.dr > 0 || l.cr > 0); });
  }
  function recalc(p) {
    if (!$("#" + p + "-lines")) return;
    var ls = readLines(p), td = 0, tc = 0;
    ls.forEach(function (l) { td += cents(l.dr); tc += cents(l.cr); });
    $("#" + p + "-dt").textContent = num(td); $("#" + p + "-ct").textContent = num(tc);
    var m = $("#" + p + "-msg"), ok = td > 0 && td === tc && ls.length >= 2;
    if (!state.accounts.length) { m.textContent = "Add accounts in the Chart of Accounts first."; m.className = "msg"; }
    else if (!ls.length) { m.textContent = "Choose accounts and enter amounts."; m.className = "msg"; }
    else if (ok) { m.textContent = "Debits equal credits. Ready to post."; m.className = "msg ok"; }
    else if (td === tc) { m.textContent = "Add at least two lines."; m.className = "msg"; }
    else { m.textContent = "Out of balance by " + num(Math.abs(td - tc)) + "."; m.className = "msg bad"; }
    $("#" + p + "-post").disabled = !ok;
  }
  function buildForm(p, adj) {
    $("#" + p + "-form").innerHTML =
      '<form class="box" id="' + p + '-f" autocomplete="off">' +
      '<div class="row"><label>Date<input type="date" id="' + p + '-date" required></label>' +
      '<label>Reference (optional)<input type="text" id="' + p + '-ref" maxlength="20"></label>' +
      '<label class="grow">Description<input type="text" id="' + p + '-desc" maxlength="120" required></label></div>' +
      '<div class="table-wrap"><table class="lines"><thead><tr><th>Account</th><th class="num">Debit</th><th class="num">Credit</th><th></th></tr></thead>' +
      '<tbody id="' + p + '-lines"></tbody>' +
      '<tfoot><tr class="total"><td>Total</td><td class="num" id="' + p + '-dt"></td><td class="num" id="' + p + '-ct"></td><td></td></tr></tfoot></table></div>' +
      '<div class="actions"><button type="button" class="btn" id="' + p + '-add">Add line</button><span class="msg" id="' + p + '-msg"></span>' +
      '<button type="submit" class="btn primary" id="' + p + '-post" disabled>' + (adj ? "Post adjustment" : "Post transaction") + "</button></div></form>";
    $("#" + p + "-date").value = todayISO();
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
      var b = e.target.closest(".rm"); if (!b) return;
      var tr = b.closest("tr");
      if ($$("#" + p + "-lines tr").length > 2) tr.remove();
      else { $(".in-acct", tr).value = ""; $(".in-dr", tr).value = ""; $(".in-cr", tr).value = ""; }
      recalc(p);
    });
    form.addEventListener("submit", function (e) { e.preventDefault(); post(p, adj); });
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
    state.entries.push({ id: state.nextId++, date: date, ref: ref, desc: desc, adj: adj, lines: ls });
    save();
    $("#" + p + "-desc").value = ""; $("#" + p + "-ref").value = "";
    resetLines(p); renderAll();
    $("#" + p + "-msg").textContent = "Entry posted."; $("#" + p + "-msg").className = "msg ok";
  }

  /* ---------- delete / clear, with an in-page confirmation ---------- */
  document.addEventListener("click", function (e) {
    var b = e.target.closest("[data-del],[data-act]"); if (!b) return;
    var label = b.dataset.label || "Delete";
    if (!b.dataset.armed) {
      b.dataset.armed = "1"; b.textContent = "Click again to confirm"; b.classList.add("armed");
      setTimeout(function () {
        if (b.isConnected) { delete b.dataset.armed; b.textContent = label; b.classList.remove("armed"); }
      }, 3500);
      return;
    }
    if (b.dataset.act === "clear") {
      state = emptyState();
    } else {
      var parts = b.dataset.del.split(":");
      if (parts[0] === "entry") {
        state.entries = state.entries.filter(function (x) { return String(x.id) !== parts[1]; });
      } else {
        var n = usage(parts[1]), m = $("#a-msg");
        if (n) {
          m.textContent = "Account " + parts[1] + " is used in " + n + " entry line" + (n > 1 ? "s" : "") + " and cannot be deleted. Delete those entries first.";
          m.className = "msg bad";
          delete b.dataset.armed; b.textContent = "Delete"; b.classList.remove("armed");
          return;
        }
        state.accounts = state.accounts.filter(function (a) { return a.code !== parts[1]; });
        m.textContent = "Deleted account " + parts[1] + "."; m.className = "msg ok";
      }
    }
    save(); renderAll();
    if (b.dataset.act) { resetLines("tx"); resetLines("adj"); }
  });

  /* ---------- start ---------- */
  buildForm("tx", false);
  buildForm("adj", true);
  renderAll();
  setTab((location.hash || "").slice(1));
})();