/* GhostTrader Admin Control Center — client */

const adminState = {
  user: null,
  page: "overview",
  usersPage: 1,
  pendingPage: 1,
  bannedPage: 1,
  auditPage: 1,
  confirm: null,
};

function fmtDate(v) {
  if (!v) return "—";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusBadge(status) {
  const s = String(status || "active");
  return `<span class="admin-badge admin-badge-${E(s)}">${E(s)}</span>`;
}

function roleBadge(role) {
  const r = String(role || "user");
  return `<span class="admin-badge admin-badge-role-${E(r)}">${E(r)}</span>`;
}

function showModal({ title, body, extraHtml = "", okText = "Confirm", onOk }) {
  adminState.confirm = onOk;
  $("#adminModalTitle").textContent = title;
  $("#adminModalBody").textContent = body;
  $("#adminModalExtra").innerHTML = extraHtml;
  $("#adminModalOk").textContent = okText;
  $("#adminModal").classList.remove("hide");
}

function hideModal() {
  adminState.confirm = null;
  $("#adminModal").classList.add("hide");
  $("#adminModalExtra").innerHTML = "";
}

$("#adminModalClose").onclick = hideModal;
$("#adminModalCancel").onclick = hideModal;
$("#adminModal").onclick = (e) => {
  if (e.target === $("#adminModal")) hideModal();
};
$("#adminModalOk").onclick = async () => {
  // Capture ban reason before modal tears down the input
  const banInput = $("#banReasonInput");
  if (banInput) adminState._banReason = banInput.value;
  const fn = adminState.confirm;
  hideModal();
  if (fn) {
    try {
      await fn();
    } catch (e) {
      showError(e.message);
    }
  }
};

$("#userDetailClose").onclick = () =>
  $("#userDetailModal").classList.add("hide");
$("#userDetailModal").onclick = (e) => {
  if (e.target === $("#userDetailModal"))
    $("#userDetailModal").classList.add("hide");
};

function adminPage(p) {
  adminState.page = p;
  $$(".admin-main .page").forEach((el) => el.classList.add("hide"));
  const el = $("#admin-" + p);
  if (el) el.classList.remove("hide");
  $$("[data-admin-page]").forEach((b) =>
    b.classList.toggle("active", b.dataset.adminPage === p)
  );
  const titles = {
    overview: "Overview",
    users: "Users",
    pending: "Pending",
    banned: "Banned",
    activity: "Activity",
    system: "System",
  };
  $("#adminTitle").textContent = titles[p] || p;

  if (p === "overview") loadOverview().catch((e) => showError(e.message));
  if (p === "users") loadUsers().catch((e) => showError(e.message));
  if (p === "pending") loadPending().catch((e) => showError(e.message));
  if (p === "banned") loadBanned().catch((e) => showError(e.message));
  if (p === "activity") loadAudit().catch((e) => showError(e.message));
}

$$("[data-admin-page]").forEach((b) => {
  b.onclick = () => adminPage(b.dataset.adminPage);
});

$("#adminLogout").onclick = async () => {
  try {
    await api("/api/auth/logout", { method: "POST" });
  } finally {
    location.href = "/";
  }
};

function applyThemeBtn() {
  const theme =
    document.documentElement.getAttribute("data-theme") || "dark";
  const btn = $("#adminThemeToggle");
  if (!btn) return;
  const dark = theme === "dark";
  btn.innerHTML = dark
    ? "☀ <span>Light mode</span>"
    : "☾ <span>Dark mode</span>";
}

$("#adminThemeToggle").onclick = () => {
  const current =
    document.documentElement.getAttribute("data-theme") || "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try {
    localStorage.setItem("ghosttrader-theme", next);
  } catch (e) {}
  applyThemeBtn();
};
applyThemeBtn();

