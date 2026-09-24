import { supabase, requireSession, avatarHtml } from "./supabase-client.js";

const state = {
  entries: [],
  clientes: [],
  lenguajes: [],
  perfiles: [],
  filter: { cliente: null },
  drawerMode: null, // 'view' | 'create' | 'edit'
  activeEntry: null,
};

const el = {
  tree: document.getElementById("tree"),
  rootFilter: document.getElementById("root-filter"),
  breadcrumb: document.getElementById("breadcrumb"),
  entryList: document.getElementById("entry-list"),
  sessionEmail: document.getElementById("session-email"),
  sessionAvatar: document.getElementById("session-avatar"),
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
  return [...set];
}

function displayName(userId, fallbackEmail) {
  const p = state.perfiles.find((pf) => pf.id === userId);
  if (p && (p.nombre || p.apellidos)) return [p.nombre, p.apellidos].filter(Boolean).join(" ");
  return fallbackEmail || "—";
}

function ownPerfil(session) {
  return state.perfiles.find((p) => p.id === session.user.id) || { id: session.user.id };
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

async function fetchLookups() {
  const [{ data: clientes }, { data: lenguajes }, { data: perfiles }] = await Promise.all([
    supabase.from("clientes").select("*").order("nombre"),
    supabase.from("lenguajes").select("*").order("nombre"),
    supabase.from("perfiles").select("*"),
  ]);
  state.clientes = clientes || [];
  state.lenguajes = lenguajes || [];
  state.perfiles = perfiles || [];
}

function buildTree() {
  const tree = new Map(); // cliente -> count
  state.entries.forEach((e) => {
    tree.set(e.cliente, (tree.get(e.cliente) || 0) + 1);
  });
  return tree;
}

// ---------- Render: árbol (un solo nivel, por cliente) ----------

function renderTree() {
  const tree = buildTree();
  el.tree.innerHTML = "";

  [...tree.keys()].sort((a, b) => a.localeCompare(b)).forEach((cliente) => {
    const isActive = state.filter.cliente === cliente;
    const node = document.createElement("div");
    node.className = `tree-node tree-cliente${isActive ? " active" : ""}`;
    node.innerHTML = `
      <div class="tree-label" data-cliente="${escapeHtml(cliente)}" style="cursor:pointer">
        <span style="flex:1">${escapeHtml(cliente)}</span>
        <span class="tree-count">${tree.get(cliente)}</span>
      </div>
    `;
    el.tree.appendChild(node);
  });
}

el.tree.addEventListener("click", (event) => {
  const label = event.target.closest(".tree-label");
  if (!label) return;
  state.filter = { cliente: label.dataset.cliente };
  renderAll();
});

el.rootFilter.addEventListener("click", () => {
  state.filter = { cliente: null };
  renderAll();
});

// ---------- Render: listado ----------

function filteredEntries() {
  return state.entries.filter((e) => !state.filter.cliente || e.cliente === state.filter.cliente);
}

function renderBreadcrumb() {
  el.breadcrumb.innerHTML = state.filter.cliente
    ? `<strong>${escapeHtml(state.filter.cliente)}</strong>`
    : "Todos los clientes";
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
          <th>Código</th><th>Cliente</th><th>Lenguaje</th><th>Ubicación</th><th>Encargado</th><th>Fecha</th><th>Etiquetas</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((e) => `
          <tr data-id="${e.id}">
            <td class="mono">${escapeHtml(e.codigo_desarrollo || "—")}</td>
            <td>${escapeHtml(e.cliente)}</td>
            <td>${escapeHtml(e.lenguaje || "—")}</td>
            <td>${escapeHtml(e.ubicacion || "—")}</td>
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
  el.drawerEyebrow.textContent = [entry.cliente, entry.ubicacion].filter(Boolean).join(" · ");
  el.drawerTitle.textContent = entry.codigo_desarrollo || "(sin código)";

  el.drawerBody.innerHTML = `
    <div class="section-label">Descripción</div>
    <div>${escapeHtml(entry.descripcion) || "<span style=\"color:var(--ink-muted)\">Sin descripción.</span>"}</div>

    <div class="section-label">Código del desarrollo</div>
    <div class="code-block mono">${escapeHtml(entry.codigo_desarrollo) || "—"}</div>

    <div class="section-label">Detalles</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
      <div><div style="color:var(--ink-muted)">Lenguaje</div>${escapeHtml(entry.lenguaje) || "—"}</div>
      <div><div style="color:var(--ink-muted)">Ubicación</div>${escapeHtml(entry.ubicacion) || "—"}</div>
      <div><div style="color:var(--ink-muted)">Encargado</div>${escapeHtml(entry.encargado) || "—"}</div>
      <div><div style="color:var(--ink-muted)">Fecha</div>${formatDate(entry.fecha)}</div>
      <div style="grid-column:1/-1"><div style="color:var(--ink-muted)">Etiquetas</div>${(entry.tags || []).map((t) => `<span class="tag-pill">${escapeHtml(t)}</span>`).join("") || "—"}</div>
    </div>

    <div class="meta-row">
      <span>Creado por ${escapeHtml(displayName(entry.created_by, entry.created_by_email))} · ${formatDate(entry.created_at)}</span>
    </div>
    ${entry.updated_at !== entry.created_at ? `
    <div class="meta-row" style="border-top:none;padding-top:4px;margin-top:4px">
      <span>Última edición por ${escapeHtml(displayName(entry.updated_by, entry.updated_by_email))} · ${formatDate(entry.updated_at)}</span>
    </div>` : ""}
  `;

  el.drawerFooter.innerHTML = `<button class="btn btn-primary" id="edit-btn">Editar</button>`;
  document.getElementById("edit-btn").addEventListener("click", () => openDrawerEdit(entry));

  document.getElementById("delete-btn").addEventListener("click", async () => {
    const isConfirmed = confirm("¿Estás seguro de que quieres eliminar esta entrada?");
    if (isConfirmed) {
      const { error } = await supabase.from("entradas").delete().eq("id", entry.id);
      if (error) {
        alert("Hubo un error al eliminar: " + error.message);
        return;
      }
      await fetchEntries();
      closeDrawer();
      renderAll();
    }
  });

  showDrawer();
}

// ---------- Drawer: crear / editar ----------

function picklistOptions(list, currentValue) {
  return list.map((o) => `<option value="${escapeHtml(o.nombre)}" ${o.nombre === currentValue ? "selected" : ""}>${escapeHtml(o.nombre)}</option>`).join("");
}

function picklistField(key, label, list, currentValue) {
  return `
    <div class="field">
      <label for="f-${key}">${label}</label>
      <select id="f-${key}">
        <option value="">Selecciona…</option>
        ${picklistOptions(list, currentValue)}
      </select>
    </div>
  `;
}

function entryForm(entry) {
  const v = entry || {};
  
  // Extraemos y formateamos los nombres de los perfiles de Supabase
  const encargadosFormateados = state.perfiles.map((p) => {
    const nombreCompleto = [p.nombre, p.apellidos].filter(Boolean).join(" ");
    // Si no tiene nombre/apellidos, podemos usar el id o dejarlo genérico
    return { nombre: nombreCompleto || p.email || "Usuario sin nombre" };
  }).filter((p) => p.nombre);

  // Eliminamos posibles duplicados y ordenamos alfabéticamente
  const uniqueEncargados = Array.from(new Set(encargadosFormateados.map(e => e.nombre)))
    .map(nombre => ({ nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  return `
    <form id="entry-form">
      ${picklistField("cliente", "Cliente", state.clientes, v.cliente || "")}
      ${picklistField("lenguaje", "Lenguaje", state.lenguajes, v.lenguaje || "")}
      <div class="field">
        <label for="f-ubicacion">Ubicación</label>
        <input id="f-ubicacion" value="${escapeHtml(v.ubicacion || "")}" />
      </div>
      <div class="field">
        <label for="f-codigo">Código del desarrollo</label>
        <textarea id="f-codigo" data-mono rows="8">${escapeHtml(v.codigo_desarrollo || "")}</textarea>
      </div>
      <div class="field">
        <label for="f-descripcion">Descripción</label>
        <textarea id="f-descripcion" rows="4">${escapeHtml(v.descripcion || "")}</textarea>
      </div>
      
      <!-- Se ha cambiado el input de encargado por un picklist restrictivo -->
      ${picklistField("encargado", "Encargado", uniqueEncargados, v.encargado || "")}
      
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
  el.drawerEyebrow.textContent = state.filter.cliente || "Nueva entrada";
  el.drawerTitle.textContent = "Nueva entrada";
  el.drawerBody.innerHTML = entryForm({ cliente: state.filter.cliente });
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
    lenguaje: document.getElementById("f-lenguaje").value.trim() || null,
    ubicacion: document.getElementById("f-ubicacion").value.trim() || null,
    codigo_desarrollo: document.getElementById("f-codigo").value.trim() || null,
    descripcion: document.getElementById("f-descripcion").value || null,
    encargado: document.getElementById("f-encargado").value.trim() || null,
    fecha: document.getElementById("f-fecha").value || null,
    tags: document.getElementById("f-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
  };

  // Validaciones obligatorias actualizadas
  // Validaciones obligatorias individuales
  let errores = [];
  
  if (!payload.cliente) {
    errores.push("El campo Cliente es obligatorio.");
  }
  if (!payload.lenguaje) {
    errores.push("El campo Lenguaje es obligatorio.");
  }
  if (!payload.codigo_desarrollo) {
    errores.push("El campo Código del desarrollo es obligatorio.");
  }

  // Si hay algún error, los mostramos todos juntos separados por un salto de línea
  if (errores.length > 0) {
    document.getElementById("form-error").innerHTML = errores.join("<br>");
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

  await Promise.all([fetchEntries(), fetchLookups()]);

  el.sessionEmail.textContent = session.user.email;
  el.sessionAvatar.innerHTML = avatarHtml(ownPerfil(session), "avatar-sm");

  renderAll();
})();
