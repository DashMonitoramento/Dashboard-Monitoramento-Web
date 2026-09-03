/**
 * script.js
 * Bootstrap da aplicação: login (demonstrativo), tema claro/escuro,
 * sidebar retrátil, tela de carregamento, tratamento de erros e
 * carregamento inicial/atualização dos dados.
 *
 * Este é o único módulo que "liga" os demais (Utils, DataStore, Dashboard).
 */
'use strict';

const DEFAULT_DATA_URL = 'assets/data/sample-data.csv';
const DEFAULT_DATA_FORMAT = 'csv';
const DEFAULT_BLUESOFT_URL = 'assets/data/sample-data-bluesoft.csv';
const DEFAULT_CLIENTES_URL = 'assets/data/sample-data-clientes.csv';
const DEFAULT_AGENDAMENTOS_URL = 'assets/data/sample-data-agendamentos.csv';
const DEFAULT_MOTIVOS_URL = 'assets/data/sample-data-motivos.csv';
const DEFAULT_RETORNO_URL = 'assets/data/sample-data-retorno.csv';
const DEFAULT_FATURAMENTO_URL = 'assets/data/sample-data-faturamento.csv';
const DEFAULT_REGIOES_URL = 'assets/data/sample-data-regioes.csv';
const DEFAULT_LEADTIME_URL = 'assets/data/sample-data-leadtime.csv';
const DEFAULT_FERIADOS_URL = 'assets/data/feriados.json';
const DEFAULT_CANHOTOS_URL = 'assets/data/canhotos-index.json';
const DEFAULT_PEDIDOS_NAO_FATURADOS_URL = 'assets/data/sample-data-pedidos-nao-faturados.csv';

/* ============================================================
 * AUTENTICAÇÃO — Firebase Authentication (e-mail/senha)
 * ------------------------------------------------------------
 * window.Firebase (definido em firebase-init.js, um módulo ES separado) expõe as funções
 * reais de cadastro/login/redefinição de senha. Esse módulo só guarda um cache leve do
 * usuário atual para exibição — quem decide se está logado é o próprio Firebase, via
 * onAuthChange, não esse cache.
 * ============================================================ */

const Auth = (() => {
  const STORAGE_KEY = 'dashboard_user';

  function getUser() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)); }
    catch { return null; }
  }

  function setUser(user) { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user)); }
  function clearUser() { sessionStorage.removeItem(STORAGE_KEY); }

  function waitFirebase() {
    if (window.Firebase) return Promise.resolve(window.Firebase);
    return new Promise(resolve => {
      window.addEventListener('firebase-ready', () => resolve(window.Firebase), { once: true });
    });
  }

  /** Chama onAuthChange assim que o Firebase estiver pronto; callback roda a cada mudança. */
  async function onAuthChange(callback) {
    const fb = await waitFirebase();
    return fb.onAuthChange(callback);
  }

  async function login(email, password) {
    const fb = await waitFirebase();
    const credential = await fb.signIn(email.trim(), password);
    const user = {
      name: credential.user.displayName || credential.user.email,
      email: credential.user.email, uid: credential.user.uid, photoURL: getPhoto(credential.user.uid)
    };
    setUser(user);
    return user;
  }

  async function register(nome, email, password) {
    const fb = await waitFirebase();
    const credential = await fb.createUser(email.trim(), password, nome.trim());
    const user = { name: nome.trim(), email: credential.user.email, uid: credential.user.uid, photoURL: null };
    setUser(user);
    return user;
  }

  async function forgotPassword(email) {
    const fb = await waitFirebase();
    await fb.sendPasswordReset(email.trim());
  }

  async function logout() {
    const fb = await waitFirebase();
    await fb.signOutUser();
    clearUser();
  }

  // Foto de perfil guardada no navegador (localStorage), por UID — o Firebase Auth não
  // aceita a imagem em si no campo de foto (só uma URL curta; guardar o data URL nele dá
  // erro "Photo URL too long"). Sem Firebase Storage configurado, isso fica só neste
  // navegador/computador — não sincroniza pra outro dispositivo.
  const PHOTO_KEY_PREFIX = 'dashboard_avatar_';

  function getPhoto(uid) {
    if (!uid) return null;
    try { return localStorage.getItem(PHOTO_KEY_PREFIX + uid); }
    catch { return null; }
  }

  function updatePhoto(photoDataUrl) {
    const user = getUser();
    if (!user || !user.uid) throw new Error('Você precisa estar logado.');
    try { localStorage.setItem(PHOTO_KEY_PREFIX + user.uid, photoDataUrl); }
    catch { throw new Error('Não foi possível salvar a foto (armazenamento local indisponível).'); }
    user.photoURL = photoDataUrl;
    setUser(user);
  }

  /** Traduz os códigos de erro do Firebase Auth pra mensagens em português. */
  function friendlyError(err) {
    const map = {
      'auth/invalid-email': 'E-mail inválido.',
      'auth/user-disabled': 'Esta conta foi desativada.',
      'auth/user-not-found': 'Não encontramos uma conta com esse e-mail.',
      'auth/wrong-password': 'Senha incorreta.',
      'auth/invalid-credential': 'E-mail ou senha incorretos.',
      'auth/email-already-in-use': 'Já existe uma conta com esse e-mail.',
      'auth/weak-password': 'A senha precisa ter pelo menos 6 caracteres.',
      'auth/missing-password': 'Informe a senha.',
      'auth/too-many-requests': 'Muitas tentativas. Aguarde um pouco e tente de novo.',
      'auth/network-request-failed': 'Falha de conexão. Verifique sua internet.'
    };
    return map[err.code] || err.message || 'Ocorreu um erro. Tente novamente.';
  }

  return { getUser, setUser, clearUser, onAuthChange, login, register, forgotPassword, logout, getPhoto, updatePhoto, friendlyError };
})();