async function loadOverview() {
  const d = await api("/api/admin/stats");
  const s = d.stats || {};
  $("#adminStats").innerHTML = [
    ["Total users", s.total || 0],
    ["Active", s.active || 0],
    ["Pending", s.pending || 0],
    ["Banned", s.banned || 0],
    ["Admins", s.admins || 0],
    ["New (7d)", s.new_week || 0],
  ]
    .map(
      ([label, val]) =>
        `<div class="stat-card"><small>${E(label)}</small><b>${E(val)}</b></div>`
    )
    .join("");

  const regs = d.recentRegistrations || [];
  $("#recentRegs").innerHTML = regs.length
    ? `<div class="tablewrap"><table><thead><tr>
        <th>Name</th><th>Email</th><th>Status</th><th>Registered</th>
      </tr></thead><tbody>
      ${regs
        .map(
          (u) => `<tr>
        <td><b>${E(u.name)}</b></td>
        <td>${E(u.email)}</td>
        <td>${statusBadge(u.status)}</td>
        <td>${E(fmtDate(u.created_at))}</td>
      </tr>`
        )
        .join("")}
      </tbody></table></div>`
    : '<p class="muted">No registrations yet.</p>';

  const acts = d.recentActions || [];
  $("#recentActions").innerHTML = acts.length
    ? `<div class="tablewrap"><table><thead><tr>
        <th>Action</th><th>Admin</th><th>Target</th><th>When</th>
      </tr></thead><tbody>
      ${acts
        .map(
          (a) => `<tr>
        <td><b>${E(a.action)}</b></td>
        <td>${E(a.admin_name || "—")}</td>
        <td>${E(a.target_name || a.target_email || "—")}</td>
        <td>${E(fmtDate(a.created_at))}</td>
      </tr>`
        )
        .join("")}
      </tbody></table></div>`
    : '<p class="muted">No admin actions yet.</p>';
}

function pagerHtml(page, pages, total, onPrefix) {
  if (pages <= 1) {
    return total
      ? `<div class="admin-pager-inner"><span>${E(total)} result${total === 1 ? "" : "s"}</span></div>`
      : "";
  }
  return `<div class="admin-pager-inner">
    <button type="button" class="secondary" data-pager="${E(onPrefix)}" data-to="${page - 1}" ${page <= 1 ? "disabled" : ""}>‹ Prev</button>
    <span>Page ${E(page)} of ${E(pages)} · ${E(total)} total</span>
    <button type="button" class="secondary" data-pager="${E(onPrefix)}" data-to="${page + 1}" ${page >= pages ? "disabled" : ""}>Next ›</button>
  </div>`;
}

function bindPagers(root) {
  root.querySelectorAll("[data-pager]").forEach((btn) => {
    btn.onclick = () => {
      const which = btn.dataset.pager;
      const to = Number(btn.dataset.to);
      if (which === "users") {
        adminState.usersPage = to;
        loadUsers().catch((e) => showError(e.message));
      }
      if (which === "pending") {
        adminState.pendingPage = to;
        loadPending().catch((e) => showError(e.message));
      }
      if (which === "banned") {
        adminState.bannedPage = to;
        loadBanned().catch((e) => showError(e.message));
      }
      if (which === "audit") {
        adminState.auditPage = to;
        loadAudit().catch((e) => showError(e.message));
      }
    };
  });
}

function actionButtons(u) {
  const id = Number(u.id);
  const status = u.status;
  const role = u.role;
  const isSelf = adminState.user && Number(adminState.user.id) === id;
  const parts = [];

  parts.push(
    `<button type="button" class="secondary" data-act="view" data-id="${id}">View</button>`
  );

  if (status === "pending") {
    parts.push(
      `<button type="button" class="primary" data-act="approve" data-id="${id}">Approve</button>`
    );
  }
  if (status === "active") {
    parts.push(
      `<button type="button" class="secondary" data-act="ban" data-id="${id}">Ban</button>`
    );
  }
  if (status === "banned") {
    parts.push(
      `<button type="button" class="secondary" data-act="unban" data-id="${id}">Unban</button>`
    );
  }
  if (!isSelf && status !== "banned") {
    if (role === "user") {
      parts.push(
        `<button type="button" class="secondary" data-act="make-admin" data-id="${id}">Make admin</button>`
      );
    } else {
      parts.push(
        `<button type="button" class="secondary" data-act="remove-admin" data-id="${id}">Remove admin</button>`
      );
    }
  }
  if (!isSelf) {
    parts.push(
      `<button type="button" class="secondary danger" data-act="delete" data-id="${id}">Delete</button>`
    );
  }

  return parts.join(" ");
}

