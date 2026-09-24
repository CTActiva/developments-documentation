import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Datos públicos del proyecto (la clave publishable está pensada para
// usarse en el navegador; el acceso real lo controlan las políticas
// RLS de la base de datos, no el secreto de esta clave).
const SUPABASE_URL = "https://aiuhvyimkvgrxfkrkfxk.supabase.co";
const SUPABASE_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFpdWh2eWlta3Zncnhma3JrZnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODk3Mzc4MDgsImV4cCI6MjEwNTMxMzgwOH0.wq7cgosbZKwAEWrxU6vwdaZXZJdO9s2cf9uqjv2fUiA";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Redirige a login.html si no hay sesión activa. Se usa al cargar app.html.
export async function requireSession() {
  const { data } = await supabase.auth.getSession();
  if (!data.session) {
    window.location.replace("index.html");
    return null;
  }
  return data.session;
}