/* ============================================================
 * TEMA (claro / escuro)
 * ============================================================ */

const Theme = (() => {
  const STORAGE_KEY = 'dashboard_theme';

  function apply(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(STORAGE_KEY, theme);
    const btn = document.getElementById('btn-theme-toggle');
    if (btn) btn.setAttribute('aria-pressed', theme === 'dark');
  }

  function init() {
    const saved = localStorage.getItem(STORAGE_KEY);
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    apply(saved || (prefersDark ? 'dark' : 'light'));

    document.getElementById('btn-theme-toggle').addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      apply(current === 'dark' ? 'light' : 'dark');
    });
  }

  return { init, apply };
})();

/* ============================================================
 * SIDEBAR RETRÁTIL
 * ============================================================ */

const Sidebar = (() => {
  function init() {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('btn-sidebar-toggle');
    const STORAGE_KEY = 'dashboard_sidebar_collapsed';

    if (localStorage.getItem(STORAGE_KEY) === '1') sidebar.classList.add('sidebar--collapsed');

    btn.addEventListener('click', () => {
      sidebar.classList.toggle('sidebar--collapsed');
      localStorage.setItem(STORAGE_KEY, sidebar.classList.contains('sidebar--collapsed') ? '1' : '0');
    });

    // Em telas pequenas, abre como overlay
    document.getElementById('btn-mobile-menu').addEventListener('click', () => {
      sidebar.classList.toggle('sidebar--open-mobile');
    });
  }
  return { init };
})();

/* ============================================================
 * LOADING OVERLAY
 * ============================================================ */

const Loading = (() => {
  const el = () => document.getElementById('loading-overlay');
  function show(message) {
    const overlay = el();
    overlay.querySelector('.loading-overlay__text').textContent = message || 'Carregando dados...';
    overlay.classList.add('loading-overlay--visible');
  }
  function hide() { el().classList.remove('loading-overlay--visible'); }
  return { show, hide };
})();

/* ============================================================
 * TELA DE BOOT — cobre login + dashboard até o Firebase confirmar a sessão e (se logada) os
 * dados iniciais terminarem de carregar (ver loadInitialData). Visível por padrão no HTML (sem
 * precisar de show() no primeiro carregamento da página); showBootOverlay() só é chamada de
 * novo quando um login recém-enviado dispara Auth.onAuthChange, já que nesse caso o overlay já
 * tinha sido escondido antes (pra revelar a tela de login em si).
 * ============================================================ */
function showBootOverlay() {
  const el = document.getElementById('boot-overlay');
  if (el) el.classList.remove('boot-overlay--hidden');
}
function hideBootOverlay() {
  const el = document.getElementById('boot-overlay');
  if (el) el.classList.add('boot-overlay--hidden');
}

/* ============================================================
 * CARREGAMENTO / ATUALIZAÇÃO DE DADOS
 * ============================================================ */

