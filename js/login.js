import { supabase } from "./supabase-client.js";

const form = document.getElementById("login-form");
const errorText = document.getElementById("error-text");
const submitBtn = document.getElementById("submit-btn");

// Si ya hay sesión activa, no mostramos el login.
const { data: existing } = await supabase.auth.getSession();
if (existing.session) {
  window.location.replace("app.html");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorText.textContent = "";
  submitBtn.disabled = true;
  submitBtn.textContent = "Entrando…";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    errorText.textContent = "Email o contraseña incorrectos.";
    submitBtn.disabled = false;
    submitBtn.textContent = "Entrar";
    return;
  }

  window.location.replace("app.html");
});
