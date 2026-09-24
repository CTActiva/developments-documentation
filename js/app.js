import { supabase, requireSession, avatarHtml } from "./supabase-client.js";

const state = {
  entries: [],
  clientes: [],
  lenguajes: [],
  perfiles: [],
  carpetas: [],
  filter: { clienteId: null, carpetaId: null },
  expandedFolders: new Set(), // Registro de IDs de carpetas desplegadas
  viewMode: "list", // 'list' | 'detail'
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

// js/app.js (Línea 1, arriba del todo)

window.MonacoEnvironment = {
  getWorkerUrl: function (workerId, label) {
    const getWorkerModule = (moduleUrl) =>
      `data:text/javascript;charset=utf-8,${encodeURIComponent(`
        self.MonacoEnvironment = { baseUrl: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/' };
        importScripts('${moduleUrl}');
      `)}`;

    if (label === 'typescript' || label === 'javascript') {
      return getWorkerModule('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/language/typescript/ts.worker.js');
    }
    if (label === 'json') {
      return getWorkerModule('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/language/json/json.worker.js');
    }
    if (label === 'html') {
      return getWorkerModule('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/language/html/html.worker.js');
    }
    if (label === 'css') {
      return getWorkerModule('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/language/css/css.worker.js');
    }
    return getWorkerModule('https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs/base/worker/workerMain.js');
  }
};

// --- A partir de aquí sigue el resto de tu código normal de js/app.js ---
import { supabase } from "./supabase.js";
// ...

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

function getSubfolderIds(folderId) {
  const result = [String(folderId)];
  const children = state.carpetas.filter((f) => String(f.parent_id) === String(folderId));
  children.forEach((child) => {
    result.push(...getSubfolderIds(child.id));
  });
  return result;
}

function getFolderIdsForClient(clientId) {
  const clientFolders = state.carpetas.filter((f) => {
    const cVal = f.cliente_id || f.cliente;
    return String(cVal) === String(clientId) || cVal === clientId;
  });
  return clientFolders.map((f) => String(f.id));
}

// Replega recursivamente una carpeta y todas sus subcarpetas hijas
function collapseFolderAndDescendants(folderId) {
  const allSubIds = getSubfolderIds(folderId);
  allSubIds.forEach((id) => state.expandedFolders.delete(String(id)));
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

// ---------- Render: Árbol lateral ----------

function buildFolderTreeNode(folder) {
  const folderId = String(folder.id);
  const isFolderActive = state.filter.carpetaId === folderId;
  const childFolders = state.carpetas.filter((f) => String(f.parent_id) === folderId);
  const hasChildren = childFolders.length > 0;
  const isExpanded = state.expandedFolders.has(folderId);

  // Conteo de documentos pertenecientes a esta carpeta
  const folderCount = state.entries.filter((e) => String(e.carpeta_id) === folderId).length;

  const node = document.createElement("div");
  node.className = `tree-node tree-carpeta${isFolderActive ? " active" : ""}`;
  
  const cVal = folder.cliente_id || folder.cliente;

  node.innerHTML = `
    <div class="tree-label" data-carpeta-id="${escapeHtml(folderId)}" style="cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:6px; padding:4px 6px;">
      <div style="display:flex; align-items:center; gap:4px;">
        ${hasChildren ? `<button class="tree-toggle" data-toggle-id="${escapeHtml(folderId)}">${isExpanded ? "▼" : "▶"}</button>` : '<span style="width:14px"></span>'}
        <span>📁 ${escapeHtml(folder.nombre)}</span>
      </div>
      <div style="display:flex; align-items:center; gap:4px;">
        <button class="btn btn-sm btn-add-folder" data-add-for-parent="${escapeHtml(folderId)}" data-add-for-client="${escapeHtml(cVal)}" title="Añadir subcarpeta" style="padding:1px 5px; font-size:11px;">+</button>
        <button class="btn btn-sm btn-delete-folder" data-delete-folder-id="${escapeHtml(folderId)}" title="Borrar carpeta" style="padding:1px 5px; font-size:11px; color:var(--danger); border-color:var(--danger);">🗑</button>
        <span class="tree-count">${folderCount}</span>
      </div>
    </div>
  `;

  if (hasChildren && isExpanded) {
    const subContainer = document.createElement("div");
    subContainer.style.paddingLeft = "16px";
    childFolders.forEach((child) => {
      subContainer.appendChild(buildFolderTreeNode(child));
    });
    node.appendChild(subContainer);
  }

  return node;
}

function renderTree() {
  el.tree.innerHTML = "";

  // Todos los clientes permanecen visibles siempre en la barra lateral
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
        <span style="flex:1; font-weight:600;">🏢 ${escapeHtml(clientName)}</span>
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
  // 1. Botón ▶ / ▼ para desplegar o contraer
  const toggleBtn = event.target.closest(".tree-toggle");
  if (toggleBtn) {
    event.stopPropagation();
    const folderId = toggleBtn.dataset.toggleId;
    if (state.expandedFolders.has(folderId)) {
      // Replegar carpeta y limpiar el estado de sus subcarpetas hijas
      collapseFolderAndDescendants(folderId);
    } else {
      state.expandedFolders.add(folderId);
    }
    renderTree();
    return;
  }

  // 2. Borrar carpeta
  const deleteBtn = event.target.closest(".btn-delete-folder");
  if (deleteBtn) {
    event.stopPropagation();
    const folderId = deleteBtn.dataset.deleteFolderId;
    const folder = findFolder(folderId);
    if (!folder) return;

    if (confirm(`¿Eliminar "${folder.nombre}" y su contenido?`)) {
      const { error } = await supabase.from("carpetas").delete().eq("id", folderId);
      if (error) {
        alert("Error al borrar: " + error.message);
        return;
      }
      if (state.filter.carpetaId === folderId) state.filter.carpetaId = null;
      await Promise.all([fetchEntries(), fetchLookups()]);
      renderAll();
    }
    return;
  }

  // 3. Añadir subcarpeta
  const addBtn = event.target.closest(".btn-add-folder");
  if (addBtn) {
    event.stopPropagation();
    openDrawerCreateFolder(addBtn.dataset.addForClient, addBtn.dataset.addForParent);
    return;
  }

  // 4. Seleccionar carpeta
  const folderLabel = event.target.closest("[data-carpeta-id]");
  if (folderLabel) {
    const cId = folderLabel.dataset.carpetaId;
    const folder = findFolder(cId);
    const clientVal = folder ? (folder.cliente_id || folder.cliente) : null;
    
    // Cierra todas las subcarpetas descendientes de la seleccionada
    const childIds = getSubfolderIds(cId).filter((id) => String(id) !== String(cId));
    childIds.forEach((id) => state.expandedFolders.delete(String(id)));

    // Asegura que la ruta hasta la carpeta seleccionada y la carpeta misma queden desplegadas
    let curr = folder;
    while (curr) {
      state.expandedFolders.add(String(curr.id));
      curr = curr.parent_id ? findFolder(curr.parent_id) : null;
    }

    state.filter = { clienteId: clientVal, carpetaId: cId };
    state.viewMode = "list";
    renderAll();
    return;
  }

  // 5. Seleccionar cliente
  const clientLabel = event.target.closest("[data-cliente-id]");
  if (clientLabel) {
    state.filter = { clienteId: clientLabel.dataset.clienteId, carpetaId: null };
    state.viewMode = "list";
    renderAll();
    return;
  }
});

el.rootFilter.addEventListener("click", () => {
  state.filter = { clienteId: null, carpetaId: null };
  state.viewMode = "list";
  renderAll();
});

// ---------- Render: Filtrado de Entradas ----------

function filteredEntries() {
  // Las entradas SOLO se muestran si hay una carpeta concreta seleccionada
  if (state.filter.carpetaId) {
    return state.entries.filter((e) => String(e.carpeta_id) === String(state.filter.carpetaId));
  }
  return [];
}

function renderBreadcrumb() {
  if (state.filter.carpetaId) {
    el.breadcrumb.innerHTML = `<strong>${escapeHtml(getFolderPathString(state.filter.carpetaId))}</strong>`;
  } else if (state.filter.clienteId) {
    const client = state.clientes.find((c) => String(c.id) === String(state.filter.clienteId) || c.nombre === state.filter.clienteId);
    el.breadcrumb.innerHTML = `<strong>${escapeHtml(client ? client.nombre : state.filter.clienteId)}</strong>`;
  } else {
    el.breadcrumb.innerHTML = "Todos los clientes";
  }
}

function renderList() {
  const rows = filteredEntries();
  if (rows.length === 0) {
    el.entryList.innerHTML = `
      <div class="empty-state">
        <h2>${state.filter.carpetaId ? "No hay entradas en esta carpeta" : "Selecciona una carpeta"}</h2>
        <p>${state.filter.carpetaId ? 'Crea la primera entrada con el botón "+ Nueva entrada".' : "Navega por las carpetas en el menú de la izquierda para ver sus documentos."}</p>
      </div>`;
    return;
  }

  el.entryList.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Descripción</th>
          <th>Lenguaje</th>
          <th>Ubicación</th>
          <th>Encargado</th>
          <th>Fecha</th>
          <th>Etiquetas</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((e) => `
          <tr data-id="${e.id}">
            <td class="desc-cell">${escapeHtml(e.descripcion || "—")}</td>
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

// ---------- Vista completa e interactiva de la entrada ----------

function openFullDetailView(entry) {
  state.viewMode = "detail";
  state.activeEntry = entry;
  renderAll();
}

function renderFullDetailView() {
  const entry = state.activeEntry;
  if (!entry) return;

  const currentFolder = findFolder(entry.carpeta_id);
  const folderName = currentFolder ? currentFolder.nombre : "la carpeta";
  const folderPath = getFolderPathString(entry.carpeta_id);

  // Opciones para desplegables
  const lenguajesOptions = state.lenguajes.map((l) => {
    const selected = l.nombre === entry.lenguaje ? "selected" : "";
    return `<option value="${escapeHtml(l.nombre)}" ${selected}>${escapeHtml(l.nombre)}</option>`;
  }).join("");

  const encargadosFormateados = state.perfiles.map((p) => {
    const nombreCompleto = [p.nombre, p.apellidos].filter(Boolean).join(" ");
    return { nombre: nombreCompleto || p.email || "Usuario sin nombre" };
  }).filter((p) => p.nombre);

  const uniqueEncargados = Array.from(new Set(encargadosFormateados.map((e) => e.nombre)))
    .map((nombre) => ({ nombre }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const encargadosOptions = uniqueEncargados.map((e) => {
    const selected = e.nombre === entry.encargado ? "selected" : "";
    return `<option value="${escapeHtml(e.nombre)}" ${selected}>${escapeHtml(e.nombre)}</option>`;
  }).join("");

  el.entryList.innerHTML = `
    <div class="detail-view">
      <div class="detail-header">
        <button class="btn" id="back-to-list-btn">← Volver a ${escapeHtml(folderName)}</button>
        <div style="display:flex; gap:8px; align-items:center;">
          <span id="detail-status" style="font-size:13px;"></span>
          <button class="btn btn-primary" id="detail-save-btn" disabled>Guardar</button>
          <button class="btn btn-danger" id="detail-delete-btn">Borrar</button>
        </div>
      </div>

      <div style="font-size:13px; color:var(--ink-muted); margin-bottom: 16px;">
        Ubicación: <strong>${escapeHtml(folderPath)}</strong>
      </div>

      <div class="field">
        <label for="detail-descripcion">Descripción</label>
        <textarea id="detail-descripcion" rows="3" placeholder="Añade una descripción...">${escapeHtml(entry.descripcion || "")}</textarea>
      </div>

      <div class="field">
        <label for="detail-codigo">Código del desarrollo</label>
        <div id="monaco-editor-container" style="height: 320px; border: 1px solid var(--border); border-radius: var(--radius); position: relative;"></div>        <textarea id="detail-codigo" style="display:none;">${escapeHtml(entry.codigo_desarrollo || "")}</textarea>
      </div>

      <div class="section-label">Detalles de la entrada</div>
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; background:var(--surface); padding:16px; border:1px solid var(--border); border-radius:var(--radius);">
        <div class="field" style="margin-bottom:0">
          <label for="detail-lenguaje">Lenguaje</label>
          <select id="detail-lenguaje">${lenguajesOptions}</select>
        </div>
        <div class="field" style="margin-bottom:0">
          <label for="detail-ubicacion">Ubicación</label>
          <input id="detail-ubicacion" value="${escapeHtml(entry.ubicacion || "")}" />
        </div>
        <div class="field" style="margin-bottom:0">
          <label for="detail-encargado">Encargado</label>
          <select id="detail-encargado">${encargadosOptions}</select>
        </div>
        <div class="field" style="margin-bottom:0">
          <label for="detail-fecha">Fecha</label>
          <input type="date" id="detail-fecha" value="${entry.fecha || new Date().toISOString().slice(0, 10)}" />
        </div>
        <div class="field" style="margin-bottom:0; grid-column: span 2;">
          <label for="detail-tags">Etiquetas (separadas por comas)</label>
          <input id="detail-tags" value="${escapeHtml((entry.tags || []).join(", "))}" />
        </div>
      </div>

      <div class="meta-row">
        <span>Creado por ${escapeHtml(displayName(entry.created_by, entry.created_by_email))} · ${formatDate(entry.created_at)}</span>
      </div>
      ${entry.updated_at && entry.updated_at !== entry.created_at ? `
      <div class="meta-row" style="border-top:none;padding-top:4px;margin-top:4px">
        <span>Última edición por ${escapeHtml(displayName(entry.updated_by, entry.updated_by_email))} ·${formatDate(entry.updated_at)}</span>
      </div>` : ""}
    </div>
  `;

  const detailViewEl = el.entryList.querySelector(".detail-view");

  function checkDirty() {
    const saveBtn = document.getElementById("detail-save-btn");
    if (!saveBtn) return;

    const currentLenguaje = document.getElementById("detail-lenguaje")?.value || "";
    const currentUbicacion = document.getElementById("detail-ubicacion")?.value.trim() || "";
    const currentCodigo = document.getElementById("detail-codigo")?.value.trim() || "";
    const currentDescripcion = document.getElementById("detail-descripcion")?.value.trim() || "";
    const currentEncargado = document.getElementById("detail-encargado")?.value || "";
    const currentFecha = document.getElementById("detail-fecha")?.value || "";
    const currentTags = (document.getElementById("detail-tags")?.value || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const origTags = entry.tags || [];

    const isChanged =
      currentLenguaje !== (entry.lenguaje || "") ||
      currentUbicacion !== (entry.ubicacion || "") ||
      currentCodigo !== (entry.codigo_desarrollo || "") ||
      currentDescripcion !== (entry.descripcion || "") ||
      currentEncargado !== (entry.encargado || "") ||
      currentFecha !== (entry.fecha || "") ||
      JSON.stringify(currentTags) !== JSON.stringify(origTags);

    saveBtn.disabled = !isChanged;
  }

  detailViewEl.addEventListener("input", checkDirty);
  detailViewEl.addEventListener("change", checkDirty);

  document.getElementById("back-to-list-btn").addEventListener("click", () => {
    state.viewMode = "list";
    renderAll();
  });

  document.getElementById("detail-save-btn").addEventListener("click", async () => {
    const saveBtn = document.getElementById("detail-save-btn");
    const statusText = document.getElementById("detail-status");
    statusText.textContent = "";

    const payload = {
      carpeta_id: entry.carpeta_id,
      lenguaje: document.getElementById("detail-lenguaje").value.trim() || null,
      ubicacion: document.getElementById("detail-ubicacion").value.trim() || null,
      codigo_desarrollo: document.getElementById("detail-codigo").value.trim() || null,
      descripcion: document.getElementById("detail-descripcion").value || null,
      encargado: document.getElementById("detail-encargado").value.trim() || null,
      fecha: document.getElementById("detail-fecha").value || null,
      tags: document.getElementById("detail-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
    };

    if (!payload.lenguaje || !payload.codigo_desarrollo) {
      statusText.style.color = "var(--danger)";
      statusText.textContent = "Lenguaje y Código son obligatorios.";
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = "Guardando…";

    const { error } = await supabase
      .from("entradas")
      .update(payload)
      .eq("id", entry.id);

    if (error) {
      statusText.style.color = "var(--danger)";
      statusText.textContent = error.message;
      saveBtn.disabled = false;
      saveBtn.textContent = "Guardar";
      return;
    }

    await fetchEntries();
    const updatedEntry = state.entries.find((e) => String(e.id) === String(entry.id));
    if (updatedEntry) {
      state.activeEntry = updatedEntry;
    }

    statusText.style.color = "var(--accent)";
    statusText.textContent = "Guardado con éxito.";
    saveBtn.textContent = "Guardar";
    saveBtn.disabled = true;

    renderFullDetailView();
  });

  document.getElementById("detail-delete-btn").addEventListener("click", async () => {
    if (confirm("¿Estás seguro de que quieres eliminar esta entrada?")) {
      const { error } = await supabase.from("entradas").delete().eq("id", entry.id);
      if (error) {
        alert("Error al eliminar: " + error.message);
        return;
      }
      await fetchEntries();
      state.viewMode = "list";
      renderAll();
    }
  });

    // --- Inicialización de Monaco Editor ---
  const container = document.getElementById("monaco-editor-container");
  const hiddenTextarea = document.getElementById("detail-codigo");
  const selectLenguaje = document.getElementById("detail-lenguaje");

  // Mapeo simple de nombres a identificadores de lenguaje de Monaco
  function getMonacoLang(lang) {
    if (!lang) return "plaintext";
    const l = lang.toLowerCase().trim();
    if (l.includes("java") && !l.includes("script")) return "java";
    if (l.includes("script") || l.includes("js")) return "javascript";
    if (l.includes("py")) return "python";
    if (l.includes("sql")) return "sql";
    if (l.includes("html") || l.includes("xml")) return "html";
    if (l.includes("css")) return "css";
    if (l.includes("json")) return "json";
    return "plaintext";
  }

  if (container && window.require) {
    window.require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.45.0/min/vs' } });
    
    window.require(['vs/editor/editor.main'], function () {
      const editorInstance = monaco.editor.create(container, {
      value: hiddenTextarea.value,
      language: getMonacoLang(selectLenguaje.value),
      theme: 'vs-dark',
      automaticLayout: true,
      fontSize: 13,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,

      // --- SOLUCIÓN VISIBILIDAD Y ERRORES ---
      fixedOverflowWidgets: true, // Renderiza el menú de sugerencias por encima de cualquier contenedor
      glyphMargin: true,          // Habilita el margen izquierdo donde aparecen los iconos de error
      quickSuggestions: true,     // Activa la aparición automática de autocompletado
      hover: { enabled: true }     // Activa las ventanas emergentes al pasar el ratón sobre un error
    });

      // Actualiza el textarea oculto y dispara el checkDirty() al editar
      editorInstance.onDidChangeModelContent(() => {
        hiddenTextarea.value = editorInstance.getValue();
        checkDirty();
      });

      // Reacciona si se cambia el lenguaje en el <select>
      selectLenguaje.addEventListener("change", () => {
        monaco.editor.setModelLanguage(
          editorInstance.getModel(),
          getMonacoLang(selectLenguaje.value)
        );
        checkDirty();
      });
    });
  }
}

el.entryList.addEventListener("click", (event) => {
  if (state.viewMode === "detail") return;
  const row = event.target.closest("tr[data-id]");
  if (!row) return;
  const entry = state.entries.find((e) => String(e.id) === row.dataset.id);
  if (entry) openFullDetailView(entry);
});

function renderAll() {
  renderTree();
  renderBreadcrumb();

  if (state.viewMode === "detail") {
    renderFullDetailView();
  } else {
    renderList();
  }

  if (el.newEntryBtn) {
    el.newEntryBtn.style.display = state.filter.carpetaId ? "inline-flex" : "none";
  }
}

// ---------- Modal Lateral (Creación de carpetas / entradas) ----------

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

  const carpetasOptions = state.carpetas.map((f) => {
    const selected = String(f.id) === String(currentCarpetaId) ? "selected" : "";
    return `<option value="${escapeHtml(f.id)}" ${selected}>${escapeHtml(getFolderPathString(f.id))}</option>`;
  }).join("");

  const lenguajesOptions = state.lenguajes.map((l) => {
    const selected = l.nombre === v.lenguaje ? "selected" : "";
    return `<option value="${escapeHtml(l.nombre)}" ${selected}>${escapeHtml(l.nombre)}</option>`;
  }).join("");

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
  if (!activeFolderId) return;

  state.drawerMode = "create";
  el.drawerEyebrow.textContent = getFolderPathString(activeFolderId);
  el.drawerTitle.textContent = "Nueva entrada";
  el.drawerBody.innerHTML = entryForm({ carpeta_id: activeFolderId });

  const folderSelect = document.getElementById("f-carpeta");
  if (folderSelect) {
    folderSelect.disabled = true;
    folderSelect.style.backgroundColor = "#f3f4f6";
  }

  el.drawerFooter.innerHTML = `<span></span><button class="btn btn-primary" id="save-btn">Guardar</button>`;
  document.getElementById("save-btn").addEventListener("click", () => submitForm(null));
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

  if (!payload.carpeta_id || !payload.lenguaje || !payload.codigo_desarrollo) {
    document.getElementById("form-error").textContent = "Carpeta, Lenguaje y Código son obligatorios.";
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

function openDrawerCreateFolder(defaultClienteId = null, defaultParentId = null) {
  state.drawerMode = "create_folder";
  if (defaultParentId) {
    const parentFolder = findFolder(defaultParentId);
    if (parentFolder) defaultClienteId = parentFolder.cliente_id || parentFolder.cliente;
  }

  el.drawerEyebrow.textContent = "Estructura";
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
        <input id="f-folder-nombre" autofocus />
      </div>
      <div class="field">
        <label for="f-folder-cliente">Cliente</label>
        <select id="f-folder-cliente" disabled style="background-color:#f3f4f6;">${clientOptions}</select>
      </div>
      <p class="error-text" id="folder-form-error"></p>
    </form>
  `;

  el.drawerFooter.innerHTML = `<span></span><button class="btn btn-primary" id="save-folder-btn">Crear carpeta</button>`;

  document.getElementById("save-folder-btn").addEventListener("click", async () => {
    const nombre = document.getElementById("f-folder-nombre").value.trim();
    const cliente_id = document.getElementById("f-folder-cliente").value;

    if (!nombre || !cliente_id) {
      document.getElementById("folder-form-error").textContent = "Nombre obligatorio.";
      return;
    }

    const { error } = await supabase.from("carpetas").insert({
      nombre,
      cliente_id,
      parent_id: defaultParentId || null,
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

function showDrawer() {
  el.drawer.classList.add("open");
  el.drawerBackdrop.classList.add("open");
}

function closeDrawer() {
  el.drawer.classList.remove("open");
  el.drawerBackdrop.classList.remove("open");
  state.drawerMode = null;
}

el.drawerClose.addEventListener("click", closeDrawer);
el.drawerBackdrop.addEventListener("click", closeDrawer);
el.newEntryBtn.addEventListener("click", openDrawerCreate);

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