/** A Base Bluesoft é um reforço opcional — sua ausência não deve impedir o carregamento principal. */
async function loadBluesoftDataSilently(cacheBust) {
  try {
    const url = cacheBust ? `${DEFAULT_BLUESOFT_URL}?t=${Date.now()}` : DEFAULT_BLUESOFT_URL;
    await DataStore.loadBluesoftFromUrl(url, 'csv');
  } catch (err) {
    console.warn('Base Bluesoft não carregada automaticamente:', err.message);
  }
}

/** Tabela Cliente -> Vendedor (Planilha1) — também opcional, só completa o vendedor. */
async function loadClientesDataSilently(cacheBust) {
  try {
    const url = cacheBust ? `${DEFAULT_CLIENTES_URL}?t=${Date.now()}` : DEFAULT_CLIENTES_URL;
    await DataStore.loadClientesFromUrl(url, 'csv');
  } catch (err) {
    console.warn('Tabela de vendedores por cliente não carregada automaticamente:', err.message);
  }
}

/** Planilha de Agendamentos — fonte única da data de agendamento, atualizada manualmente. */
async function loadAgendamentosDataSilently(cacheBust) {
  try {
    const url = cacheBust ? `${DEFAULT_AGENDAMENTOS_URL}?t=${Date.now()}` : DEFAULT_AGENDAMENTOS_URL;
    await DataStore.loadAgendamentosFromUrl(url, 'csv');
  } catch (err) {
    console.warn('Planilha de Agendamentos não carregada automaticamente:', err.message);
  }
}

/** Planilha de Motivos (extraída da Base BI) — opcional e de cobertura parcial; sem ela,
 * os campos de motivo simplesmente ficam vazios. */
async function loadMotivosDataSilently(cacheBust) {
  try {
    const url = cacheBust ? `${DEFAULT_MOTIVOS_URL}?t=${Date.now()}` : DEFAULT_MOTIVOS_URL;
    await DataStore.loadMotivosFromUrl(url, 'csv');
  } catch (err) {
    console.warn('Planilha de Motivos não carregada automaticamente:', err.message);
  }
}

/** Aba RETORNO (prazo de entrega em dias + tipo de transporte) — opcional; sem ela, o campo
 * Prazo fica "Sem informação" e o filtro de Tipo de transporte fica vazio, sem quebrar o resto. */
async function loadRetornoDataSilently(cacheBust) {
  try {
    const url = cacheBust ? `${DEFAULT_RETORNO_URL}?t=${Date.now()}` : DEFAULT_RETORNO_URL;
    await DataStore.loadRetornoFromUrl(url, 'csv');
  } catch (err) {
    console.warn('Aba RETORNO não carregada automaticamente:', err.message);
  }
}

/** Data de Faturamento por NF (aba "Base BI") — opcional; sem ela, o filtro de Período/Mês/Ano
 * cai pra Data de Coleta (comportamento de antes de 2026-08-17), sem quebrar o resto. */
async function loadFaturamentoDataSilently(cacheBust) {
  try {
    const url = cacheBust ? `${DEFAULT_FATURAMENTO_URL}?t=${Date.now()}` : DEFAULT_FATURAMENTO_URL;
    await DataStore.loadFaturamentoFromUrl(url, 'csv');
  } catch (err) {
    console.warn('Data de Faturamento (Base BI) não carregada automaticamente:', err.message);
  }
}

/** Cadastro cidade -> região comercial (mesma fonte do Dashboard Logístico por Região) —
 * opcional; sem ele, o filtro "Região Comercial" da barra lateral simplesmente fica vazio. */
async function loadRegioesDataSilently(cacheBust) {
  try {
    const url = cacheBust ? `${DEFAULT_REGIOES_URL}?t=${Date.now()}` : DEFAULT_REGIOES_URL;
    await DataStore.loadRegioesFromUrl(url, 'csv');
  } catch (err) {
    console.warn('Cadastro de Região Comercial não carregado automaticamente:', err.message);
  }
}

/** Prazo esperado (dias úteis) por Transportadora + Cidade, aba "Lead Time Atualizado" — usado
 * só como comparativo no relatório de Lead Time ("Análise por Região"); sem ele, o relatório
 * mostra só a média real, sem a linha de referência. */
