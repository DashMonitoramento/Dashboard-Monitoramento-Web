// Service worker mínimo, só pra habilitar "Instalar app"/"Adicionar à tela inicial" no
// Android/Chrome (Manifesto tem o seu próprio, em manifesto/sw.js). De propósito NÃO guarda
// nada em cache -- todo pedido vai direto pra rede, como se não tivesse service worker nenhum.
// Isso evita o risco de alguém instalar o app e ficar preso numa versão antiga depois de uma
// atualização, já que o site é atualizado com frequência.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