function usersTable(rows) {
  if (!rows.length) {
    return '<p class="muted">No users match these filters.</p>';
  }
  return `<div class="tablewrap"><table>
    <thead><tr>
      <th>ID</th><th>Name</th><th>Email</th><th>Status</th><th>Role</th>
      <th>Accounts</th><th>Trades</th><th>Registered</th><th>Last login</th><th>Actions</th>
    </tr></thead>
    <tbody>
    ${rows
      .map(
        (u) => `<tr>
      <td>${E(u.id)}</td>
      <td><b>${E(u.name)}</b></td>
      <td>${E(u.email)}</td>
      <td>${statusBadge(u.status)}</td>
      <td>${roleBadge(u.role)}</td>
      <td>${E(u.account_count)}</td>
      <td>${E(u.trade_count)}</td>
      <td>${E(fmtDate(u.created_at))}</td>
      <td>${E(fmtDate(u.last_login_at))}</td>
      <td class="admin-actions">${actionButtons(u)}</td>
    </tr>`
      )
      .join("")}
    </tbody>
  </table></div>`;
}

function bindRowActions(root) {
  root.querySelectorAll("[data-act]").forEach((btn) => {
    btn.onclick = () => handleAction(btn.dataset.act, Number(btn.dataset.id));
  });
}

async function loadUsers() {
  const q = $("#userQ").value.trim();
  const status = $("#userStatus").value;
  const role = $("#userRole").value;
  const sort = $("#userSort").value || "created_at";
  const params = new URLSearchParams({
    page: String(adminState.usersPage),
    limit: "25",
    sort,
    dir: "desc",
  });
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  if (role) params.set("role", role);

  const d = await api("/api/admin/users?" + params);
  $("#userTable").innerHTML = usersTable(d.users || []);
  $("#userPager").innerHTML = pagerHtml(
    d.page,
    d.pages,
    d.total,
    "users"
  );
  bindRowActions($("#userTable"));
  bindPagers($("#userPager"));
}

async function loadPending() {
  const params = new URLSearchParams({
    page: String(adminState.pendingPage),
    limit: "25",
    status: "pending",
    sort: "created_at",
    dir: "desc",
  });
  const d = await api("/api/admin/users?" + params);
  $("#pendingTable").innerHTML = usersTable(d.users || []);
  $("#pendingPager").innerHTML = pagerHtml(
    d.page,
    d.pages,
    d.total,
    "pending"
  );
  bindRowActions($("#pendingTable"));
  bindPagers($("#pendingPager"));
}

async function loadBanned() {
  const params = new URLSearchParams({
    page: String(adminState.bannedPage),
    limit: "25",
    status: "banned",
    sort: "created_at",
    dir: "desc",
  });
  const d = await api("/api/admin/users?" + params);
  $("#bannedTable").innerHTML = usersTable(d.users || []);
  $("#bannedPager").innerHTML = pagerHtml(
    d.page,
    d.pages,
    d.total,
    "banned"
  );
  bindRowActions($("#bannedTable"));
  bindPagers($("#bannedPager"));
}