async function loadLeadTimeDataSilently(cacheBust) {
  try {
    const url = cacheBust ? `${DEFAULT_LEADTIME_URL}?t=${Date.now()}` : DEFAULT_LEADTIME_URL;
    await DataStore.loadLeadTimeFromUrl(url, 'csv');
  } catch (err) {
    console.warn('Lead Time Atualizado não carregado automaticamente:', err.message);
  }
}

/** Feriados (painel "Lead Time de Pedidos e Entregas") — opcional; sem ele, os cálculos de
 * dias úteis continuam funcionando, só sem excluir feriados (pulam só sábado/domingo). */
async function loadFeriadosDataSilently(cacheBust) {
  try {
    const url = cacheBust ? `${DEFAULT_FERIADOS_URL}?t=${Date.now()}` : DEFAULT_FERIADOS_URL;
    await DataStore.loadFeriadosFromUrl(url);
  } catch (err) {
    console.warn('Tabela de feriados não carregada automaticamente:', err.message);
  }
}

/** Aba nova (2026-08-27) — pedidos ainda não faturados, alimenta só o card "Pedidos
 * Aguardando Faturamento" no gráfico "Situação de agendamento". */
async function loadPedidosNaoFaturadosDataSilently(cacheBust) {
  try {
    const url = cacheBust ? `${DEFAULT_PEDIDOS_NAO_FATURADOS_URL}?t=${Date.now()}` : DEFAULT_PEDIDOS_NAO_FATURADOS_URL;
    await DataStore.loadPedidosNaoFaturadosFromUrl(url);
  } catch (err) {
    console.warn('Pedidos não faturados não carregados automaticamente:', err.message);
  }
}

/** Índice de canhotos (gerado localmente por scripts/gerar-indice-canhotos.ps1) — opcional,
 * sem ele o clique na NF só mostra "Sem Canhoto" pra tudo. */
async function loadCanhotosIndexSilently(cacheBust) {
  const url = cacheBust ? `${DEFAULT_CANHOTOS_URL}?t=${Date.now()}` : DEFAULT_CANHOTOS_URL;
  await Dashboard.loadCanhotosIndex(url);
}

/** Espera window.Firebase existir (ver firebase-init.js) — mesma lógica do waitFirebase()
 * privado dentro de Auth, mas essa função precisa dela fora daquele módulo. */
function waitFirebaseReady() {
  if (window.Firebase) return Promise.resolve(window.Firebase);
  return new Promise(resolve => {
    window.addEventListener('firebase-ready', () => resolve(window.Firebase), { once: true });
  });
}

/** Data/status de agendamento preenchidos manualmente no site (Firestore) — substitui a
 * planilha de Agendamentos pra essas duas informações. Opcional: sem o Firestore disponível,
 * o dashboard segue funcionando normalmente, só sem essa camada extra. */
async function loadAgendamentosManuaisSilently() {
  try {
    const fb = await waitFirebaseReady();
    const porNf = await fb.getAgendamentosManuais();
    DataStore.applyAgendamentoManual(porNf);
  } catch (err) {
    console.warn('Agendamentos manuais (Firestore) não carregados:', err.message);
  }
}

/** Verifica se o usuário logado tem permissão de editar agendamento (super admin sempre
 * tem; os demais, só se o super admin habilitou pelo modal "Gerenciar usuários") e repassa
 * pro Dashboard, que decide se mostra os controles de edição na tela "Aguardando agendamento". */
async function loadPermissaoEdicaoAgendamentoSilently() {
  try {
    const fb = await waitFirebaseReady();
    const pode = await fb.getMinhaPermissaoEdicaoAgendamento();
    Dashboard.setPermissaoEdicaoAgendamento(pode);
  } catch (err) {
    console.warn('Permissão de edição de agendamento não verificada:', err.message);
  }
}

/** Dispara todas as buscas de CSV/JSON em PARALELO, só pra esquentar o cache HTTP do
 * navegador — a cadeia abaixo continua buscando e processando cada fonte na mesma ordem
 * sequencial de sempre (não muda nenhuma lógica de enriquecimento/dependência entre elas),
 * só que quando ela pedir uma URL que essa função já disparou, o navegador serve do cache
 * (ou reaproveita a mesma requisição em andamento) em vez de esperar a rede de novo. Decisão
 * do usuário (2026-08-26): login/carregamento inicial demorava muito porque essas ~9 fontes
 * eram buscadas uma de cada vez — só a Base Bluesoft já tem ~20MB. Erros aqui são ignorados
 * de propósito: se uma falhar, a cadeia sequencial abaixo tenta de novo do jeito normal (cada
 * loadXDataSilently já tem seu próprio try/catch). */
