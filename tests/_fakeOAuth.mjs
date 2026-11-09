// Preload SOLO para tests/test19.mjs: permite ejecutar el login.mjs real con un token endpoint local.
// Se carga con --import DESPUÉS de tests/_noNetwork.mjs, de modo que envuelve al fetch ya vigilado por el guard:
//   node --import ./tests/_noNetwork.mjs --import ./tests/_fakeOAuth.mjs login.mjs
// - El canje a https://secure.soundcloud.com/oauth/token se reescribe a SC_TEST_TOKEN_URL (un HTTP local).
// - /me se responde en local con un usuario falso: solo se usa para mostrar el nombre en la página de éxito.
// Sin SC_TEST_TOKEN_URL no hace nada. No hay ninguna petición a SoundCloud ni a otros servicios.
const tokenUrl = process.env.SC_TEST_TOKEN_URL;
if (tokenUrl) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    let u;
    try {
      u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    } catch {
      return realFetch(input, init);
    }
    if (u.href === "https://secure.soundcloud.com/oauth/token") return realFetch(tokenUrl, init);
    if (u.origin === "https://api.soundcloud.com") return Promise.resolve(Response.json({ username: "tester" }));
    return realFetch(input, init);
  };
}