async function loadAudit() {
  const action = $("#auditAction").value;
  const params = new URLSearchParams({
    page: String(adminState.auditPage),
    limit: "25",
  });
  if (action) params.set("action", action);
  const d = await api("/api/admin/audit-log?" + params);
  const rows = d.events || [];
  $("#auditTable").innerHTML = rows.length
    ? `<div class="tablewrap"><table>
      <thead><tr>
        <th>When</th><th>Action</th><th>Admin</th><th>Target</th><th>Reason</th>
      </tr></thead>
      <tbody>
      ${rows
        .map(
          (a) => `<tr>
        <td>${E(fmtDate(a.created_at))}</td>
        <td><b>${E(a.action)}</b></td>
        <td>${E(a.admin_name || a.admin_email || "—")}</td>
        <td>${E(a.target_name || a.target_email || a.target_user_id || "—")}</td>
        <td>${E(a.reason || "—")}</td>
      </tr>`
        )
        .join("")}
      </tbody></table></div>`
    : '<p class="muted">No audit events.</p>';
  $("#auditPager").innerHTML = pagerHtml(
    d.page,
    d.pages,
    d.total,
    "audit"
  );
  bindPagers($("#auditPager"));
}

$("#userSearch").onclick = () => {
  adminState.usersPage = 1;
  loadUsers().catch((e) => showError(e.message));
};
$("#userQ").onkeydown = (e) => {
  if (e.key === "Enter") $("#userSearch").click();
};
$("#auditSearch").onclick = () => {
  adminState.auditPage = 1;
  loadAudit().catch((e) => showError(e.message));
};

async function viewUser(id) {
  const d = await api("/api/admin/users/" + id);
  const u = d.user;
  $("#userDetailTitle").textContent = u.name || "User";
  const accounts = d.accounts || [];
  const audit = d.recentAudit || [];
  $("#userDetailBody").innerHTML = `
    <div class="metric-list">
      <p><span>ID</span><b>${E(u.id)}</b></p>
      <p><span>Email</span><b>${E(u.email)}</b></p>
      <p><span>Status</span><b>${statusBadge(u.status)}</b></p>
      <p><span>Role</span><b>${roleBadge(u.role)}</b></p>
      <p><span>Registered</span><b>${E(fmtDate(u.created_at))}</b></p>
      <p><span>Last login</span><b>${E(fmtDate(u.last_login_at))}</b></p>
      <p><span>Last activity</span><b>${E(fmtDate(u.last_activity_at))}</b></p>
      <p><span>Approved</span><b>${E(fmtDate(u.approved_at))}</b></p>
      <p><span>Banned</span><b>${E(fmtDate(u.banned_at))}</b></p>
      <p><span>Ban reason</span><b>${E(u.ban_reason || "—")}</b></p>
      <p><span>Trading accounts</span><b>${E(u.account_count)}</b></p>
      <p><span>Trades</span><b>${E(u.trade_count)}</b></p>
    </div>
    <h3 style="margin:18px 0 8px;font-size:14px">Accounts</h3>
    ${
      accounts.length
        ? `<div class="tablewrap"><table><thead><tr><th>Name</th><th>Currency</th><th>Starting</th><th>Active</th></tr></thead>
        <tbody>${accounts
          .map(
            (a) => `<tr>
          <td>${E(a.name)}</td>
          <td>${E(a.currency)}</td>
          <td>${E(M(a.starting_balance))}</td>
          <td>${a.active === false ? "Archived" : "Yes"}</td>
        </tr>`
          )
          .join("")}</tbody></table></div>`
        : '<p class="muted">No accounts.</p>'
    }
    <h3 style="margin:18px 0 8px;font-size:14px">Recent audit on this user</h3>
    ${
      audit.length
        ? `<div class="tablewrap"><table><thead><tr><th>When</th><th>Action</th><th>Reason</th></tr></thead>
        <tbody>${audit
          .map(
            (a) => `<tr>
          <td>${E(fmtDate(a.created_at))}</td>
          <td>${E(a.action)}</td>
          <td>${E(a.reason || "—")}</td>
        </tr>`
          )
          .join("")}</tbody></table></div>`
        : '<p class="muted">No audit events for this user.</p>'
    }
  `;
  $("#userDetailModal").classList.remove("hide");
}