function prefetchTodasAsFontes() {
  [
    DEFAULT_BLUESOFT_URL, DEFAULT_CLIENTES_URL, DEFAULT_AGENDAMENTOS_URL, DEFAULT_MOTIVOS_URL,
    DEFAULT_RETORNO_URL, DEFAULT_FATURAMENTO_URL, DEFAULT_REGIOES_URL, DEFAULT_LEADTIME_URL,
    DEFAULT_FERIADOS_URL, DEFAULT_CANHOTOS_URL, DEFAULT_PEDIDOS_NAO_FATURADOS_URL,
  ].forEach(url => { fetch(url).catch(() => {}); });
}

async function loadInitialData() {
  Loading.show('Carregando dados da planilha...');
  prefetchTodasAsFontes();
  try {
    await DataStore.loadFromUrl(DEFAULT_DATA_URL, DEFAULT_DATA_FORMAT);
    await loadBluesoftDataSilently(false);
    await loadClientesDataSilently(false);
    await loadAgendamentosDataSilently(false);
    await loadMotivosDataSilently(false);
    await loadRetornoDataSilently(false);
    await loadFaturamentoDataSilently(false);
    await loadRegioesDataSilently(false);
    await loadLeadTimeDataSilently(false);
    await loadFeriadosDataSilently(false);
    await loadPedidosNaoFaturadosDataSilently(false);
    // Índice de canhotos (~20MB) NÃO entra no await — não alimenta nenhum registro/gráfico/KPI,
    // só o Map usado quando ela clica numa NF pra abrir o comprovante (ver Dashboard.loadCanhotosIndex/
    // canhotosIndex). Bloquear o carregamento inteiro por causa dele só atrasava a tela aparecer
    // sem nenhum ganho — decisão do usuário (2026-08-27, "está demorando pra carregar"). Carrega
    // em paralelo, por fora; o botão de canhoto só fica disponível assim que terminar (raramente
    // é a primeira coisa que ela clica).
    loadCanhotosIndexSilently(false);
    await loadAgendamentosManuaisSilently();
    await loadPermissaoEdicaoAgendamentoSilently();
    Dashboard.renderAll();
    Utils.showToast(`${DataStore.getRecords().length} registros carregados com sucesso.`, 'success');
  } catch (err) {
    console.error(err);
    Utils.showToast(
      'Não foi possível carregar os dados automaticamente. Confira se o arquivo "sample-data.csv" está na pasta assets/data, ou arraste um arquivo para a tela.',
      'warning',
      7000
    );
  } finally {
    Loading.hide();
    // Só agora (dados carregados OU erro tratado — nunca deixa preso num spinner pra sempre) o
    // dashboard de verdade fica visível, direto com os números finais, sem o "piscar" de valores
    // mudando conforme cada fonte terminava de carregar (pedido do usuário, 2026-08-29).
    hideBootOverlay();
  }
}

/** "Atualizar dados" força uma navegação de página nova de verdade (mesma coisa que o botão
 * de atualizar do próprio navegador, que ela confirmou sempre funcionar) em vez de só re-buscar
 * os CSVs em memória via fetch — a versão anterior (fetch com cache:'no-store' + `?t=`) já
 * buscava os arquivos certos, mas se a aba ficou aberta desde ANTES do deploy mais recente do
 * próprio dashboard.js/script.js, ela continuava rodando o código JS antigo (só um reload de
 * página real busca o `index.html`/scripts atuais) — o clique nunca refletia correções de
 * código publicadas depois que a aba foi aberta, só os dados. Um `?_r=` novo a cada clique
 * garante que o navegador (e o CDN do GitHub Pages) tratem como uma URL nunca vista, sem
 * depender de revalidação condicional. O login (sessionStorage) sobrevive ao reload.
 */
function refreshData() {
  const url = new URL(window.location.href);
  url.searchParams.set('_r', Date.now());
  window.location.href = url.toString();
}

