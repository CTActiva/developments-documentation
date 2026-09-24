import { supabase, requireSession, avatarHtml } from "./supabase-client.js";

const el = {
  avatarPreview: document.getElementById("avatar-preview"),
  avatarInput: document.getElementById("avatar-input"),
  nombre: document.getElementById("f-nombre"),
  apellidos: document.getElementById("f-apellidos"),
  rol: document.getElementById("f-rol"),
  email: document.getElementById("f-email"),
  form: document.getElementById("profile-form"),
  status: document.getElementById("status-text"),
  saveBtn: document.getElementById("save-btn"),
};

let session;
let perfil = null;
let pendingFile = null;

(async function init() {
  session = await requireSession();
  if (!session) return;

  const { data } = await supabase.from("perfiles").select("*").eq("id", session.user.id).single();
  perfil = data || { id: session.user.id };

  el.email.value = session.user.email;
  el.nombre.value = perfil.nombre || "";
  el.apellidos.value = perfil.apellidos || "";
  el.rol.value = perfil.rol || "";
  el.avatarPreview.innerHTML = avatarHtml(perfil, "avatar-lg");
})();

el.avatarInput.addEventListener("change", () => {
  const file = el.avatarInput.files[0];
  if (!file) return;
  pendingFile = file;
  const reader = new FileReader();
  reader.onload = () => {
    el.avatarPreview.innerHTML = `<img class="avatar-lg" src="${reader.result}" alt="" />`;
  };
  reader.readAsDataURL(file);
});

el.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  el.status.style.color = "";
  el.status.textContent = "";
  el.saveBtn.disabled = true;
  el.saveBtn.textContent = "Guardando…";

  let avatarUrl = perfil.avatar_url || null;

  if (pendingFile) {
    const ext = pendingFile.name.split(".").pop();
    const path = `${session.user.id}/avatar.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("avatars")
      .upload(path, pendingFile, { upsert: true });

    if (uploadError) {
      el.status.style.color = "var(--danger)";
      el.status.textContent = uploadError.message;
      el.saveBtn.disabled = false;
      el.saveBtn.textContent = "Guardar cambios";
      return;
    }
    avatarUrl = supabase.storage.from("avatars").getPublicUrl(path).data.publicUrl;
  }

  const { error } = await supabase.from("perfiles").upsert({
    id: session.user.id,
    nombre: el.nombre.value.trim() || null,
    apellidos: el.apellidos.value.trim() || null,
    rol: el.rol.value.trim() || null,
    avatar_url: avatarUrl,
    updated_at: new Date().toISOString(),
  });

  el.saveBtn.disabled = false;
  el.saveBtn.textContent = "Guardar cambios";

  if (error) {
    el.status.style.color = "var(--danger)";
    el.status.textContent = error.message;
    return;
  }

  perfil = { ...perfil, avatar_url: avatarUrl };
  pendingFile = null;
  el.status.style.color = "var(--accent)";
  el.status.textContent = "Guardado.";
});
