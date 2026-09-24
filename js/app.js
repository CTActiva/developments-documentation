import { supabase, requireSession, avatarHtml } from "./supabase-client.js";

const state = {
  entries: [],
  clientes: [],
  lenguajes: [],
  perfiles: [],
  carpetas: [],
  filter: { clienteId: null, carpetaId: null },
  drawerMode: null, // 'view' | 'create' | 'edit' | 'create_folder'
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

// ---------- Utilidades ----------

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

function displayName(userId, fallbackEmail) {
  const p = state.perfiles.find((pf) => pf.id === userId);
  if (p && (p.nombre || p.apellidos)) return [p.nombre, p.apellidos].filter(Boolean).join(" ");
  return fallbackEmail || "—";
}

function ownPerfil(session) {
  return state.perfiles.find((p) => p.id === session.user.id) || { id: session.user.id };
}

// ---------- Helper de Carpetas y Jerarquía ----------

function findFolder(folderId) {
  return state.carpetas.find((f) => String(f.id) === String(folderId));
}

function getClientForFolder(folderId) {
  const folder = findFolder(folderId);
  if (!folder) return null;
  const cVal = folder.cliente_id || folder.cliente;
  return state.clientes.find((c) => String(c.id) === String(cVal) || c.nombre === cVal);
}

// Retorna la ruta en formato "Cliente / Carpeta Padre / Subcarpeta"
function getFolderPathString(folderId) {
  const folder = findFolder(folderId);
  if (!folder) return "—";
  
  const parts = [folder.nombre];
  let curr = folder;
  while (curr && curr.parent_id) {
    curr = findFolder(curr.parent_id);
    if (curr) parts.unshift(curr.nombre);
  }
  
  const client = getClientForFolder(folderId);
  if (client) parts.unshift(client.nombre);
  
  return parts.join(" / ");
}

// Obtiene todos los IDs de subcarpetas (recursivamente)
function getSubfolderIds(folderId) {
  const result = [String(folderId)];
  const children = state.carpetas.filter((f) => String(f.parent_id) === String(folderId));
  children.forEach((child) => {
    result.push(...getSubfolderIds(child.id));
  });
  return result;
}

// Obtiene todos los IDs de carpetas pertenecientes a un cliente
function getFolderIdsForClient(clientId) {
  const clientFolders = state.carpetas.filter((f) => {
    const cVal = f.cliente_id || f.cliente;
    return String(cVal) === String(clientId) || cVal === clientId;
  });
  return clientFolders.map((f) => String(f.id));
}

// ---------- Peticiones a Supabase ----------

async function fetchEntries() {
  const { data, error } = await supabase
    .from("entradas")
    .select("*")
    .order("fecha", { ascending: false, nullsFirst: false });
  if (error) {
    el.entryList.innerHTML = `<div class="empty-state"><h2>No se pudieron cargar las entradas</h2><p>${escapeHtml(error.message)}</p></div>`;
    return;
  }
  state.entries = data || [];
}

async function fetchLookups() {
  const [{ data: clientes }, { data: lenguajes }, { data: perfiles }, { data: carpetas }] = await Promise.all([
    supabase.from("clientes").select("*").order("nombre"),
    supabase.from("lenguajes").select("*").order("nombre"),
    supabase.from("perfiles").select("*"),
    supabase.from("carpetas").select("*").order("nombre"),
  ]);
  state.clientes = clientes || [];
  state.lenguajes = lenguajes || [];
  state.perfiles = perfiles || [];
  state.carpetas = carpetas || [];
}

// ---------- Render: Árbol lateral (Clientes -> Carpetas -> Subcarpetas) ----------

function buildFolderTreeNode(folder) {
  const folderId = String(folder.id);
  const isFolderActive = state.filter.carpetaId === folderId;
  
  const subIds = getSubfolderIds(folderId);
  const folderCount = state.entries.filter((e) => subIds.includes(String(e.carpeta_id))).length;

  const node = document.createElement("div");
  node.className = `tree-node tree-carpeta${isFolderActive ? " active" : ""}`;
  
  const cVal = folder.cliente_id || folder.cliente;

  node.innerHTML = `
    <div class="tree-label" data-carpeta-id="${escapeHtml(folderId)}" style="cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:4px; padding:4px 6px;">
      <span style="flex:1;">📁 ${escapeHtml(folder.nombre)}</span>
      <button class="btn btn-sm btn-add-folder" data-add-for-parent="${escapeHtml(folderId)}" data-add-for-client="${escapeHtml(cVal)}" title="Añadir subcarpeta" style="padding:1px 5px; font-size:11px;">+</button>
      <button class="btn btn-sm btn-delete-folder" data-delete-folder-id="${escapeHtml(folderId)}" title="Borrar carpeta" style="padding:1px 5px; font-size:11px; color:var(--danger); border-color:var(--danger);">🗑</button>
      <span class="tree-count">${folderCount}</span>
    </div>
  `;

  const childFolders = state.carpetas.filter((f) => String(f.parent_id) === folderId);
  if (childFolders.length > 0) {
    const subContainer = document.createElement("div");
    subContainer.style.paddingLeft = "12px";
    childFolders.forEach((child) => {
      subContainer.appendChild(buildFolderTreeNode(child));
    });
    node.appendChild(subContainer);
  }

  return node;
}

function renderTree() {
  el.tree.innerHTML = "";

  state.clientes.forEach((clienteObj) => {
    const clientId = clienteObj.id || clienteObj.nombre;
    const clientName = clienteObj.nombre;
    const isClientActive = state.filter.clienteId === clientId && !state.filter.carpetaId;
    
    const clientFolderIds = getFolderIdsForClient(clientId);
    const clientCount = state.entries.filter((e) => clientFolderIds.includes(String(e.carpeta_id))).length;

    const clientNode = document.createElement("div");
    clientNode.className = `tree-node tree-cliente${isClientActive ? " active" : ""}`;
    
    clientNode.innerHTML = `
      <div class="tree-label" data-cliente-id="${escapeHtml(clientId)}" style="cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:6px;">
        <span style="flex:1; font-weight:600;">${escapeHtml(clientName)}</span>
        <button class="btn btn-sm btn-add-folder" data-add-for-client="${escapeHtml(clientId)}" title="Añadir carpeta raíz" style="padding:1px 6px; font-size:11px;">+</button>
        <span class="tree-count">${clientCount}</span>
      </div>
    `;

    const rootFolders = state.carpetas.filter((f) => {
      const cVal = f.cliente_id || f.cliente;
      const matchesClient = String(cVal) === String(clientId) || cVal === clientName;
      return matchesClient && !f.parent_id;
    });

    if (rootFolders.length > 0) {
      const subContainer = document.createElement("div");
      subContainer.style.paddingLeft = "12px";
      rootFolders.forEach((folder) => {
        subContainer.appendChild(buildFolderTreeNode(folder));
      });
      clientNode.appendChild(subContainer);
    }

    el.tree.appendChild(clientNode);
  });
}

el.tree.addEventListener("click", async (event) => {
  // 1. Borrar carpeta
  const deleteBtn = event.target.closest(".btn-delete-folder");
  if (deleteBtn) {
    event.stopPropagation();
    const folderId = deleteBtn.dataset.deleteFolderId;
    const folder = findFolder(folderId);
    
    if (!folder) return;

    const isConfirmed = confirm(
      `¿Estás seguro de que quieres eliminar la carpeta "${folder.nombre}"?\n` +
      `Se borrarán también todas sus subcarpetas y desarrollos contenidos.`
    );

    if (isConfirmed) {
      const { error } = await supabase.from("carpetas").delete().eq("id", folderId);

      if (error) {
        alert("Error al borrar la carpeta: " + error.message);
        return;
      }

      // Si la carpeta borrada (o una de sus subcarpetas) estaba seleccionada, limpiamos el filtro
      if (state.filter.carpetaId && getSubfolderIds(folderId).includes(String(state.filter.carpetaId))) {
        state.filter.carpetaId = null;
      }

      // Volvemos a recargar datos y renderizar
      await Promise.all([fetchEntries(), fetchLookups()]);
      renderAll();
    }
    return;
  }

  // 2. Añadir subcarpeta
  const addBtn = event.target.closest(".btn-add-folder");
  if (addBtn) {
    event.stopPropagation();
    const parentId = addBtn.dataset.addForParent || null;
    const clientId = addBtn.dataset.addForClient || null;
    openDrawerCreateFolder(clientId, parentId);
    return;
  }

  // 3. Seleccionar carpeta
  const folderLabel = event.target.closest("[data-carpeta-id]");
  if (folderLabel) {
    const cId = folderLabel.dataset.carpetaId;
    const folder = findFolder(cId);
    const clientVal = folder ? (folder.cliente_id || folder.cliente) : null;
    state.filter = { clienteId: clientVal, carpetaId: cId };
    renderAll();
    return;
  }

  // 4. Seleccionar cliente
  const clientLabel = event.target.closest("[data-cliente-id]");
  if (clientLabel) {
    state.filter = { clienteId: clientLabel.dataset.clienteId, carpetaId: null };
    renderAll();
    return;
  }
});

el.rootFilter.addEventListener("click", () => {
  state.filter = { clienteId: null, carpetaId: null };
  renderAll();
});

// ---------- Render: Listado y Migas de Pan ----------

function filteredEntries() {
  if (state.filter.carpetaId) {
    const validFolderIds = getSubfolderIds(state.filter.carpetaId);
    return state.entries.filter((e) => validFolderIds.includes(String(e.carpeta_id)));
  }
  if (state.filter.clienteId) {
    const validFolderIds = getFolderIdsForClient(state.filter.clienteId);
    return state.entries.filter((e) => validFolderIds.includes(String(e.carpeta_id)));
  }
  return state.entries;
}

function renderBreadcrumb() {
  if (state.filter.carpetaId) {
    el.breadcrumb.innerHTML = `<strong>${escapeHtml(getFolderPathString(state.filter.carpetaId))}</strong>`;
  } else if (state.filter.clienteId) {
    const client = state.clientes.find((c) => String(c.id) === String(state.filter.clienteId) || c.nombre === state.filter.clienteId);
    const name = client ? client.nombre : state.filter.clienteId;
    el.breadcrumb.innerHTML = `<strong>${escapeHtml(name)}</strong>`;
  } else {
    el.breadcrumb.innerHTML = "Todos los clientes";
  }
}

function renderList() {
  const rows = filteredEntries();
  if (rows.length === 0) {
    el.entryList.innerHTML = `
      <div class="empty-state">
        <h2>No hay entradas aquí todavía</h2>
        <p>Crea la primera con "Nueva entrada" arriba a la derecha o selecciona/crea una carpeta.</p>
      </div>`;
    return;
  }

  el.entryList.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Código</th><th>Carpeta</th><th>Lenguaje</th><th>Ubicación</th><th>Encargado</th><th>Fecha</th><th>Etiquetas</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((e) => `
          <tr data-id="${e.id}">
            <td class="mono">${escapeHtml(e.codigo_desarrollo || "—")}</td>
            <td>${escapeHtml(getFolderPathString(e.carpeta_id))}</td>
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

  // El botón "Nueva entrada" sólo estará visible si hay una carpeta seleccionada
  if (el.newEntryBtn) {
    el.newEntryBtn.style.display = state.filter.carpetaId ? "inline-flex" : "none";
  }
}

// ---------- Drawer: Ver detalles ----------

function openDrawerView(entry) {
  state.drawerMode = "view";
  state.activeEntry = entry;
  
  const folderPath = getFolderPathString(entry.carpeta_id);
  el.drawerEyebrow.textContent = [folderPath, entry.ubicacion].filter(Boolean).join(" · ");
  el.drawerTitle.textContent = entry.codigo_desarrollo || "(sin código)";

  el.drawerBody.innerHTML = `
    <div class="section-label">Descripción</div>
    <div>${escapeHtml(entry.descripcion) || '<span style="color:var(--ink-muted)">Sin descripción.</span>'}</div>

    <div class="section-label">Código del desarrollo</div>
    <div class="code-block mono">${escapeHtml(entry.codigo_desarrollo) || "—"}</div>

    <div class="section-label">Detalles</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
      <div style="grid-column:1/-1"><div style="color:var(--ink-muted)">Carpeta</div>${escapeHtml(folderPath)}</div>
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
      <span>Última edición por ${escapeHtml(displayName(entry.updated_by, entry.updated_by_email))} ·${formatDate(entry.updated_at)}</span>
    </div>` : ""}
  `;

  el.drawerFooter.innerHTML = `
    <button class="btn btn-danger" id="delete-btn">Borrar</button>
    <button class="btn btn-primary" id="edit-btn">Editar</button>
  `;

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

// ---------- Drawer: Crear / Editar Entrada ----------

function picklistField(key, label, optionsHtml) {
  return `
    <div class="field">
      <label for="f-${key}">${label}</label>
      <select id="f-${key}">
        <option value="">Selecciona…</option>
        ${optionsHtml}
      </select>
    </div>
  `;
}

function entryForm(entry) {
  const v = entry || {};
  const currentCarpetaId = v.carpeta_id || state.filter.carpetaId || "";

  // Desplegable de Carpetas con su ruta completa
  const carpetasOptions = state.carpetas.map((f) => {
    const selected = String(f.id) === String(currentCarpetaId) ? "selected" : "";
    return `<option value="${escapeHtml(f.id)}" ${selected}>${escapeHtml(getFolderPathString(f.id))}</option>`;
  }).join("");

  // Desplegable de Lenguajes
  const lenguajesOptions = state.lenguajes.map((l) => {
    const selected = l.nombre === v.lenguaje ? "selected" : "";
    return `<option value="${escapeHtml(l.nombre)}" ${selected}>${escapeHtml(l.nombre)}</option>`;
  }).join("");

  // Desplegable de Encargados (Perfiles registrados en Supabase)
  const encargadosFormateados = state.perfiles.map((p) => {
    const nombreCompleto = [p.nombre, p.apellidos].filter(Boolean).join(" ");
    return { nombre: nombreCompleto || p.email || "Usuario sin nombre" };
  }).filter((p) => p.nombre);

  const uniqueEncargados = Array.from(new Set(encargadosFormateados.map((e) => e.nombre)))
    .map((nombre) => ({ nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const encargadosOptions = uniqueEncargados.map((e) => {
    const selected = e.nombre === v.encargado ? "selected" : "";
    return `<option value="${escapeHtml(e.nombre)}" ${selected}>${escapeHtml(e.nombre)}</option>`;
  }).join("");

  return `
    <form id="entry-form">
      ${picklistField("carpeta", "Carpeta", carpetasOptions)}
      ${picklistField("lenguaje", "Lenguaje", lenguajesOptions)}
      <div class="field">
        <label for="f-ubicacion">Ubicación</label>
        <input id="f-ubicacion" value="${escapeHtml(v.ubicacion || "")}" placeholder="p. ej. servidor de producción, sede central…" />
      </div>
      <div class="field">
        <label for="f-codigo">Código del desarrollo</label>
        <textarea id="f-codigo" data-mono rows="8">${escapeHtml(v.codigo_desarrollo || "")}</textarea>
      </div>
      <div class="field">
        <label for="f-descripcion">Descripción</label>
        <textarea id="f-descripcion" rows="4">${escapeHtml(v.descripcion || "")}</textarea>
      </div>
      ${picklistField("encargado", "Encargado", encargadosOptions)}
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
  const activeFolderId = state.filter.carpetaId;

  // Solo se permite crear una entrada si hay una carpeta activa seleccionada
  if (!activeFolderId) return;

  state.drawerMode = "create";
  state.activeEntry = null;

  el.drawerEyebrow.textContent = getFolderPathString(activeFolderId);
  el.drawerTitle.textContent = "Nueva entrada";

  el.drawerBody.innerHTML = entryForm({ carpeta_id: activeFolderId });

  // Deshabilitar el selector de carpeta para que quede fijo
  const folderSelect = document.getElementById("f-carpeta");
  if (folderSelect) {
    folderSelect.disabled = true;
    folderSelect.style.backgroundColor = "#f3f4f6";
    folderSelect.style.cursor = "not-allowed";
  }

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
    carpeta_id: document.getElementById("f-carpeta").value || null,
    lenguaje: document.getElementById("f-lenguaje").value.trim() || null,
    ubicacion: document.getElementById("f-ubicacion").value.trim() || null,
    codigo_desarrollo: document.getElementById("f-codigo").value.trim() || null,
    descripcion: document.getElementById("f-descripcion").value || null,
    encargado: document.getElementById("f-encargado").value.trim() || null,
    fecha: document.getElementById("f-fecha").value || null,
    tags: document.getElementById("f-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
  };

  // Mensajes de error individuales
  const errores = [];
  if (!payload.carpeta_id) {
    errores.push("El campo Carpeta es obligatorio.");
  }
  if (!payload.lenguaje) {
    errores.push("El campo Lenguaje es obligatorio.");
  }
  if (!payload.codigo_desarrollo) {
    errores.push("El campo Código del desarrollo es obligatorio.");
  }

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

// ---------- Drawer: Crear Nueva Carpeta ----------

// Helper para generar las opciones de carpetas padre filtradas por cliente
function getParentFolderOptions(clientId, selectedParentId = null) {
  if (!clientId) {
    return '<option value="">(Selecciona primero un cliente)</option>';
  }

  // Filtrar carpetas que pertenecen únicamente a este cliente
  const clientFolders = state.carpetas.filter((f) => {
    const cVal = f.cliente_id || f.cliente;
    return String(cVal) === String(clientId) || cVal === clientId;
  });

  if (clientFolders.length === 0) {
    return '<option value="">(Ninguna - Será una carpeta raíz)</option>';
  }

  let html = '<option value="">(Ninguna - Carpeta Raíz)</option>';
  html += clientFolders.map((f) => {
    const selected = String(f.id) === String(selectedParentId) ? "selected" : "";
    return `<option value="${escapeHtml(f.id)}" ${selected}>${escapeHtml(getFolderPathString(f.id))}</option>`;
  }).join("");

  return html;
}

function openDrawerCreateFolder(defaultClienteId = null, defaultParentId = null) {
  state.drawerMode = "create_folder";
  state.activeEntry = null;

  // Si nos viene un parentId por defecto, resolvemos su cliente
  if (defaultParentId) {
    const parentFolder = findFolder(defaultParentId);
    if (parentFolder) {
      defaultClienteId = parentFolder.cliente_id || parentFolder.cliente;
    }
  }

  // Textos descriptivos para el encabezado del drawer
  const parentFolder = defaultParentId ? findFolder(defaultParentId) : null;
  const clientObj = state.clientes.find((c) => String(c.id) === String(defaultClienteId) || c.nombre === defaultClienteId);
  const clientName = clientObj ? clientObj.nombre : "";

  el.drawerEyebrow.textContent = parentFolder 
    ? `Subcarpeta en: ${getFolderPathString(defaultParentId)}`
    : clientName ? `Carpeta raíz para: ${clientName}` : "Estructura";

  el.drawerTitle.textContent = "Crear nueva carpeta";

  const clientOptions = state.clientes.map((c) => {
    const cId = c.id || c.nombre;
    const selected = String(cId) === String(defaultClienteId) ? "selected" : "";
    return `<option value="${escapeHtml(cId)}" ${selected}>${escapeHtml(c.nombre)}</option>`;
  }).join("");

  el.drawerBody.innerHTML = `
    <form id="folder-form">
      <div class="field">
        <label for="f-folder-nombre">Nombre de la carpeta</label>
        <input id="f-folder-nombre" placeholder="p. ej. Workflows, Publishers…" autofocus />
      </div>
      <div class="field">
        <label for="f-folder-cliente">Cliente</label>
        <select id="f-folder-cliente" disabled style="background-color: #f3f4f6; cursor: not-allowed;">
          ${clientOptions}
        </select>
      </div>
      <div class="field">
        <label for="f-folder-parent">Carpeta padre</label>
        <select id="f-folder-parent" disabled style="background-color: #f3f4f6; cursor: not-allowed;">
          ${getParentFolderOptions(defaultClienteId, defaultParentId)}
        </select>
      </div>
      <p class="error-text" id="folder-form-error"></p>
    </form>
  `;

  el.drawerFooter.innerHTML = `<span></span><button class="btn btn-primary" id="save-folder-btn">Crear carpeta</button>`;

  const clientSelect = document.getElementById("f-folder-cliente");
  const parentSelect = document.getElementById("f-folder-parent");

  document.getElementById("save-folder-btn").addEventListener("click", async () => {
    const nombre = document.getElementById("f-folder-nombre").value.trim();
    const cliente_id = clientSelect.value;
    const parent_id = parentSelect.value || null;

    if (!nombre) {
      document.getElementById("folder-form-error").textContent = "El nombre de la carpeta es obligatorio.";
      return;
    }
    if (!cliente_id) {
      document.getElementById("folder-form-error").textContent = "Debes seleccionar un cliente.";
      return;
    }

    const { error } = await supabase.from("carpetas").insert({
      nombre,
      cliente_id,
      parent_id,
    });

    if (error) {
      document.getElementById("folder-form-error").textContent = error.message;
      return;
    }

    await fetchLookups();
    closeDrawer();
    renderAll();
  });

  showDrawer();
}

// ---------- Drawer: Abrir / Cerrar ----------

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

// ---------- Sesión y Arranque ----------

el.logoutBtn.addEventListener("click", async () => {
  await supabase.auth.signOut();
  window.location.replace("index.html");
});

(async function init() {
  const session = await requireSession();
  if (!session) return;

  await Promise.all([fetchEntries(), fetchLookups()]);

  el.sessionEmail.textContent = session.user.email;
  el.sessionAvatar.innerHTML = avatarHtml(ownPerfil(session), "avatar-sm");

  renderAll();
})();