async function loadDataFromFile(file) {
  Loading.show(`Lendo "${file.name}"...`);
  try {
    await DataStore.loadFromFile(file);
    Dashboard.renderAll();
    Utils.showToast(`${DataStore.getRecords().length} registros carregados de "${file.name}".`, 'success');
  } catch (err) {
    console.error(err);
    Utils.showToast(err.message || 'Falha ao ler o arquivo selecionado.', 'error', 7000);
  } finally {
    Loading.hide();
  }
}

function bindDataControls() {
  document.getElementById('btn-refresh-data').addEventListener('click', refreshData);

  // Upload manual removido dos botões da barra lateral (agora os 4 arquivos são só
  // apontados por nome — a atualização é sempre por sobrescrever o arquivo na pasta).
  // Arrastar um arquivo pro app ainda funciona como atalho pra testar a base principal.
  const dropzone = document.getElementById('app');
  ['dragover', 'dragenter'].forEach(evt => dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    document.body.classList.add('is-dragging-file');
  }));
  ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    document.body.classList.remove('is-dragging-file');
  }));
  dropzone.addEventListener('drop', (e) => {
    const file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadDataFromFile(file);
  });
}

/* ============================================================
 * GERENCIAR USUÁRIOS (modal, só visível pro super admin)
 * ------------------------------------------------------------
 * Lista os usuários cadastrados (Firestore, coleção "users") e deixa o super admin marcar
 * quem mais, além dele, pode editar a data/status de agendamento manual. O toggle salva na
 * hora (sem botão "Salvar" separado) — mais rápido pra uma ação tão simples.
 * ============================================================ */

function escapeAttrLocal(str) {
  return String(str).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function bindGerenciarUsuarios() {
  const btnAbrir = document.getElementById('btn-gerenciar-usuarios');
  const modal = document.getElementById('modal-usuarios');
  const btnFechar = document.getElementById('btn-fechar-modal-usuarios');
  const lista = document.getElementById('lista-usuarios');
  if (!btnAbrir || !modal) return;

  function renderListaUsuarios(usuarios) {
    if (!usuarios.length) {
      lista.innerHTML = '<p class="usuarios-lista__vazio">Nenhum usuário cadastrado ainda.</p>';
      return;
    }
    lista.innerHTML = usuarios.map(u => {
      const ehSuperAdmin = Dashboard.isSuperAdminEmailAgendamento(u.email);
      const marcadoAgendamento = ehSuperAdmin || u.podeEditarAgendamento;
      const marcadoManifesto = ehSuperAdmin || u.podeEditarManifesto;
      return `<div class="usuario-row${ehSuperAdmin ? ' usuario-row--super-admin' : ''}" data-uid="${escapeAttrLocal(u.uid)}">
        <div>
          <div class="usuario-row__nome">${escapeAttrLocal(u.nome)}</div>
          <div class="usuario-row__email">${escapeAttrLocal(u.email)}</div>
        </div>
        <div class="usuario-row__toggles">
          <label class="usuario-row__toggle">
            <input type="checkbox" class="usuario-row__checkbox" data-permissao="agendamento" ${marcadoAgendamento ? 'checked' : ''} ${ehSuperAdmin ? 'disabled' : ''}>
            Pode editar agendamentos
          </label>
          <label class="usuario-row__toggle">
            <input type="checkbox" class="usuario-row__checkbox" data-permissao="manifesto" ${marcadoManifesto ? 'checked' : ''} ${ehSuperAdmin ? 'disabled' : ''}>
            Pode editar o Manifesto
          </label>
        </div>
      </div>`;
    }).join('');
  }

  async function abrirModal() {
    modal.hidden = false;
    lista.innerHTML = '<p class="usuarios-lista__carregando">Carregando usuários...</p>';
    try {
      const fb = await waitFirebaseReady();
      const usuarios = await fb.getUsuarios();
      renderListaUsuarios(usuarios);
    } catch (err) {
      console.error(err);
      lista.innerHTML = `<p class="usuarios-lista__vazio">Não foi possível carregar os usuários: ${escapeAttrLocal(err.message || err)}</p>`;
    }
  }

  btnAbrir.addEventListener('click', abrirModal);
  btnFechar.addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });

  lista.addEventListener('change', async (e) => {
    const checkbox = e.target.closest('.usuario-row__checkbox');
    if (!checkbox) return;
    const linha = checkbox.closest('.usuario-row');
    const uid = linha.dataset.uid;
    const pode = checkbox.checked;
    const permissao = checkbox.dataset.permissao; // 'agendamento' ou 'manifesto'
    checkbox.disabled = true;
    try {
      const fb = await waitFirebaseReady();
      if (permissao === 'manifesto') {
        await fb.definirPermissaoEdicaoManifesto(uid, pode);
        Utils.showToast(pode ? 'Usuário habilitado a editar o Manifesto.' : 'Edição do Manifesto removida desse usuário.', 'success', 2500);
      } else {
        await fb.definirPermissaoEdicaoAgendamento(uid, pode);
        Utils.showToast(pode ? 'Usuário habilitado a editar agendamentos.' : 'Edição de agendamento removida desse usuário.', 'success', 2500);
      }
    } catch (err) {
      console.error(err);
      checkbox.checked = !pode; // reverte, já que a gravação falhou
      Utils.showToast(err.message || 'Falha ao atualizar a permissão do usuário.', 'error', 5000);
    } finally {
      checkbox.disabled = false;
    }
  });
}

