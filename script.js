
/* Accounting Management System - Supabase Version
   Requires supabase-config.js to define:
   const supabaseClient = window.supabase.createClient(...)

   Required tables:
   accounts, journal_entries, journal_lines
*/

const SUPABASE_URL = "https://ulxnnzlbrcjqcoapwrtl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_LsI-4D7GIOcIIgxGRuW1sg_9eftkPpO";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

(function () {
  "use strict";

  const TYPES = ["Asset", "Liability", "Equity", "Revenue", "Expense"];

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  const esc = s =>
    String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
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
      : x.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric"
        });
  };

  const todayISO = () => {
    const d = new Date();

    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  let user = null;
  let state = {
    accounts: [],
    entries: []
  };

  // -------------------------------
  // AUTHENTICATION
  // -------------------------------

  function addAuthPanel() {
    if ($("#auth-panel")) return;

    const panel = document.createElement("section");

    panel.id = "auth-panel";
    panel.className = "box";

    panel.innerHTML = `
      <h2>Database Login</h2>
      <p>Sign in to save and load your accounting records.</p>

      <form id="auth-form" autocomplete="on">
        <div class="row">

          <label class="grow">
            Email
            <input
              id="auth-email"
              type="email"
              autocomplete="email"
              required
            >
          </label>

          <label class="grow">
            Password
            <input
              id="auth-password"
              type="password"
              autocomplete="current-password"
              minlength="6"
              required
            >
          </label>

          <button
            class="btn primary"
            type="submit"
            id="auth-signin"
          >
            Sign in
          </button>

          <button
            class="btn"
            type="button"
            id="auth-signup"
          >
            Create account
          </button>

          <button
            class="btn"
            type="button"
            id="auth-signout"
            hidden
          >
            Sign out
          </button>

        </div>

        <p class="msg" id="auth-msg" role="status"></p>
      </form>
    `;

    const page = $(".page");

    page.insertBefore(panel, $(".tabs", page));

    $("#auth-form").addEventListener("submit", async e => {
      e.preventDefault();

      const email = $("#auth-email").value.trim();
      const password = $("#auth-password").value;

      await runAuth(async () => {
        const { error } =
          await supabaseClient.auth.signInWithPassword({
            email,
            password
          });

        if (error) throw error;

        return "Signed in successfully.";
      });
    });

    $("#auth-signup").addEventListener("click", async () => {
      const email = $("#auth-email").value.trim();
      const password = $("#auth-password").value;

      if (!email || password.length < 6) {
        setAuthMessage(
          "Enter an email and a password with at least 6 characters.",
          false
        );
        return;
      }

      await runAuth(async () => {
        const { data, error } =
          await supabaseClient.auth.signUp({
            email,
            password
          });

        if (error) throw error;

        if (data.session) {
          return "Account created and signed in.";
        }

        return "Account created. Check your email to confirm it, then sign in.";
      });
    });

    $("#auth-signout").addEventListener("click", async () => {
      const { error } = await supabaseClient.auth.signOut();

      if (error) {
        setAuthMessage(error.message, false);
      }
    });
  }

  function setAuthMessage(message, ok) {
    const el = $("#auth-msg");

    if (!el) return;

    el.textContent = message;
    el.className = "msg " + (ok ? "ok" : "bad");
  }

  async function runAuth(action) {
    try {
      setAuthMessage(await action(), true);
    } catch (e) {
      setAuthMessage(
        e.message || "Authentication failed.",
        false
      );
    }
  }

  function updateAuthUI() {
    $("#auth-signin").hidden = !!user;
    $("#auth-signup").hidden = !!user;
    $("#auth-signout").hidden = !user;

    $("#auth-email").disabled = !!user;
    $("#auth-password").disabled = !!user;

    if (user) {
      $("#auth-email").value = user.email || "";
      $("#auth-password").value = "";

      setAuthMessage(
        "Signed in as " + (user.email || "your account") + ".",
        true
      );
    } else {
      state = {
        accounts: [],
        entries: []
      };

      renderAll();

      setAuthMessage(
        "Sign in to access your Supabase data.",
        true
      );
    }
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
    Object.fromEntries(
      state.accounts.map(a => [String(a.id), a])
    );

  const acctName = id =>
    acctMap()[String(id)]?.name || "Unknown account";

  const acctLabel = a =>
    (a.code ? a.code + " - " : "") + a.name;

  const hasCodes = () =>
    state.accounts.some(a => a.code);

  const usage = id =>
    state.entries.reduce(
      (n, e) =>
        n + e.lines.filter(
          l => String(l.acct) === String(id)
        ).length,
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
        .in(
          "entry_id",
          entryRows.map(e => e.id)
        );

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
      sort: "",
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
      "Connected to Supabase | Accounts: " +
      state.accounts.length +
      " | Transactions: " +
      state.entries.filter(e => !e.adj).length +
      " | Adjustments: " +
      state.entries.filter(e => e.adj).length
    );
  }

  function setStatus(text) {
    $("#status").textContent = text;
  }

  function showError(where, error) {
    console.error(where, error);

    setStatus(
      where + ": " +
      (error?.message || "Something went wrong.")
    );
  }

  function requireLogin() {
    if (user) return true;

    setStatus(
      "Please sign in using the Database Login panel first."
    );

    return false;
  }

  // -------------------------------
  // TRIAL BALANCE CALCULATION
  // -------------------------------

  function computeTB() {
    const rows = state.accounts
      .slice()
      .sort(accSort)
      .map(a => ({
        a,
        udr: 0,
        ucr: 0,
        adr: 0,
        acr: 0
      }));

    const map = Object.fromEntries(
      rows.map(r => [String(r.a.id), r])
    );

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

    const t = {
      udr: 0,
      ucr: 0,
      adr: 0,
      acr: 0,
      fdr: 0,
      fcr: 0
    };

    rows.forEach(r => {
      const un = r.udr - r.ucr;
      const ad = un + r.adr - r.acr;

      r.u = {
        dr: un > 0 ? un : 0,
        cr: un < 0 ? -un : 0
      };

      r.f = {
        dr: ad > 0 ? ad : 0,
        cr: ad < 0 ? -ad : 0
      };

      t.udr += r.u.dr;
      t.ucr += r.u.cr;
      t.adr += r.adr;
      t.acr += r.acr;
      t.fdr += r.f.dr;
      t.fcr += r.f.cr;
    });

    return { rows, t };
  }

  function renderStatus(tb) {
    const tx = state.entries.filter(e => !e.adj).length;
    const aj = state.entries.length - tx;

    const bal = state.entries.length
      ? (
          tb.t.udr === tb.t.ucr &&
          tb.t.fdr === tb.t.fcr
        )
        ? " | Trial balance: balanced"
        : " | Trial balance: NOT balanced"
      : "";

    if (!user) {
      setStatus(
        "Not signed in. Sign in to load your database."
      );
    } else {
      setStatus(
        "Accounts: " + state.accounts.length +
        " | Transactions: " + tx +
        " | Adjustments: " + aj + bal
      );
    }
  }

  // -------------------------------
  // CHART OF ACCOUNTS DISPLAY
  // -------------------------------

  function renderAccounts() {
    if (!state.accounts.length) {
      $("#coa").innerHTML =
        '<p class="empty">No accounts yet. Add your first account above.</p>';
      return;
    }

    const codes = hasCodes();

    let h =
      "<table><thead><tr>" +
      (codes ? "<th>Code</th>" : "") +
      "<th>Account name</th>" +
      "<th>Type</th>" +
      "<th>Normal balance</th>" +
      '<th class="num">Entries</th>' +
      "<th></th></tr></thead><tbody>";

    state.accounts.slice().sort(accSort).forEach(a => {
      h +=
        "<tr>" +
        (codes ? "<td>" + esc(a.code) + "</td>" : "") +
        "<td>" + esc(a.name) + "</td>" +
        "<td>" + esc(a.type) + "</td>" +
        "<td>" + esc(a.normal) + "</td>" +
        '<td class="num">' + usage(a.id) + "</td>" +
        '<td><button type="button" class="link" data-del="acct:' +
        esc(a.id) +
        '" data-label="Delete">Delete</button></td>' +
        "</tr>";
    });

    $("#coa").innerHTML = h + "</tbody></table>";
  }

  // -------------------------------
  // JOURNAL DISPLAY
  // -------------------------------

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
        (adj
          ? "No adjusting entries yet."
          : "No transactions yet.") +
        "</p>";
    }

    let td = 0;
    let tc = 0;

    let h =
      '<table class="journal"><thead><tr>' +
      "<th>Date</th>" +
      "<th>Transaction</th>" +
      "<th>Ref</th>" +
      '<th class="num">Debit</th>' +
      '<th class="num">Credit</th>' +
      "<th></th></tr></thead><tbody>";

    es.forEach(e => {
      h +=
        '<tr class="entry">' +
        "<td>" + esc(fmtDate(e.date)) + "</td>" +
        "<td></td>" +
        "<td>" + esc(e.ref) + "</td>" +
        "<td></td><td></td><td></td></tr>";

      e.lines.forEach(l => {
        const d = cents(l.dr);
        const c = cents(l.cr);

        td += d;
        tc += c;

        h +=
          '<tr class="line">' +
          "<td></td>" +
          '<td class="' +
          (c > 0 && d === 0 ? "ind2" : "ind1") +
          '">' + esc(acctName(l.acct)) + "</td>" +
          "<td></td>" +
          '<td class="num">' + (d ? num(d) : "") + "</td>" +
          '<td class="num">' + (c ? num(c) : "") + "</td>" +
          "<td></td></tr>";
      });

      h +=
        '<tr class="line last">' +
        "<td></td>" +
        '<td class="ind2"><em>' + esc(e.desc) + "</em></td>" +
        "<td></td><td></td><td></td>" +
        '<td><button type="button" class="link" data-del="entry:' +
        esc(e.id) +
        '" data-label="Delete">Delete</button></td></tr>';
    });

    return h +
      "</tbody><tfoot><tr class=\"total\">" +
      '<td colspan="3">Total</td>' +
      '<td class="num">' + num(td) + "</td>" +
      '<td class="num">' + num(tc) + "</td>" +
      "<td></td></tr></tfoot></table>";
  }

  function renderJournals() {
    $("#tx-list").innerHTML = journalHTML(false);
    $("#adj-list").innerHTML = journalHTML(true);
  }

  // -------------------------------
  // TRIAL BALANCE DISPLAY
  // -------------------------------

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
      '<th colspan="2" class="num">Adjusted</th>' +
      "</tr><tr>" +
      '<th class="num">Debit</th>' +
      '<th class="num">Credit</th>' +
      '<th class="num">Debit</th>' +
      '<th class="num">Credit</th>' +
      '<th class="num">Debit</th>' +
      '<th class="num">Credit</th>' +
      "</tr></thead><tbody>";

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
        '<td class="num">' + fmt(r.f.cr) + "</td>" +
        "</tr>";
    });

    const t = tb.t;

    h +=
      '</tbody><tfoot><tr class="total">' +
      (codes ? "<td></td>" : "") +
      "<td>Total</td>" +
      '<td class="num">' + num(t.udr) + "</td>" +
      '<td class="num">' + num(t.ucr) + "</td>" +
      '<td class="num">' + num(t.adr) + "</td>" +
      '<td class="num">' + num(t.acr) + "</td>" +
      '<td class="num">' + num(t.fdr) + "</td>" +
      '<td class="num">' + num(t.fcr) + "</td>" +
      "</tr></tfoot></table>";

    $("#tb-wrap").innerHTML = h;

    let rev = 0;
    let exp = 0;

    tb.rows.forEach(r => {
      if (r.a.type === "Revenue") {
        rev += r.f.cr - r.f.dr;
      }

      if (r.a.type === "Expense") {
        exp += r.f.dr - r.f.cr;
      }
    });

    $("#tb-summary").textContent =
      "Net income (adjusted): " + num(rev - exp);
  }

  // -------------------------------
  // RENDER ALL SECTIONS
  // -------------------------------

  function renderAll() {
    const tb = computeTB();

    renderStatus(tb);
    renderAccounts();
    renderJournals();
    renderTB(tb);
    refreshOptions();

    ["tx", "adj"].forEach(recalc);

    $$("#acct-form input, #acct-form select, #acct-form button")
      .forEach(el => el.disabled = !user);

    ["tx", "adj"].forEach(p => {
      $$("#" + p + "-f input, #" + p + "-f select, #" + p + "-f button")
        .forEach(el => el.disabled = !user);
    });
  }

  // -------------------------------
  // NAVIGATION TABS
  // -------------------------------

  const TABS = [
    "accounts",
    "transactions",
    "trial-balance",
    "adjustments"
  ];

  function setTab(name) {
    if (!TABS.includes(name)) name = "accounts";

    TABS.forEach(t => {
      $("#p-" + t).hidden = t !== name;

      $("#t-" + t).classList.toggle(
        "active",
        t === name
      );
    });
  }

  $(".tabs").addEventListener("click", e => {
    const b = e.target.closest("[data-tab]");

    if (b) {
      setTab(b.dataset.tab);
      window.scrollTo(0, 0);
    }
  });

  // -------------------------------
  // ADD ACCOUNT
  // -------------------------------

  $("#a-type").innerHTML =
    TYPES.map(t => "<option>" + t + "</option>").join("");

  $("#a-type").addEventListener("change", function () {
    $("#a-normal").value =
      (this.value === "Asset" || this.value === "Expense")
        ? "Debit"
        : "Credit";
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

    if (!name) {
      return say("Enter an account name.", false);
    }

    if (state.accounts.some(a =>
      a.name.toLowerCase() === name.toLowerCase() ||
      (code && a.code === code)
    )) {
      return say(
        "That account name or code already exists.",
        false
      );
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

  // -------------------------------
  // JOURNAL ENTRY FORM HELPERS
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
      '<td><select class="in-acct" aria-label="Account">' +
      acctOptions("") +
      "</select></td>" +

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
      .filter(l =>
        l.acct && (l.dr > 0 || l.cr > 0)
      );
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
      m.textContent =
        "Out of balance by " + num(Math.abs(td - tc)) + ".";

      m.className = "msg bad";
    }

    $("#" + p + "-post").disabled = !user || !ok;
  }

  // -------------------------------
  // BUILD TRANSACTION AND ADJUSTMENT FORMS
  // -------------------------------

  function buildForm(p, adj) {
    $("#" + p + "-form").innerHTML =
      '<form class="box" id="' + p + '-f" autocomplete="off">' +

      '<div class="row">' +

      '<label>Date<input type="date" id="' + p + '-date" required></label>' +

      '<label>Reference (optional)<input type="text" id="' + p + '-ref" maxlength="20"></label>' +

      '<label class="grow">Description<input type="text" id="' + p + '-desc" maxlength="120" required></label>' +

      "</div>" +

      '<div class="table-wrap"><table class="lines">' +

      "<thead><tr>" +
      "<th>Account</th>" +
      '<th class="num">Debit</th>' +
      '<th class="num">Credit</th>' +
      "<th></th>" +
      "</tr></thead>" +

      '<tbody id="' + p + '-lines"></tbody>' +

      "<tfoot><tr class=\"total\">" +
      "<td>Total</td>" +
      '<td class="num" id="' + p + '-dt"></td>' +
      '<td class="num" id="' + p + '-ct"></td>' +
      "<td></td>" +
      "</tr></tfoot>" +

      "</table></div>" +

      '<div class="actions">' +

      '<button type="button" class="btn" id="' + p + '-add">Add line</button>' +

      '<span class="msg" id="' + p + '-msg"></span>' +

      '<button type="submit" class="btn primary" id="' + p + '-post" disabled>' +
      (adj ? "Post adjustment" : "Post transaction") +
      "</button>" +

      "</div></form>";

    $("#" + p + "-date").value = todayISO();

    resetLines(p);

    const form = $("#" + p + "-f");

    $("#" + p + "-add").addEventListener(
      "click",
      () => addLine(p)
    );

    form.addEventListener("input", e => {
      const t = e.target;

      if (t.classList.contains("in-dr") && t.value) {
        $(".in-cr", t.closest("tr")).value = "";
      }

      if (t.classList.contains("in-cr") && t.value) {
        $(".in-dr", t.closest("tr")).value = "";
      }

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

    if (ls.length < 2) {
      return say("An entry needs at least two lines.");
    }

    if (td !== tc || td === 0) {
      return say("Debits and credits must match.");
    }

    const { data: entry, error: entryError } =
      await supabaseClient
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

    if (entryError) return say(entryError.message);

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

      if (rollbackError) {
        console.error("Entry cleanup failed:", rollbackError);
      }

      return say(
        "Could not save journal lines. " +
        "Check your database policies: " +
        lineError.message
      );
    }

    $("#" + p + "-desc").value = "";
    $("#" + p + "-ref").value = "";

    resetLines(p);

    try {
      await loadData();

      $("#" + p + "-msg").textContent =
        "Entry posted successfully.";

      $("#" + p + "-msg").className = "msg ok";
    } catch (err) {
      showError("Entry saved, but refresh failed", err);
    }
  }

  // -------------------------------
  // DELETE AND CLEAR ACTIONS
  // -------------------------------

  document.addEventListener("click", async e => {
    const b = e.target.closest("[data-del],[data-act]");

    if (!b) return;
    if (!requireLogin()) return;

    if (!b.dataset.armed) {
      b.dataset.armed = "1";

      const old = b.textContent;
      b.textContent = "Click again to confirm";
      b.classList.add("armed");

      setTimeout(() => {
        if (b.isConnected) {
          delete b.dataset.armed;
          b.textContent = old;
          b.classList.remove("armed");
        }
      }, 3500);

      return;
    }

    delete b.dataset.armed;
    b.classList.remove("armed");

    if (b.dataset.act === "clear") {
      if (!confirm(
        "Delete all your accounting entries and accounts from Supabase? This cannot be undone."
      )) return;

      const { error: e1 } = await supabaseClient
        .from("journal_entries")
        .delete()
        .eq("user_id", user.id);

      if (e1) {
        return showError("Could not clear entries", e1);
      }

      const { error: e2 } = await supabaseClient
        .from("accounts")
        .delete()
        .eq("user_id", user.id);

      if (e2) {
        return showError("Could not clear accounts", e2);
      }

      await loadData();
      return;
    }

    if (b.dataset.act === "restore") {
      alert(
        "The original sample data has been removed. There are no predefined entries to restore."
      );
      return;
    }

    const [kind, id] = b.dataset.del.split(":");

    if (kind === "entry") {
      const { error } = await supabaseClient
        .from("journal_entries")
        .delete()
        .eq("id", Number(id))
        .eq("user_id", user.id);

      if (error) {
        return showError("Could not delete entry", error);
      }

      await loadData();

    } else if (kind === "acct") {
      if (usage(id)) {
        const m = $("#a-msg");

        m.textContent =
          acctName(id) +
          " is used in journal entries. Delete those entries first.";

        m.className = "msg bad";
        return;
      }

      const { error } = await supabaseClient
        .from("accounts")
        .delete()
        .eq("id", Number(id))
        .eq("user_id", user.id);

      if (error) {
        return showError("Could not delete account", error);
      }

      await loadData();
    }
  });

  // -------------------------------
  // START APPLICATION
  // -------------------------------

  async function start() {
    addAuthPanel();

    buildForm("tx", false);
    buildForm("adj", true);

    const { data, error } =
      await supabaseClient.auth.getSession();

    if (error) {
      showError("Could not check login", error);
      return;
    }

    user = data.session?.user || null;

    updateAuthUI();

    if (user) {
      try {
        await loadData();
      } catch (err) {
        showError("Could not load Supabase data", err);
      }
    }

    supabaseClient.auth.onAuthStateChange(
      (_event, session) => {
        user = session?.user || null;

        updateAuthUI();

        if (user) {
          loadData().catch(err =>
            showError("Could not load Supabase data", err)
          );
        }
      }
    );

    setTab((location.hash || "").slice(1));
  }

  // -------------------------------
  // CHECK SUPABASE CONFIGURATION
  // -------------------------------

  if (
    !window.supabase ||
    typeof supabaseClient === "undefined"
  ) {
    setStatus(
      "Supabase is not configured. Add the Supabase CDN and supabase-config.js before script.js."
    );

    console.error(
      "Missing Supabase client. Check script order and supabase-config.js."
    );

    return;
  }

  start().catch(err =>
    showError("Startup error", err)
  );

})();
