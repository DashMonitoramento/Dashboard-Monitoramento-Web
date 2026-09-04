// Service worker mínimo, só pra habilitar "Instalar app"/"Adicionar à tela inicial" no
// celular do motorista (mesmo padrão do dashboard principal e do Manifesto, ver sw.js deles).
// De propósito NÃO guarda nada em cache -- todo pedido vai direto pra rede, como se não tivesse
// service worker nenhum. Isso evita o risco de um motorista instalar o app e ficar preso numa
// versão antiga depois de uma atualização.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
