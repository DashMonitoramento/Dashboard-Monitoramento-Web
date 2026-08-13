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
const DEFAULT_CANHOTOS_URL = 'assets/data/canhotos-index.json';

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

/** Índice de canhotos (gerado localmente por scripts/gerar-indice-canhotos.ps1) — opcional,
 * sem ele o clique na NF só mostra "Sem Canhoto" pra tudo. */
async function loadCanhotosIndexSilently(cacheBust) {
  const url = cacheBust ? `${DEFAULT_CANHOTOS_URL}?t=${Date.now()}` : DEFAULT_CANHOTOS_URL;
  await Dashboard.loadCanhotosIndex(url);
}

async function loadInitialData() {
  Loading.show('Carregando dados da planilha...');
  try {
    await DataStore.loadFromUrl(DEFAULT_DATA_URL, DEFAULT_DATA_FORMAT);
    await loadBluesoftDataSilently(false);
    await loadClientesDataSilently(false);
    await loadAgendamentosDataSilently(false);
    await loadMotivosDataSilently(false);
    await loadCanhotosIndexSilently(false);
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
    await loadMotivosDataSilently(true);
    await loadCanhotosIndexSilently(true);
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
      overlay.classList.add('login-overlay--hidden');
      bootstrapApp();
    } else {
      Auth.clearUser();
      showView('login');
      overlay.classList.remove('login-overlay--hidden');
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
