/* =====================================================================
   SERVICE WORKER — RecebeMais
   Faz cache do "app shell" (o index.html e as bibliotecas externas que
   ele carrega) para o app abrir e funcionar sem internet quando
   empacotado como APK (Capacitor/WebView).

   IMPORTANTE: este service worker NUNCA intercepta chamadas de dados do
   Firebase (login, Firestore). Essas continuam indo direto para a rede.
   Se não houver internet, é o próprio app (via onAuthStateChanged /
   listener do Firestore) que trata a ausência de dados — o service
   worker só cuida dos ARQUIVOS do app, não dos dados.
   ===================================================================== */

// Suba este número sempre que publicar uma nova versão do index.html —
// isso força os dispositivos a baixarem a versão nova em vez de ficarem
// presos numa versão antiga em cache.
const CACHE_VERSION = "v1";
const CACHE_NAME = `recebemais-${CACHE_VERSION}`;

// Arquivos do próprio app (mesma origem) — sempre cacheados.
const APP_SHELL = [
  "./",
  "./index.html",
];

// Bibliotecas externas usadas pelo app (CDN). Cacheá-las também é
// importante: sem isso, o app até abre offline, mas o Firebase (SDK)
// não carrega na primeira vez sem internet.
const EXTERNAL_ASSETS = [
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore-compat.js",
  "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth-compat.js",
];

// Domínios de API do Firebase — NUNCA cachear. Essas chamadas carregam
// dados (login, documentos do Firestore) e precisam sempre ir para a
// rede real; cachear resposta antiga aqui seria mostrar dado errado.
const NUNCA_CACHEAR = [
  "googleapis.com",
  "google.com",
  "gstatic.com/firebasejs" // as .js acima são exceção (cacheadas acima); isto cobre outras chamadas do mesmo host
];

/* ───────────────────────── INSTALL ───────────────────────── */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([...APP_SHELL, ...EXTERNAL_ASSETS]).catch((err) => {
        // Se alguma lib externa falhar ao cachear (ex.: instalação sem
        // internet), não trava o service worker inteiro por isso.
        console.warn("SW: falha ao pré-cachear algum recurso:", err);
      });
    })
  );
  self.skipWaiting();
});

/* ───────────────────────── ACTIVATE ───────────────────────── */
// Remove caches de versões antigas quando uma nova versão é publicada.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key.startsWith("recebemais-") && key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

/* ───────────────────────── FETCH ───────────────────────── */
self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Só intercepta GET. POST/PUT/etc (ex.: gravações no Firestore) vão
  // direto para a rede, sem passar pelo cache.
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Chamadas de dados do Firebase (login, Firestore, etc.) — nunca
  // cachear, sempre rede. Deixa o request seguir normalmente (não
  // chama event.respondWith): assim, se não houver internet, o erro
  // chega até o próprio app, que já sabe mostrar o aviso "Sem conexão".
  const ehApiDeDados =
    url.hostname.endsWith("googleapis.com") ||
    (url.hostname === "www.gstatic.com" && !EXTERNAL_ASSETS.includes(request.url));
  if (ehApiDeDados) return;

  // App shell + bibliotecas: cache-first, com atualização em segundo
  // plano (stale-while-revalidate) — abre instantâneo mesmo offline, e
  // atualiza sozinho quando há internet.
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchAndUpdate = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached); // offline: cai para o que já está em cache

      return cached || fetchAndUpdate;
    })
  );
});