/* ============================================================
 * TRATAMENTO GLOBAL DE ERROS (mensagens amigáveis)
 * ============================================================ */

function bindGlobalErrorHandlers() {
  // Aviso benigno do navegador, sem impacto funcional — não deve gerar toast de erro.
  const isBenignResizeWarning = (msg) => typeof msg === 'string' && msg.includes('ResizeObserver loop');

  window.addEventListener('error', (e) => {
    const message = e.error?.message || e.message;
    if (isBenignResizeWarning(message)) return;
    console.error('Erro não tratado:', e.error || e.message);
    Utils.showToast('Ocorreu um erro inesperado. Verifique o console para mais detalhes.', 'error');
  });
  window.addEventListener('unhandledrejection', (e) => {
    if (isBenignResizeWarning(e.reason?.message)) return;
    console.error('Promessa rejeitada:', e.reason);
    Utils.showToast(e.reason?.message || 'Ocorreu um erro inesperado ao processar os dados.', 'error');
  });
}

/* ============================================================
 * FOTO DE PERFIL
 * ============================================================ */

/** Mostra a foto (se houver) no avatarzinho do cabeçalho, ou volta pro emoji padrão. */
function renderAvatar(photoURL) {
  const avatarBtn = document.getElementById('btn-change-avatar');
  if (!avatarBtn) return;
  avatarBtn.innerHTML = photoURL ? `<img src="${photoURL}" alt="Foto de perfil">` : '👤';
}

/** Lê o arquivo escolhido, recorta ao quadrado central e reduz pra um data URL pequeno. */
function resizeImageToDataUrl(file, maxSize) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Não foi possível ler a imagem.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Arquivo de imagem inválido.'));
      img.onload = () => {
        const side = Math.min(img.width, img.height);
        const canvas = document.createElement('canvas');
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, maxSize, maxSize);
        resolve(canvas.toDataURL('image/jpeg', 0.75));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function initProfilePhoto() {
  const avatarBtn = document.getElementById('btn-change-avatar');
  const fileInput = document.getElementById('avatar-file-input');
  if (!avatarBtn || !fileInput) return;

  const cached = Auth.getUser();
  if (cached && cached.photoURL) renderAvatar(cached.photoURL);

  avatarBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    fileInput.value = '';
    if (!file) return;
    try {
      const dataUrl = await resizeImageToDataUrl(file, 128);
      await Auth.updatePhoto(dataUrl);
      renderAvatar(dataUrl);
      Utils.showToast('Foto de perfil atualizada.', 'success');
    } catch (err) {
      console.error(err);
      Utils.showToast('Não foi possível atualizar a foto de perfil.', 'error');
    }
  });
}

/* ============================================================
 * TELA DE LOGIN
 * ============================================================ */

