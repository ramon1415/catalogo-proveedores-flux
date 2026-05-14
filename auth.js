const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
document.getElementById("googleLoginBtn").addEventListener("click", async () => {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}/proveedores.html` },
  })
  if (error) alert(`Error iniciando sesión: ${error.message}`)
})
