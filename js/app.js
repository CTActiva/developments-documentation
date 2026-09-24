import { supabase, requireSession } from "./supabase-client.js";

const state = {
  entries: [],
  filter: { cliente: null, tipo: null },
  openClientes: new Set(),
  drawerMode: null, // 'view' | 'create' | 'edit'
  activeEntry: null,
};

const el = {
  tree: document.getElementById("tree"),
  rootFilter: document.getElementById("root-filter"),
  breadcrumb: document.getElementById("breadcrumb"),
  entryList: document.getElementById("entry-list"),
  sessionEmail: document.getElementById("session-email"),
  logoutBtn: document.getElementById("logout-btn"),
  newEntryBtn: document.getElementById("new-entry-btn"),
  drawer: document.getElementById("drawer"),
  drawerBackdrop: document.getElementById("drawer-backdrop"),
  drawerEyebrow: document.getElementById("drawer-eyebrow"),
  drawerTitle: document.getElementById("drawer-title"),
  drawerBody: document.getElementById("drawer-body"),
  drawerFooter: document.getElementById("drawer-footer"),
  drawerClose: document.getElementById("drawer-close"),
};

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value.length === 10 ? value + "T00:00:00" : value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("es-ES");
}

function distinctValues(field) {
  const set = new Set();
  state.entries.forEach((e) => { if (e[field]) set.add(e[field]); });
  return [...set].sort((a, b) => a.localeCompare(b));
}

// ---------- Datos ----------

async function fetchEntries() {
  const { data, error } = await supabase
    .from("entradas")
    .select("*")
    .order("fecha", { ascending: false, nullsFirst: false });
  if (error) {
    el.entryList.innerHTML = `<div class="empty-state"><h2>No se pudieron cargar las entradas</h2><p>${escapeHtml(error.message)}</p></div>`;
    return;
  }
  state.entries = data;
}

function buildTree() {
  const tree = new Map(); // cliente -> Map(tipo -> count)
  state.entries.forEach((e) => {
    if (!tree.has(e.cliente)) tree.set(e.cliente, new Map());
    const tipos = tree.get(e.cliente);
    tipos.set(e.tipo_desarrollo, (tipos.get(e.tipo_desarrollo) || 0) + 1);
  });
  return tree;
}

// ---------- Render: árbol ----------

function renderTree() {
  const tree = buildTree();
  el.rootFilter.classList.toggle("active-root", !state.filter.cliente);
  el.tree.innerHTML = "";

  [...tree.keys()].sort((a, b) => a.localeCompare(b)).forEach((cliente) => {
    const tipos = tree.get(cliente);
    const isOpen = state.openClientes.has(cliente);
    const isActiveClient = state.filter.cliente === cliente;
    const total = [...tipos.values()].reduce((a, b) => a + b, 0);

    const node = document.createElement("div");
    node.className = `tree-node tree-cliente${isOpen ? " open" : ""}${isActiveClient && !state.filter.tipo ? " active" : ""}`;
    node.innerHTML = `
      <div class="tree-label" data-cliente="${escapeHtml(cliente)}">
        <span class="tree-caret" data-role="caret">▸</span>
        <span style="flex:1">${escapeHtml(cliente)}</span>
        <span class="tree-count">${total}</span>
      </div>
      <div class="tree-tipos">
        ${[...tipos.keys()].sort((a, b) => a.localeCompare(b)).map((tipo) => `
          <div class="tree-tipo${isActiveClient && state.filter.tipo === tipo ? " active" : ""}"
               data-cliente="${escapeHtml(cliente)}" data-tipo="${escapeHtml(tipo)}">
            <span>${escapeHtml(tipo)}</span>
            <span class="tree-count">${tipos.get(tipo)}</span>
          </div>
        `).join("")}
      </div>
    `;
    el.tree.appendChild(node);
  });
}

el.tree.addEventListener("click", (event) => {
  const tipoRow = event.target.closest(".tree-tipo");
  if (tipoRow) {
    state.filter = { cliente: tipoRow.dataset.cliente, tipo: tipoRow.dataset.tipo };
    state.openClientes.add(tipoRow.dataset.cliente);
    renderAll();
    return;
  }
  const label = event.target.closest(".tree-label");
  if (label) {
    const cliente = label.dataset.cliente;
    const caretHit = event.target.closest('[data-role="caret"]');
    if (caretHit) {
      // Solo abre/cierra la carpeta, sin tocar el filtro activo.
      state.openClientes.has(cliente) ? state.openClientes.delete(cliente) : state.openClientes.add(cliente);
    } else {
      // Clic en el nombre: filtra por este cliente y lo despliega.
      state.filter = { cliente, tipo: null };
      state.openClientes.add(cliente);
    }
    renderAll();
  }
});

el.rootFilter.addEventListener("click", () => {
  state.filter = { cliente: null, tipo: null };
  renderAll();
});

// ---------- Render: listado ----------