function initLogin() {
  const overlay = document.getElementById('login-overlay');
  const userChip = document.getElementById('current-user');

  document.querySelectorAll('.login-field__toggle-visibility').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target);
      const isHidden = input.type === 'password';
      input.type = isHidden ? 'text' : 'password';
      btn.textContent = isHidden ? '🙈' : '👁️';
      btn.setAttribute('aria-label', isHidden ? 'Ocultar senha' : 'Mostrar senha');
    });
  });

  const views = {
    login: document.getElementById('auth-view-login'),
    register: document.getElementById('auth-view-register'),
    forgot: document.getElementById('auth-view-forgot')
  };
  function showView(name) {
    Object.entries(views).forEach(([key, el]) => { el.hidden = key !== name; });
  }

  document.getElementById('link-forgot-password').addEventListener('click', (e) => { e.preventDefault(); showView('forgot'); });
  document.getElementById('link-show-register').addEventListener('click', (e) => { e.preventDefault(); showView('register'); });
  document.getElementById('link-show-login-from-register').addEventListener('click', (e) => { e.preventDefault(); showView('login'); });
  document.getElementById('link-show-login-from-forgot').addEventListener('click', (e) => { e.preventDefault(); showView('login'); });

  /** Amarra um formulário de auth: desabilita o botão durante a chamada e mostra erro amigável. */
  function bindAuthForm(formId, errorId, loadingLabel, idleLabel, action) {
    const form = document.getElementById(formId);
    const errorEl = document.getElementById(errorId);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.textContent = '';
      const btn = form.querySelector('button[type="submit"]');
      btn.disabled = true;
      btn.textContent = loadingLabel;
      try {
        await action(form);
      } catch (err) {
        console.error(err);
        errorEl.textContent = Auth.friendlyError(err);
      } finally {
        btn.disabled = false;
        btn.textContent = idleLabel;
      }
    });
  }

  bindAuthForm('login-form', 'login-error', 'Entrando...', 'Entrar', async () => {
    await Auth.login(
      document.getElementById('login-email').value,
      document.getElementById('login-password').value
    );
    // Auth.onAuthChange (abaixo) cuida de esconder o overlay e iniciar o app.
  });

  bindAuthForm('register-form', 'register-error', 'Criando conta...', 'Criar conta', async () => {
    const user = await Auth.register(
      document.getElementById('register-nome').value,
      document.getElementById('register-email').value,
      document.getElementById('register-password').value
    );
    // O onAuthChange dispara antes do nome (updateProfile) terminar de gravar no Firebase e
    // mostra o e-mail por engano — corrige aqui direto com o nome que a pessoa acabou de digitar.
    userChip.textContent = user.name;
  });

  bindAuthForm('forgot-form', 'forgot-error', 'Enviando...', 'Enviar link de redefinição', async (form) => {
    const successEl = document.getElementById('forgot-success');
    successEl.hidden = true;
    await Auth.forgotPassword(document.getElementById('forgot-email').value);
    successEl.textContent = 'Link enviado! Confira sua caixa de entrada (e o spam).';
    successEl.hidden = false;
    form.reset();
  });

  document.getElementById('btn-logout').addEventListener('click', async () => {
    await Auth.logout();
    location.reload();
  });

  // Fonte da verdade de "está logado ou não": o próprio Firebase, não um cache local.
  Auth.onAuthChange((fbUser) => {
    if (fbUser) {
      const user = { name: fbUser.displayName || fbUser.email, email: fbUser.email, uid: fbUser.uid, photoURL: Auth.getPhoto(fbUser.uid) };
      Auth.setUser(user);
      userChip.textContent = user.name;
      renderAvatar(user.photoURL);
      const btnGerenciarUsuarios = document.getElementById('btn-gerenciar-usuarios');
      if (btnGerenciarUsuarios) btnGerenciarUsuarios.hidden = !Dashboard.isSuperAdminAgendamento();
      overlay.classList.add('login-overlay--hidden');
      // #boot-overlay continua visível (já está, por padrão, ao carregar a página; reforça aqui
      // pro caso de vir de um login recém-enviado, não de uma sessão já salva) até os dados
      // iniciais terminarem de carregar — ver hideBootOverlay() em loadInitialData().
      showBootOverlay();
      bootstrapApp();
    } else {
      Auth.clearUser();
      showView('login');
      overlay.classList.remove('login-overlay--hidden');
      hideBootOverlay();
    }
  });
}

/* ============================================================
 * BOOTSTRAP
 * ============================================================ */

let appBootstrapped = false;

function bootstrapApp() {
  if (appBootstrapped) return;
  appBootstrapped = true;

  Dashboard.init();
  bindDataControls();
  bindGerenciarUsuarios();
  initProfilePhoto();
  loadInitialData();

  setInterval(() => {
    const el = document.getElementById('clock');
    if (el) el.textContent = Utils.formatDateTime(new Date());
  }, 1000);
}

document.addEventListener('DOMContentLoaded', () => {
  Theme.init();
  Sidebar.init();
  bindGlobalErrorHandlers();
  initLogin();
});