async function handleAction(act, id) {
  if (act === "view") {
    try {
      await viewUser(id);
    } catch (e) {
      showError(e.message);
    }
    return;
  }

  if (act === "approve") {
    showModal({
      title: "Approve account",
      body: "Approve this pending user? They will gain full journal access.",
      okText: "Approve",
      onOk: async () => {
        await api("/api/admin/users/" + id + "/approve", { method: "POST" });
        await refreshCurrent();
      },
    });
    return;
  }

  if (act === "ban") {
    showModal({
      title: "Ban user",
      body: "Ban this user? They will lose access immediately. Existing sessions will be invalidated.",
      extraHtml:
        '<label style="display:grid;gap:6px;font-size:12px;font-weight:700;color:var(--muted)">Reason (optional)<input id="banReasonInput" style="padding:10px;border-radius:7px;border:1px solid var(--line);background:var(--panel2);color:var(--text)"></label>',
      okText: "Ban user",
      onOk: async () => {
        const reason = adminState._banReason || null;
        adminState._banReason = null;
        await api("/api/admin/users/" + id + "/ban", {
          method: "POST",
          body: JSON.stringify({ reason }),
        });
        await refreshCurrent();
      },
    });
    return;
  }

  if (act === "unban") {
    showModal({
      title: "Unban user",
      body: "Restore this account to active status?",
      okText: "Unban",
      onOk: async () => {
        await api("/api/admin/users/" + id + "/unban", { method: "POST" });
        await refreshCurrent();
      },
    });
    return;
  }

  if (act === "make-admin") {
    showModal({
      title: "Grant administrator",
      body: "Make this user an administrator? They will have full access to the Admin Control Center.",
      okText: "Make admin",
      onOk: async () => {
        await api("/api/admin/users/" + id + "/role", {
          method: "POST",
          body: JSON.stringify({ role: "admin" }),
        });
        await refreshCurrent();
      },
    });
    return;
  }

  if (act === "remove-admin") {
    showModal({
      title: "Remove administrator",
      body: "Remove administrator privileges from this user? The last active admin cannot be removed.",
      okText: "Remove admin",
      onOk: async () => {
        await api("/api/admin/users/" + id + "/role", {
          method: "POST",
          body: JSON.stringify({ role: "user" }),
        });
        await refreshCurrent();
      },
    });
    return;
  }

  if (act === "delete") {
    showModal({
      title: "Delete account permanently?",
      body: "This permanently deletes the user and their associated journal data (accounts, trades, playbooks, etc.). Audit history is preserved. This cannot be undone.",
      okText: "Delete permanently",
      onOk: async () => {
        await api("/api/admin/users/" + id + "?confirm=true", {
          method: "DELETE",
          body: JSON.stringify({ confirm: true }),
        });
        await refreshCurrent();
      },
    });
  }
}

async function refreshCurrent() {
  const p = adminState.page;
  if (p === "overview") await loadOverview();
  if (p === "users") await loadUsers();
  if (p === "pending") await loadPending();
  if (p === "banned") await loadBanned();
  if (p === "activity") await loadAudit();
}

/* Boot */
(async () => {
  try {
    const d = await api("/api/auth/me");
    adminState.user = d.user;

    if (d.user.role !== "admin" || d.user.status !== "active") {
      $("#gateMsg").textContent =
        "Administrator access required. Return to the journal.";
      return;
    }

    $("#adminGate").classList.add("hide");
    $("#adminApp").classList.remove("hide");
    $("#adminName").textContent = d.user.name || "Admin";
    $("#adminEmail").textContent = d.user.email || "";
    $("#adminAvatar").textContent = (d.user.name || "A").charAt(0).toUpperCase();

    await adminPage("overview");
  } catch (e) {
    $("#gateMsg").textContent =
      e.message || "Sign in as an administrator to continue.";
  }
})();
