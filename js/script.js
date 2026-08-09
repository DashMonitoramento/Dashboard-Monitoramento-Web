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

/* ============================================================
 * AUTENTICAÇÃO (demonstrativa — client-side)
 * ------------------------------------------------------------
 * Este login é apenas uma barreira de interface para a demonstração.
 * Para produção, substitua `fakeAuthenticate()` por uma chamada real
 * (fetch para /api/login, Firebase Auth, Azure AD, etc.). O restante
 * da aplicação só depende de `Auth.getUser()`, então a troca é isolada.
 * ============================================================ */

const Auth = (() => {
  const STORAGE_KEY = 'dashboard_user';

  function getUser() {
    try { return JSON.parse(sessionStorage.getItem(STORAGE_KEY)); }
    catch { return null; }
  }

  function setUser(user) { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(user)); }
  function logout() { sessionStorage.removeItem(STORAGE_KEY); location.reload(); }

  /** Simulação de autenticação. Aceita qualquer usuário/senha não vazios. */
  async function fakeAuthenticate(username, password) {
    await new Promise(r => setTimeout(r, 500)); // simula latência de rede
    if (!username.trim() || !password.trim()) {
      throw new Error('Informe usuário e senha.');
    }
    return { name: username.trim(), loginAt: new Date().toISOString() };
  }

  return { getUser, setUser, logout, fakeAuthenticate };
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

async function loadInitialData() {
  Loading.show('Carregando dados da planilha...');
  try {
    await DataStore.loadFromUrl(DEFAULT_DATA_URL, DEFAULT_DATA_FORMAT);
    await loadBluesoftDataSilently(false);
    await loadClientesDataSilently(false);
    await loadAgendamentosDataSilently(false);
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
  }
}

async function refreshData() {
  Loading.show('Atualizando dados...');
  try {
    await DataStore.loadFromUrl(`${DEFAULT_DATA_URL}?t=${Date.now()}`, DEFAULT_DATA_FORMAT);
    await loadBluesoftDataSilently(true);
    await loadClientesDataSilently(true);
    await loadAgendamentosDataSilently(true);
    Dashboard.renderAll();
    Utils.showToast('Dados atualizados com sucesso.', 'success');
  } catch (err) {
    console.error(err);
    Utils.showToast(err.message || 'Falha ao atualizar os dados.', 'error');
  } finally {
    Loading.hide();
  }
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
 * TELA DE LOGIN
 * ============================================================ */

function initLogin() {
  const overlay = document.getElementById('login-overlay');
  const form = document.getElementById('login-form');
  const errorEl = document.getElementById('login-error');
  const userChip = document.getElementById('current-user');

  const existing = Auth.getUser();
  if (existing) {
    overlay.classList.add('login-overlay--hidden');
    userChip.textContent = existing.name;
    bootstrapApp();
    return;
  }

  overlay.classList.remove('login-overlay--hidden');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errorEl.textContent = '';
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const submitBtn = form.querySelector('button[type="submit"]');

    submitBtn.disabled = true;
    submitBtn.textContent = 'Entrando...';
    try {
      const user = await Auth.fakeAuthenticate(username, password);
      Auth.setUser(user);
      userChip.textContent = user.name;
      overlay.classList.add('login-overlay--hidden');
      bootstrapApp();
    } catch (err) {
      errorEl.textContent = err.message;
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Entrar';
    }
  });

  document.getElementById('btn-logout').addEventListener('click', Auth.logout);
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