function filteredEntries() {
  return state.entries.filter((e) => {
    if (state.filter.cliente && e.cliente !== state.filter.cliente) return false;
    if (state.filter.tipo && e.tipo_desarrollo !== state.filter.tipo) return false;
    return true;
  });
}

function renderBreadcrumb() {
  if (!state.filter.cliente) { el.breadcrumb.textContent = "Todos los clientes"; return; }
  el.breadcrumb.innerHTML = state.filter.tipo
    ? `${escapeHtml(state.filter.cliente)} <span style="color:var(--ink-muted)">/</span> <strong>${escapeHtml(state.filter.tipo)}</strong>`
    : `<strong>${escapeHtml(state.filter.cliente)}</strong>`;
}

function renderList() {
  const rows = filteredEntries();
  if (rows.length === 0) {
    el.entryList.innerHTML = `
      <div class="empty-state">
        <h2>No hay entradas aquí todavía</h2>
        <p>Crea la primera con "Nueva entrada" arriba a la derecha.</p>
      </div>`;
    return;
  }

  el.entryList.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Código</th><th>Cliente</th><th>Tipo</th><th>Lenguaje</th><th>Encargado</th><th>Fecha</th><th>Etiquetas</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((e) => `
          <tr data-id="${e.id}">
            <td class="mono">${escapeHtml(e.codigo_desarrollo || "—")}</td>
            <td>${escapeHtml(e.cliente)}</td>
            <td>${escapeHtml(e.tipo_desarrollo)}</td>
            <td>${escapeHtml(e.lenguaje || "—")}</td>
            <td>${escapeHtml(e.encargado || "—")}</td>
            <td>${formatDate(e.fecha)}</td>
            <td>${(e.tags || []).map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join("")}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

el.entryList.addEventListener("click", (event) => {
  const row = event.target.closest("tr[data-id]");
  if (!row) return;
  const entry = state.entries.find((e) => String(e.id) === row.dataset.id);
  if (entry) openDrawerView(entry);
});

function renderAll() {
  renderTree();
  renderBreadcrumb();
  renderList();
}

// ---------- Drawer: ver detalle ----------

function openDrawerView(entry) {
  state.drawerMode = "view";
  state.activeEntry = entry;
  el.drawerEyebrow.textContent = `${entry.cliente} · ${entry.tipo_desarrollo}`;
  el.drawerTitle.textContent = entry.codigo_desarrollo || "(sin código)";

  el.drawerBody.innerHTML = `
    <div class="section-label">Descripción</div>
    <div>${escapeHtml(entry.descripcion) || "<span style=\"color:var(--ink-muted)\">Sin descripción.</span>"}</div>

    <div class="section-label">Código del desarrollo</div>
    <div class="code-block mono">${escapeHtml(entry.codigo_desarrollo) || "—"}</div>

    <div class="section-label">Detalles</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
      <div><div style="color:var(--ink-muted)">Lenguaje</div>${escapeHtml(entry.lenguaje) || "—"}</div>
      <div><div style="color:var(--ink-muted)">Encargado</div>${escapeHtml(entry.encargado) || "—"}</div>
      <div><div style="color:var(--ink-muted)">Fecha</div>${formatDate(entry.fecha)}</div>
      <div><div style="color:var(--ink-muted)">Etiquetas</div>${(entry.tags || []).map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join("") || "—"}</div>
    </div>

    <div class="meta-row">
      <span>Creado por ${escapeHtml(entry.created_by_email) || "—"} · ${formatDate(entry.created_at)}</span>
    </div>
    ${entry.updated_by_email && entry.updated_at !== entry.created_at ? `
    <div class="meta-row" style="border-top:none;padding-top:4px;margin-top:4px">
      <span>Última edición por ${escapeHtml(entry.updated_by_email)} · ${formatDate(entry.updated_at)}</span>
    </div>` : ""}
  `;

  el.drawerFooter.innerHTML = `<button class="btn btn-primary" id="edit-btn">Editar</button>`;
  document.getElementById("edit-btn").addEventListener("click", () => openDrawerEdit(entry));

  showDrawer();
}

// ---------- Drawer: crear / editar ----------

function entryForm(entry) {
  const v = entry || {};
  const clientes = distinctValues("cliente");
  const tipos = distinctValues("tipo_desarrollo");
  const lenguajes = distinctValues("lenguaje");
  const encargados = distinctValues("encargado");

  return `
    <form id="entry-form">
      <div class="field">
        <label for="f-cliente">Cliente</label>
        <input list="dl-cliente" id="f-cliente" value="${escapeHtml(v.cliente || "")}" required />
        <datalist id="dl-cliente">${clientes.map((c) => `<option value="${escapeHtml(c)}">`).join("")}</datalist>
      </div>
      <div class="field">
        <label for="f-tipo">Tipo de desarrollo</label>
        <input list="dl-tipo" id="f-tipo" value="${escapeHtml(v.tipo_desarrollo || "")}" required />
        <datalist id="dl-tipo">${tipos.map((t) => `<option value="${escapeHtml(t)}">`).join("")}</datalist>
      </div>
      <div class="field">
        <label for="f-lenguaje">Lenguaje</label>
        <input list="dl-lenguaje" id="f-lenguaje" value="${escapeHtml(v.lenguaje || "")}" />
        <datalist id="dl-lenguaje">${lenguajes.map((l) => `<option value="${escapeHtml(l)}">`).join("")}</datalist>
      </div>
      <div class="field">
        <label for="f-codigo">Código del desarrollo</label>
        <textarea id="f-codigo" data-mono rows="8">${escapeHtml(v.codigo_desarrollo || "")}</textarea>
      </div>
      <div class="field">
        <label for="f-descripcion">Descripción</label>
        <textarea id="f-descripcion" rows="4">${escapeHtml(v.descripcion || "")}</textarea>
      </div>
      <div class="field">
        <label for="f-encargado">Encargado</label>
        <input list="dl-encargado" id="f-encargado" value="${escapeHtml(v.encargado || "")}" />
        <datalist id="dl-encargado">${encargados.map((e) => `<option value="${escapeHtml(e)}">`).join("")}</datalist>
      </div>
      <div class="field">
        <label for="f-fecha">Fecha</label>
        <input type="date" id="f-fecha" value="${v.fecha || new Date().toISOString().slice(0, 10)}" />
      </div>
      <div class="field">
        <label for="f-tags">Etiquetas (separadas por comas)</label>
        <input id="f-tags" value="${escapeHtml((v.tags || []).join(", "))}" />
      </div>
      <p class="error-text" id="form-error"></p>
    </form>
  `;
}

function openDrawerCreate() {
  state.drawerMode = "create";
  state.activeEntry = null;
  el.drawerEyebrow.textContent = state.filter.cliente ? `${state.filter.cliente}${state.filter.tipo ? " · " + state.filter.tipo : ""}` : "Nueva entrada";
  el.drawerTitle.textContent = "Nueva entrada";
  el.drawerBody.innerHTML = entryForm({ cliente: state.filter.cliente, tipo_desarrollo: state.filter.tipo });
  el.drawerFooter.innerHTML = `<span></span><button class="btn btn-primary" id="save-btn">Guardar</button>`;
  document.getElementById("save-btn").addEventListener("click", () => submitForm(null));
  showDrawer();
}

function openDrawerEdit(entry) {
  state.drawerMode = "edit";
  state.activeEntry = entry;
  el.drawerEyebrow.textContent = "Editando";
  el.drawerTitle.textContent = entry.codigo_desarrollo || "(sin código)";
  el.drawerBody.innerHTML = entryForm(entry);
  el.drawerFooter.innerHTML = `<span></span><button class="btn btn-primary" id="save-btn">Guardar cambios</button>`;
  document.getElementById("save-btn").addEventListener("click", () => submitForm(entry.id));
  showDrawer();
}

async function submitForm(editingId) {
  const payload = {
    cliente: document.getElementById("f-cliente").value.trim(),
    tipo_desarrollo: document.getElementById("f-tipo").value.trim(),
    lenguaje: document.getElementById("f-lenguaje").value.trim() || null,
    codigo_desarrollo: document.getElementById("f-codigo").value,
    descripcion: document.getElementById("f-descripcion").value || null,
    encargado: document.getElementById("f-encargado").value.trim() || null,
    fecha: document.getElementById("f-fecha").value || null,
    tags: document.getElementById("f-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
  };

  if (!payload.cliente || !payload.tipo_desarrollo) {
    document.getElementById("form-error").textContent = "Cliente y tipo de desarrollo son obligatorios.";
    return;
  }

  const query = editingId
    ? supabase.from("entradas").update(payload).eq("id", editingId)
    : supabase.from("entradas").insert(payload);

  const { error } = await query;
  if (error) {
    document.getElementById("form-error").textContent = error.message;
    return;
  }

  await fetchEntries();
  closeDrawer();
  renderAll();
}

// ---------- Drawer: mostrar / ocultar ----------

function showDrawer() {
  el.drawer.classList.add("open");
  el.drawerBackdrop.classList.add("open");
}

function closeDrawer() {
  el.drawer.classList.remove("open");
  el.drawerBackdrop.classList.remove("open");
  state.drawerMode = null;
  state.activeEntry = null;
}

el.drawerClose.addEventListener("click", closeDrawer);
el.drawerBackdrop.addEventListener("click", closeDrawer);
el.newEntryBtn.addEventListener("click", openDrawerCreate);

// ---------- Sesión ----------

el.logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.replace("index.html");
});

// ---------- Arranque ----------

(async function init() {
  const session = await requireSession();
  if (!session) return;
  el.sessionEmail.textContent = session.user.email;
  await fetchEntries();
  renderAll();
})();
