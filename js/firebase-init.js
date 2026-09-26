/**
 * firebase-init.js
 * Inicializa o Firebase (Authentication + Firestore) e expõe um objeto simples em
 * window.Firebase para o resto do app (script.js) usar — o app em si é feito de scripts
 * clássicos (sem bundler), então esse é o único arquivo que usa import de módulo ES.
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendPasswordResetEmail,
  signOut,
  onAuthStateChanged,
  updateProfile,
  setPersistence,
  browserSessionPersistence
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  collection,
  getDocs,
  onSnapshot,
  writeBatch,
  query,
  orderBy,
  limit
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyBjNQAQOahpl3Wy6zWiWcnUHgTmJTAUnVE",
  authDomain: "dashboard-terrinha.firebaseapp.com",
  projectId: "dashboard-terrinha",
  storageBucket: "dashboard-terrinha.firebasestorage.app",
  messagingSenderId: "246670092939",
  appId: "1:246670092939:web:56ba5649779ff3378ac28e",
  measurementId: "G-0XK76RER2E"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
// Cache local persistente (2026-09-15) -- sem isso, cada F5/recarregamento relia do zero TODA
// coleção assinada por onSnapshot (Controle de Cargas, etc.), mesmo sem nada ter mudado desde a
// última visita. Isso estourou a cota gratuita diária do Firestore (50 mil leituras) sozinho,
// com uso normal. Com o cache, o app reaproveita o que já baixou no aparelho e só lê do servidor
// o que realmente mudou. Mesmo fix aplicado em motoristas/index.html e Manifesto/index.html.
const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

// Atualizar a página (F5) NÃO deve pedir login de novo se ela já estava logada — pedido do
// usuário (2026-08-27), substitui a decisão anterior (2026-08-1x, inMemoryPersistence) de
// nunca entrar sozinha, que forçava login em TODO recarregamento. browserSessionPersistence
// é o meio-termo: sobrevive a um F5/recarregamento normal (sessionStorage da aba), mas ainda
// tem um limite natural — fechar a aba ou o navegador encerra a sessão, exigindo login de
// novo na próxima vez (diferente de browserLocalPersistence, que ficaria logada mesmo depois
// de fechar o navegador inteiro).
setPersistence(auth, browserSessionPersistence)
  .catch(err => console.warn('Falha ao configurar persistência do login (login ainda funciona normalmente):', err.code || err.message));

/** Cria a conta no Authentication, define o nome e grava um perfil básico no Firestore. */
async function createUser(email, password, nome) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { displayName: nome });
  // Gravação do perfil no Firestore é "melhor esforço": roda em segundo plano, sem `await`,
  // pra nunca travar o cadastro se o Firestore ainda não estiver criado/configurado.
  setDoc(doc(db, 'users', credential.user.uid), {
    nome,
    email,
    criadoEm: serverTimestamp(),
    podeEditarAgendamento: false,
    podeEditarManifesto: false,
    podeEditarCargas: false,
    podeGerenciarDisponibilidade: false
  }).catch(e => console.warn('Perfil não salvo no Firestore (login funciona normalmente):', e.code || e.message));
  return credential;
}

function signIn(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

function signOutUser() {
  return signOut(auth);
}

function sendPasswordReset(email) {
  return sendPasswordResetEmail(auth, email);
}

/** Dispara imediatamente com o usuário atual (ou null) e de novo a cada login/logout. */
function onAuthChange(callback) {
  return onAuthStateChanged(auth, callback);
}

/** Reparo automático (2026-09-15, bug real achado: usuário "Ayrton Costa" conseguia logar mas
 * nunca aparecia em "Gerenciar Usuários"). Causa: a regra do Firestore pra `users/{userId}`
 * restringia TODA escrita ao super admin — inclusive a gravação do PRÓPRIO cadastro em
 * createUser() (acima), que é sempre feita pelo usuário recém-criado, nunca pelo super admin.
 * Ou seja, o perfil em `users/{uid}` NUNCA era gravado de verdade pra ninguém que se
 * cadastrasse (o catch silencioso escondia isso) — o login (Authentication) funciona
 * independente disso, só o perfil (nome/permissões, usado por "Gerenciar Usuários") que ficava
 * sempre faltando. Corrigido a regra pra permitir `create` do PRÓPRIO doc (uid batendo, sempre
 * com as 4 permissões em false — impede autopromoção), mas isso só resolve daqui pra frente;
 * quem já tinha conta (como o Ayrton) continua sem o doc. Esta função roda em TODO login bem-
 * sucedido (script.js) — cria o doc que falta com as permissões padrão, sem sobrescrever nada
 * se já existir. */
async function garantirPerfilUsuario() {
  const usuario = auth.currentUser;
  if (!usuario) return;
  try {
    const ref = doc(db, 'users', usuario.uid);
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    await setDoc(ref, {
      nome: usuario.displayName || usuario.email || '',
      email: usuario.email || '',
      criadoEm: serverTimestamp(),
      podeEditarAgendamento: false,
      podeEditarManifesto: false,
      podeEditarCargas: false,
      podeGerenciarDisponibilidade: false
    });
  } catch (e) {
    console.warn('Não foi possível verificar/criar o perfil em users/{uid}:', e.code || e.message);
  }
}

// Substitui a planilha de Agendamentos como fonte da DATA/status de agendamento (a Base
// Bluesoft já cobre "precisa de agendamento" via a própria coluna "Agendado", cruzada por
// CNPJ) — por decisão do usuário (2026-08-14). Uma coleção só, documento por NF (sem
// sufixo de viagem/item, igual ao resto do dashboard).
const AGENDAMENTOS_MANUAIS_COLECAO = 'agendamentosManuais';

/** Busca todos os agendamentos preenchidos manualmente. Devolve um objeto simples
 * { [nf]: { statusAgendamento, dataAgendamento, atualizadoPorEmail } } — mais fácil de
 * cruzar em data.js do que ficar repassando objetos do Firestore adiante. */
async function getAgendamentosManuais() {
  const snapshot = await getDocs(collection(db, AGENDAMENTOS_MANUAIS_COLECAO));
  const porNf = {};
  snapshot.forEach(docSnap => { porNf[docSnap.id] = docSnap.data(); });
  return porNf;
}

/** Grava/atualiza o agendamento manual de uma NF. `dataAgendamento` é uma string
 * "yyyy-MM-dd" (ou '' pra limpar) — mais simples de editar num <input type="date"> do que
 * lidar com Timestamp do Firestore na hora de preencher o campo de volta. `observacao`
 * (2026-08-17) é um texto livre opcional pra quem edita anotar algo sobre a nota. */
async function salvarAgendamentoManual(nf, statusAgendamento, dataAgendamento, observacao) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  await setDoc(doc(db, AGENDAMENTOS_MANUAIS_COLECAO, nf), {
    statusAgendamento: statusAgendamento || '',
    dataAgendamento: dataAgendamento || '',
    observacao: observacao || '',
    atualizadoPorEmail: usuario.email,
    atualizadoEm: serverTimestamp()
  });
}

/** Mesma ideia de salvarAgendamentoManual acima, mas pra um Pedido Aguardando Faturamento
 * (2026-08-28) — reaproveita a MESMA coleção do Firestore (agendamentosManuais), só com a
 * chave prefixada "pedido-<número>" em vez da NF, pra não precisar criar uma coleção nova +
 * regra de segurança nova (essa coleção já está liberada). Um pedido não tem NF ainda (é
 * literalmente o que "aguardando faturamento" significa), então usa numeroPedido direto. */
async function salvarAgendamentoManualPedido(numeroPedido, statusAgendamento, dataAgendamento, observacao) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  await setDoc(doc(db, AGENDAMENTOS_MANUAIS_COLECAO, `pedido-${numeroPedido}`), {
    statusAgendamento: statusAgendamento || '',
    dataAgendamento: dataAgendamento || '',
    observacao: observacao || '',
    atualizadoPorEmail: usuario.email,
    atualizadoEm: serverTimestamp()
  });
}

/** "Valor Descarga Aprovado" (2026-09-08, pedido da usuária: coluna nova na tabela "Registros
 * detalhados" pro setor de Monitoramento pré-aprovar um valor de descarga por NF). Coleção
 * PRÓPRIA (não dentro de agendamentosManuais) de propósito: ela pediu uma permissão separada
 * (podeEditarValorDescarga) pra editar esse campo, e Firestore Rules não fazem bem controle por
 * CAMPO dentro do mesmo documento — mais simples e mais seguro manter num doc próprio por NF,
 * com sua própria regra, do mesmo jeito que Controle de Cargas já separa em várias coleções. */
const VALORES_DESCARGA_COLECAO = 'valoresDescargaAprovados';

/** Busca todos os valores de descarga aprovados. Devolve { [nf]: { valor, atualizadoPorEmail,
 * atualizadoEm } } — mesmo formato de getAgendamentosManuais(), mais fácil de cruzar em data.js. */
async function getValoresDescargaAprovados() {
  const snapshot = await getDocs(collection(db, VALORES_DESCARGA_COLECAO));
  const porNf = {};
  snapshot.forEach(docSnap => { porNf[docSnap.id] = docSnap.data(); });
  return porNf;
}

/** Grava/atualiza o valor de descarga aprovado de uma NF. `valor` null/'' apaga o valor (volta
 * a mostrar "Adicionar valor" na tabela) — mesmo padrão de permitir limpar já usado em
 * salvarObservacaoNota. */
async function salvarValorDescargaAprovado(nf, valor) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  const numero = valor === null || valor === undefined || valor === '' ? null : Number(valor);
  if (numero !== null && (isNaN(numero) || numero < 0)) throw new Error('Valor inválido.');
  await setDoc(doc(db, VALORES_DESCARGA_COLECAO, nf), {
    valor: numero,
    atualizadoPorEmail: usuario.email,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

/** Grava/atualiza se a entrega dessa NF teve ajudante ('COM_AJUDANTE'/'SEM_AJUDANTE'/'' pra
 * limpar) — mesma coleção/permissão de salvarValorDescargaAprovado (pedido da usuária,
 * 2026-09-08: "cria essa coluna do lado de onde vamos colocar o valor" — mesmo time, mesmo
 * momento de preenchimento, não precisa de outra coleção/regra separada). Ela ainda não tem uma
 * base de clientes que exigem ajudante — vai montar isso manualmente daqui uns 3 meses,
 * observando essa coluna preenchida nota a nota. */
async function salvarAjudanteEntrega(nf, ajudante) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  if (!['', 'COM_AJUDANTE', 'SEM_AJUDANTE'].includes(ajudante)) throw new Error('Valor de ajudante inválido.');
  await setDoc(doc(db, VALORES_DESCARGA_COLECAO, nf), {
    ajudante: ajudante || '',
    atualizadoPorEmail: usuario.email,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

/** Grava/atualiza a QUANTIDADE de ajudantes ('1'/'2'/'3'/'4+'/'' pra limpar) — pedido da
 * usuária, 2026-09-08: campo SEPARADO de `ajudante` acima (aquele é Com/Sem, usado em
 * "Registros detalhados"; este é a contagem, usado só na tela "Controle de Despesas Extra").
 * Mesmo doc/coleção/permissão dos outros 2 campos deste grupo. */
async function salvarQtdAjudante(nf, qtd) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  if (!['', '1', '2', '3', '4+'].includes(qtd)) throw new Error('Quantidade de ajudante inválida.');
  await setDoc(doc(db, VALORES_DESCARGA_COLECAO, nf), {
    qtdAjudante: qtd || '',
    atualizadoPorEmail: usuario.email,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

/** Grava/atualiza se essa entrega NECESSITA de ajudante ('SIM'/'NAO'/'' pra limpar) — pedido da
 * usuária, 2026-09-08: é o campo que de fato responde a intenção original dela ("clientes que
 * exigem ajudante na entrega"). Mesmo doc/coleção/permissão dos outros campos deste grupo. */
async function salvarNecessitaAjudante(nf, valor) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  if (!['', 'SIM', 'NAO'].includes(valor)) throw new Error('Valor de "Necessita Ajudante" inválido.');
  await setDoc(doc(db, VALORES_DESCARGA_COLECAO, nf), {
    necessitaAjudante: valor || '',
    atualizadoPorEmail: usuario.email,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

// "Necessita Ajudante" por CLIENTE (2026-09-10, pedido da usuária) — DIFERENTE do doc por NF
// acima: "precisa de ajudante" é uma característica do CLIENTE (o tipo de entrega dele), não de
// uma nota isolada, então ela quer que marcar SIM numa nota já deixe TODAS as notas daquele
// cliente como SIM — inclusive as que ainda vão chegar no futuro (por isso é uma coleção
// separada, por cliente, não uma gravação em massa nos docs de NF existentes — ver
// DataStore.applyClienteNecessitaAjudante em data.js, que aplica isso em toda nota do cliente
// SEM sobrescrever uma nota que já tenha um valor PRÓPRIO explícito gravado).
const CLIENTES_NECESSITAM_AJUDANTE_COLECAO = 'clientesNecessitamAjudante';

async function getClientesNecessitamAjudante() {
  const snapshot = await getDocs(collection(db, CLIENTES_NECESSITAM_AJUDANTE_COLECAO));
  const porCliente = {};
  snapshot.forEach(docSnap => { porCliente[docSnap.id] = docSnap.data(); });
  return porCliente;
}

/** clienteChave: já normalizada (DataStore.normalizeClienteKey do lado do dashboard.js) — esta
 * função só grava, não normaliza de novo. */
async function salvarClienteNecessitaAjudante(clienteChave, valor) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  if (!clienteChave) throw new Error('Cliente inválido — não é possível salvar.');
  await setDoc(doc(db, CLIENTES_NECESSITAM_AJUDANTE_COLECAO, clienteChave), {
    necessitaAjudante: valor || '',
    atualizadoPorEmail: usuario.email,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

// "Observação" da tela Despesas Extra, por CLIENTE (2026-09-12, pedido da usuária: "a mensagem
// fica salva em todas as notas que tiverem o mesmo cliente") -- mesmo padrão de coleção separada
// por cliente que CLIENTES_NECESSITAM_AJUDANTE_COLECAO acima, mas sem a metade "valor próprio da
// nota": aqui NUNCA existe um valor individual por NF, é sempre o texto do cliente inteiro (ver
// DataStore.applyClienteObservacaoDescarga em data.js, que sobrescreve toda nota do cliente sem
// guarda de "só se vazio").
const CLIENTES_OBSERVACAO_DESCARGA_COLECAO = 'clientesObservacaoDescarga';

async function getClientesObservacaoDescarga() {
  const snapshot = await getDocs(collection(db, CLIENTES_OBSERVACAO_DESCARGA_COLECAO));
  const porCliente = {};
  snapshot.forEach(docSnap => { porCliente[docSnap.id] = docSnap.data(); });
  return porCliente;
}

/** clienteChave: já normalizada (DataStore.normalizeClienteKey do lado do dashboard.js) — esta
 * função só grava, não normaliza de novo. */
async function salvarClienteObservacaoDescarga(clienteChave, observacao) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  if (!clienteChave) throw new Error('Cliente inválido — não é possível salvar.');
  await setDoc(doc(db, CLIENTES_OBSERVACAO_DESCARGA_COLECAO, clienteChave), {
    observacao: observacao || '',
    atualizadoPorEmail: usuario.email,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

/** Grava só a observação de uma NF (usado pela tela "Notas em aberto", 2026-08-19 — uma nota
 * aberta pode não precisar de agendamento nenhum, então essa tela não mexe em status/data).
 * Usa `{merge: true}` de propósito — diferente de salvarAgendamentoManual acima, que sempre
 * reescreve o documento inteiro (status+data+observação juntos, um edit coerente). Sem o
 * merge aqui, salvar só a observação apagaria o status/data de agendamento que a nota já
 * tivesse (o documento no Firestore é o mesmo, por NF). */
async function salvarObservacaoNota(nf, observacao) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  await setDoc(doc(db, AGENDAMENTOS_MANUAIS_COLECAO, nf), {
    observacao: observacao || '',
    atualizadoPorEmail: usuario.email,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

// Permissão de edição de agendamento por usuário: quem loga com o e-mail configurado como
// super admin (ver SUPER_ADMIN_EMAIL_AGENDAMENTO em dashboard.js) sempre pode editar; os
// demais usuários só podem se o super admin habilitar isso pelo modal "Gerenciar usuários"
// (que grava esse campo aqui no próprio perfil, em `users/{uid}`).

/** Lista todos os usuários cadastrados — usado só no modal "Gerenciar usuários". As regras
 * de segurança do Firestore restringem essa consulta ao super admin (ver Regras no console).
 * "Missing or insufficient permissions" intermitente aqui (2026-09-12, mesmo com a regra e o
 * e-mail certos) -- rastreado até o ID token da sessão ficar desatualizado quando a aba fica
 * muito tempo aberta/em segundo plano (mesmo padrão de "aba velha" já visto neste projeto, só
 * que aplicado ao token de autenticação, não ao JS/CSS): forçar a renovação (getIdToken(true))
 * ANTES da consulta, em vez de confiar no token que já estava em memória, resolveu na hora
 * quando testado ao vivo. Sem custo perceptível (só troca o token já em memória por um novo). */
async function getUsuarios() {
  if (auth.currentUser) await auth.currentUser.getIdToken(true);
  const snapshot = await getDocs(collection(db, 'users'));
  const lista = [];
  snapshot.forEach(docSnap => {
    const d = docSnap.data();
    lista.push({
      uid: docSnap.id,
      nome: d.nome || d.email || docSnap.id,
      email: d.email || '',
      podeEditarAgendamento: !!d.podeEditarAgendamento,
      podeEditarManifesto: !!d.podeEditarManifesto,
      podeEditarCargas: !!d.podeEditarCargas,
      podeGerenciarDisponibilidade: !!d.podeGerenciarDisponibilidade,
      podeEditarValorDescarga: !!d.podeEditarValorDescarga
    });
  });
  return lista;
}

/** Habilita/desabilita a edição de agendamento de um usuário específico. */
async function definirPermissaoEdicaoAgendamento(uid, pode) {
  await updateDoc(doc(db, 'users', uid), { podeEditarAgendamento: !!pode });
}

/** Habilita/desabilita a edição do Manifesto (Controle de Retorno) de um usuário específico —
 * mesma ideia de definirPermissaoEdicaoAgendamento acima, campo separado. Quem não tem essa
 * permissão ainda pode ABRIR o Manifesto e criar notas novas ("alimentar"), só não edita/exclui
 * as existentes nem exporta/importa — ver manifesto/index.html. */
async function definirPermissaoEdicaoManifesto(uid, pode) {
  await updateDoc(doc(db, 'users', uid), { podeEditarManifesto: !!pode });
}

/** Habilita/desabilita mover motoristas entre Separação Não Iniciada/Iniciada/Separado e
 * sincronizar o cadastro da planilha (Controle de Cargas) — mesmo padrão das duas acima. */
async function definirPermissaoEdicaoCargas(uid, pode) {
  await updateDoc(doc(db, 'users', uid), { podeEditarCargas: !!pode });
}

/** Habilita/desabilita retirar/encerrar a disponibilidade de um motorista (Controle de
 * Cargas) — separada de podeEditarCargas de propósito: mover carga entre status (equipe de
 * separação) e gerenciar quem está disponível pra carregar (equipe de transportes) são
 * operações de times diferentes na prática, mesmo dentro do mesmo módulo. */
async function definirPermissaoGerenciarDisponibilidade(uid, pode) {
  await updateDoc(doc(db, 'users', uid), { podeGerenciarDisponibilidade: !!pode });
}

/** Habilita/desabilita editar o "Valor Descarga Aprovado" na tabela "Registros detalhados"
 * (2026-09-08, pedido da usuária: permissão separada, só pro setor de Monitoramento — nada a
 * ver com podeEditarAgendamento, mesmo que os dois apareçam na mesma linha da tabela). */
async function definirPermissaoEdicaoValorDescarga(uid, pode) {
  await updateDoc(doc(db, 'users', uid), { podeEditarValorDescarga: !!pode });
}

/** Verifica se o usuário logado agora tem permissão de editar agendamento (chamado 1x no
 * login) — separado de getUsuarios() porque um usuário comum só pode ler o próprio perfil. */
async function getMinhaPermissaoEdicaoAgendamento() {
  const usuario = auth.currentUser;
  if (!usuario) return false;
  const snap = await getDoc(doc(db, 'users', usuario.uid));
  return snap.exists() ? !!snap.data().podeEditarAgendamento : false;
}

/** Mesma ideia de getMinhaPermissaoEdicaoAgendamento, pras 2 permissões novas do Controle de
 * Cargas — 1 leitura só do próprio perfil, reaproveitada pelas duas checagens. */
async function getMinhasPermissoesCargas() {
  const usuario = auth.currentUser;
  if (!usuario) return { podeEditarCargas: false, podeGerenciarDisponibilidade: false };
  const snap = await getDoc(doc(db, 'users', usuario.uid));
  const d = snap.exists() ? snap.data() : {};
  return { podeEditarCargas: !!d.podeEditarCargas, podeGerenciarDisponibilidade: !!d.podeGerenciarDisponibilidade };
}

/** Mesma ideia de getMinhaPermissaoEdicaoAgendamento, pro "Valor Descarga Aprovado". */
async function getMinhaPermissaoEdicaoValorDescarga() {
  const usuario = auth.currentUser;
  if (!usuario) return false;
  const snap = await getDoc(doc(db, 'users', usuario.uid));
  return snap.exists() ? !!snap.data().podeEditarValorDescarga : false;
}

/* ============================================================
 * CONTROLE DE CARGAS E DISPONIBILIDADE DE MOTORISTAS (2026-09-04)
 * ------------------------------------------------------------
 * 5 coleções novas, mesmo projeto Firestore de sempre. Placa SEMPRE normalizada (maiúscula,
 * só letras/números — normalizarPlaca abaixo) como ID do documento em `motoristas`/
 * `statusCarga`/`disponibilidade`: garante 1 doc só por placa pela própria estrutura (upsert,
 * nunca duplica), sem precisar de lógica de checagem em cada leitura. O nome/veículo/rodízio
 * do motorista NUNCA são copiados pra dentro de statusCarga/disponibilidade — quem exibe cruza
 * por placa com a lista de `motoristas` (assinarMotoristas), pra nunca desatualizar se o
 * cadastro mudar depois.
 *
 * Cada mudança de estado "atual" (statusCarga/disponibilidade) é gravada no MESMO writeBatch
 * junto de 1 registro na coleção de histórico correspondente (statusCargaHistorico/
 * disponibilidadeHistorico, auto-ID) — mesma técnica já usada em atualizarRegistrosEmLote do
 * Manifesto, aqui garantindo que o "estado atual" e o "aconteceu isso" nunca fiquem
 * dessincronizados um do outro.
 * ============================================================ */

const MOTORISTAS_COLECAO = 'motoristas';
const STATUS_CARGA_COLECAO = 'statusCarga';
const STATUS_CARGA_HISTORICO_COLECAO = 'statusCargaHistorico';
const STATUS_CARGA_NO_SHOW_COLECAO = 'statusCargaNoShow';
const DISPONIBILIDADE_COLECAO = 'disponibilidade';
const DISPONIBILIDADE_HISTORICO_COLECAO = 'disponibilidadeHistorico';

/** Maiúscula, só letras/números — mesmo algoritmo usado na extração da planilha
 * (scripts/atualizar-motoristas.ps1, Normalizar-Placa) e no app do motorista, pra "ABC1D23"/
 * "abc-1d23"/"ABC 1D23" sempre caírem no mesmo documento. */
function normalizarPlaca(valor) {
  return String(valor || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Lê o cadastro inteiro de motoristas 1x (usado por sincronizarMotoristas, pra decidir quem
 * sumiu da planilha nova). Leitura simples, sem onSnapshot — quem quer tempo real usa
 * assinarMotoristas. */
async function getMotoristas() {
  const snapshot = await getDocs(collection(db, MOTORISTAS_COLECAO));
  return snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Cadastra (ou atualiza, se a placa já existir) UM motorista manualmente — pedido da usuária
 * (2026-09-04): a planilha de origem não vai ser sincronizada com frequência, então cadastrar
 * direto no painel virou o jeito PRINCIPAL de adicionar motorista novo (a sincronização em
 * lote continua existindo, só deixou de ser o fluxo do dia a dia). Devolve `{criado:boolean}`
 * pra quem chama saber se foi cadastro novo ou atualização de um já existente. */
async function cadastrarMotorista({ nome, placa, veiculo, transportadora, rodizio }) {
  // Placa pode ser um ID temporário "SEMPLACA..." (2026-09-25, motorista colado só com o nome
  // via "Adicionar motoristas do dia") — normalizarPlaca não mexe nele (só letras/números, sem
  // hífen, ver cargasGerarIdTemporario em dashboard.js), passa igual por aqui.
  const placaNormalizada = normalizarPlaca(placa);
  if (!placaNormalizada) throw new Error('Placa inválida.');
  if (!nome || !nome.trim()) throw new Error('Nome é obrigatório.');
  const ref = doc(db, MOTORISTAS_COLECAO, placaNormalizada);
  const snap = await getDoc(ref);
  const criado = !snap.exists();
  await setDoc(ref, {
    placa: placaNormalizada,
    nome: nome.trim(),
    veiculo: (veiculo || '').trim(),
    transportadora: (transportadora || '').trim(),
    rodizio: (rodizio || '').trim(),
    ativo: true,
    atualizadoEm: serverTimestamp(),
    ...(criado ? { criadoEm: serverTimestamp() } : {})
  }, { merge: true });
  return { criado };
}

/** "Excluir cadastro" (2026-09-26, ícone de lixeira em Motoristas Cadastrados) — exclusão SUAVE,
 * mesmo critério já usado por sincronizarMotoristas quando alguém some da planilha: marca
 * `ativo:false` em vez de apagar o doc de verdade, preservando qualquer statusCarga/
 * disponibilidade/histórico que ainda referencie essa placa. `assinarMotoristas` já filtra
 * `ativo !== false`, então a linha some da lista sozinha assim que o Firestore confirmar. */
async function desativarMotorista(placaBruta) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  const placa = normalizarPlaca(placaBruta);
  await updateDoc(doc(db, MOTORISTAS_COLECAO, placa), { ativo: false, atualizadoEm: serverTimestamp() });
}

/** Tempo real do cadastro de motoristas — dispara com a lista inteira sempre que algo mudar
 * (sincronização da planilha, ou uma edição manual futura). */
function assinarMotoristas(callback, aoFalhar) {
  return onSnapshot(
    collection(db, MOTORISTAS_COLECAO),
    snapshot => callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { console.error('Falha ao sincronizar motoristas', err); if (aoFalhar) aoFalhar(err); }
  );
}

/** Sincroniza o cadastro central `motoristas` a partir das linhas já extraídas da planilha
 * (`{nome, rodizio, veiculo, placa, transportadora}[]`, mesmo formato de
 * sample-data-motoristas.csv — `transportadora` novo, 2026-09-26). Nunca
 * apaga um motorista que sumiu da planilha — marca `ativo:false` (pedido explícito da
 * usuária: "não apagar históricos antigos por causa da sincronização"), preservando o doc e
 * qualquer statusCarga/disponibilidade que ainda referencie essa placa. Quem já existia e
 * continua na planilha tem nome/veículo/rodízio atualizados e volta a `ativo:true` se tinha
 * sido marcado inativo antes. Tudo em lotes de 400 (limite do Firestore por writeBatch).
 */
async function sincronizarMotoristas(linhas) {
  const existentes = await getMotoristas();
  const placasNaPlanilha = new Set();
  const operacoes = [];

  for (const linha of linhas) {
    const placa = normalizarPlaca(linha.placa);
    if (!placa || !linha.nome) continue;
    placasNaPlanilha.add(placa);
    operacoes.push({
      ref: doc(db, MOTORISTAS_COLECAO, placa),
      dados: {
        placa,
        nome: String(linha.nome).trim(),
        veiculo: String(linha.veiculo || '').trim(),
        transportadora: String(linha.transportadora || '').trim(),
        rodizio: String(linha.rodizio || '').trim(),
        ativo: true,
        atualizadoEm: serverTimestamp()
      },
      novo: !existentes.some(m => m.id === placa)
    });
  }

  const inativados = existentes.filter(m => m.ativo !== false && !placasNaPlanilha.has(m.id));
  for (const m of inativados) {
    operacoes.push({
      ref: doc(db, MOTORISTAS_COLECAO, m.id),
      dados: { ativo: false, atualizadoEm: serverTimestamp() },
      novo: false
    });
  }

  const TAMANHO_MAX_LOTE = 400;
  for (let i = 0; i < operacoes.length; i += TAMANHO_MAX_LOTE) {
    const pedaco = operacoes.slice(i, i + TAMANHO_MAX_LOTE);
    const lote = writeBatch(db);
    pedaco.forEach(op => {
      if (op.novo) lote.set(op.ref, { ...op.dados, criadoEm: serverTimestamp() });
      else lote.set(op.ref, op.dados, { merge: true });
    });
    await lote.commit();
  }

  return { total: linhas.length, novos: operacoes.filter(o => o.novo).length, inativados: inativados.length };
}

/** Tempo real do estado atual de separação (1 doc por placa, só quem está em algum dos 3
 * status — ver retirarStatusCarga). */
function assinarStatusCarga(callback, aoFalhar) {
  return onSnapshot(
    collection(db, STATUS_CARGA_COLECAO),
    snapshot => callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { console.error('Falha ao sincronizar status de carga', err); if (aoFalhar) aoFalhar(err); }
  );
}

/** "Cargas por Motorista" (2026-09-26) — statusCargaHistorico é gravado desde sempre a cada
 * transição de status (definirStatusCarga/retirarStatusCarga/marcarNoShowStatusCarga/
 * moverDisponibilidadeParaSeparacao), mas nunca tinha sido lido por ninguém. Leitura ÚNICA
 * (getDocs, não onSnapshot — não faz sentido deixar mais um listener ao vivo ligado o tempo
 * todo pra um card que só é aberto ocasionalmente), mais recentes primeiro, com limite (a
 * coleção cresce a cada mudança de status, sem limite ela ficaria grande demais pra ler inteira
 * de uma vez). */
async function getStatusCargaHistoricoRecente(limiteDocs = 3000) {
  const snap = await getDocs(query(collection(db, STATUS_CARGA_HISTORICO_COLECAO), orderBy('dataHora', 'desc'), limit(limiteDocs)));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

/** Move um motorista (por placa) pra um dos status de separação — NAO_INICIADA/EM_SEPARACAO/
 * SEPARADO/CARREGADO (o último gravado automaticamente por verificarCarregamentoStatusCarga,
 * dashboard.js, quando a placa aparece "Em Trânsito" na Base Bluesoft no dia). Sobrescreve o doc
 * atual (nunca duplica, nunca deixa o motorista em 2 status ao mesmo tempo, já que é sempre o
 * MESMO documento `statusCarga/{placa}`) e grava a transição no histórico no mesmo lote. */
async function definirStatusCarga(placaBruta, novoStatus, rota, visivel = true, transportadora = '') {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  const placa = normalizarPlaca(placaBruta);
  const refAtual = doc(db, STATUS_CARGA_COLECAO, placa);
  const snapAtual = await getDoc(refAtual);
  const dadosAntigos = snapAtual.exists() ? snapAtual.data() : {};
  const statusAnterior = snapAtual.exists() ? dadosAntigos.status : null;
  // `duplicado` (2026-09-19, pedido da usuária): motorista que JÁ tinha ido pra Carregado hoje e
  // está sendo colocado de novo em Separado (2ª carga no mesmo dia) — ela pediu pra deixar essa
  // duplicidade acontecer normalmente (sem etapa/card intermediário — removeu o "Retornou p/
  // Nova Carga" de propósito), só sinalizando visualmente (nome em verde, ver dashboard.js).
  const duplicado = statusAnterior === 'CARREGADO' && novoStatus === 'SEPARADO';

  const lote = writeBatch(db);
  // Rota é digitada manualmente pela equipe (pedido da usuária, 2026-09-04: "quero adicionar a
  // rota manualmente do mesmo jeito que incluo as informações de Separação") -- grava junto do
  // MESMO documento de status, pra ficar disponível tanto no painel quanto no app do motorista
  // sem precisar de outra leitura.
  // `visivel` (2026-09-17, default true — todo uso já existente continua exatamente igual):
  // só autoPopularSeparacaoNaoIniciada (abaixo) passa `false` explicitamente. Qualquer mudança
  // de status manual (Iniciar Separação, Marcar como Separado, o auto-CARREGADO de
  // verificarCarregamentoStatusCarga) sobrescreve pra `true` de novo -- não tem porque esconder
  // do motorista alguém que já está sendo mexido de verdade.
  // `transportadora`/`observacao` (2026-09-25) — mesmo tratamento de sempre pra este doc: é um
  // OVERWRITE completo (nunca merge), então quem chama é responsável por preservar o que já
  // estava salvo (ver dashboard.js, cargasStatusCarga.get(placa)) igual já acontece com `rota`.
  // `observacao` propositalmente NÃO entra aqui: só existe editada por
  // atualizarObservacaoStatusCarga (updateDoc), pra uma mudança de status nunca apagar uma
  // observação já escrita sem querer.
  lote.set(refAtual, {
    placa, status: novoStatus, rota: rota || '', transportadora: transportadora || '', observacao: dadosAntigos.observacao || '',
    visivel, duplicado, atualizadoEm: serverTimestamp(), alteradoPorEmail: usuario.email
  });
  const refHistorico = doc(collection(db, STATUS_CARGA_HISTORICO_COLECAO));
  lote.set(refHistorico, {
    placa, statusAnterior, statusNovo: novoStatus, dataHora: serverTimestamp(), alteradoPorEmail: usuario.email
  });
  await lote.commit();
}

/** Retira o motorista de qualquer status de separação (apaga o doc `statusCarga/{placa}` —
 * não é "status vazio", é a ausência do documento que significa "fora dos 3 status"). */
async function retirarStatusCarga(placaBruta) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  const placa = normalizarPlaca(placaBruta);
  const refAtual = doc(db, STATUS_CARGA_COLECAO, placa);
  const snapAtual = await getDoc(refAtual);
  if (!snapAtual.exists()) return;
  const statusAnterior = snapAtual.data().status;

  const lote = writeBatch(db);
  lote.delete(refAtual);
  const refHistorico = doc(collection(db, STATUS_CARGA_HISTORICO_COLECAO));
  lote.set(refHistorico, {
    placa, statusAnterior, statusNovo: null, dataHora: serverTimestamp(), alteradoPorEmail: usuario.email
  });
  await lote.commit();
}

/** "Hora limite de carregamento" (2026-09-22, pedido da usuária: um horário-alvo por motorista
 * no card Separado, pra escalonar a chegada — evitar todo mundo vindo carregar na mesma hora).
 * Campo simples no MESMO doc de statusCarga (nunca reseta sozinho ao trocar de status — só ela
 * apaga manualmente, limpando o campo). Não grava histórico (mesmo critério de ativarStatusCarga
 * acima: não é uma mudança de STATUS, só um dado auxiliar). */
async function atualizarHoraLimiteCarregamento(placaBruta, horaLimite) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  const placa = normalizarPlaca(placaBruta);
  await updateDoc(doc(db, STATUS_CARGA_COLECAO, placa), {
    horaLimiteCarregamento: horaLimite || '', horaLimiteAtualizadaPorEmail: usuario.email
  });
}

/** Rota editável manualmente (2026-09-23, pedido da usuária) — até aqui só dava pra definir na
 * hora de "Adicionar" (texto livre com sugestões da Base Bluesoft); isto permite corrigir depois,
 * direto no card, ex.: trocar "SP - REGIAO ABCD" por "Santo André". Mesmo padrão de
 * atualizarHoraLimiteCarregamento/atualizarMotivoNoShow acima — `statusCarga` nunca teve
 * `hasOnly()` restringindo campos, não precisa de regra nova. */
async function atualizarRotaStatusCarga(placaBruta, rota) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  const placa = normalizarPlaca(placaBruta);
  await updateDoc(doc(db, STATUS_CARGA_COLECAO, placa), {
    rota: rota || '', rotaAtualizadaPorEmail: usuario.email
  });
}

/** Transportadora editável direto no card (2026-09-25, "Motoristas do Dia") — mesmo padrão de
 * atualizarRotaStatusCarga acima. */
async function atualizarTransportadoraStatusCarga(placaBruta, transportadora) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  const placa = normalizarPlaca(placaBruta);
  await updateDoc(doc(db, STATUS_CARGA_COLECAO, placa), {
    transportadora: transportadora || '', transportadoraAtualizadaPorEmail: usuario.email
  });
}

/** Observação editável direto no card (2026-09-25, "Motoristas do Dia") — mesmo padrão de
 * atualizarRotaStatusCarga acima. */
async function atualizarObservacaoStatusCarga(placaBruta, observacao) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  const placa = normalizarPlaca(placaBruta);
  await updateDoc(doc(db, STATUS_CARGA_COLECAO, placa), {
    observacao: observacao || '', observacaoAtualizadaPorEmail: usuario.email
  });
}

/** Completa o cadastro de um motorista que foi colado só com o nome (2026-09-25, "Adicionar
 * motoristas do dia") — troca o ID temporário "SEMPLACA..." (ver cargasGerarIdTemporario,
 * dashboard.js) pela placa real assim que ela informar. Como a placa É o ID do documento em
 * `motoristas`/`statusCarga`, não dá pra só "editar um campo" — recria os 2 docs sob o ID novo
 * (preservando tudo: rota/transportadora/observação/status atual) e apaga os antigos, tudo no
 * mesmo lote. Se não existir doc em statusCarga ainda (motorista só cadastrado, sem fila hoje),
 * só migra o cadastro mesmo. */
async function definirPlacaMotorista(idAtual, placaNovaBruta) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  const placaNova = normalizarPlaca(placaNovaBruta);
  if (!placaNova) throw new Error('Placa inválida.');
  if (placaNova === idAtual) return;

  const refMotoristaAntigo = doc(db, MOTORISTAS_COLECAO, idAtual);
  const snapMotorista = await getDoc(refMotoristaAntigo);
  if (!snapMotorista.exists()) throw new Error('Motorista não encontrado.');
  const dadosMotorista = snapMotorista.data();

  const refMotoristaNovo = doc(db, MOTORISTAS_COLECAO, placaNova);
  const snapMotoristaNovo = await getDoc(refMotoristaNovo);
  if (snapMotoristaNovo.exists()) throw new Error('Já existe um motorista cadastrado com essa placa.');

  const refStatusAntigo = doc(db, STATUS_CARGA_COLECAO, idAtual);
  const snapStatus = await getDoc(refStatusAntigo);

  const lote = writeBatch(db);
  lote.set(refMotoristaNovo, { ...dadosMotorista, placa: placaNova, atualizadoEm: serverTimestamp() });
  lote.delete(refMotoristaAntigo);
  if (snapStatus.exists()) {
    const dadosStatus = snapStatus.data();
    lote.set(doc(db, STATUS_CARGA_COLECAO, placaNova), { ...dadosStatus, placa: placaNova, atualizadoEm: serverTimestamp() });
    lote.delete(refStatusAntigo);
  }
  const refHistorico = doc(collection(db, STATUS_CARGA_HISTORICO_COLECAO));
  lote.set(refHistorico, {
    placa: placaNova, statusAnterior: `placa definida (era ${idAtual})`, statusNovo: snapStatus.exists() ? snapStatus.data().status : null,
    dataHora: serverTimestamp(), alteradoPorEmail: usuario.email
  });
  await lote.commit();
}

/** Ativa a visibilidade de um status pro Painel do Motorista (2026-09-17) — ver
 * autoPopularSeparacaoNaoIniciada logo abaixo: motorista auto-adicionado em "Separação Não
 * Iniciada" nasce com `visivel:false` (some do app do motorista até ela clicar "Ativar p/
 * Motorista" no painel admin). Não grava histórico — diferente de definirStatusCarga, isto não
 * é uma mudança de STATUS, só de visibilidade. */
async function ativarStatusCarga(placaBruta) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  const placa = normalizarPlaca(placaBruta);
  await updateDoc(doc(db, STATUS_CARGA_COLECAO, placa), { visivel: true });
}

const CONFIG_CARGAS_COLECAO = 'configCargas';
const AUTO_POPULAR_SEPARACAO_DOC_ID = 'autoPopularSeparacaoNaoIniciada';

function cargasHojeAAAAMMDD() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Auto-popula "Separação Não Iniciada" com todo motorista ativo que ainda não está em NENHUM
 * status hoje (2026-09-17, pedido da usuária: "ganhar tempo pra não ficar digitando manualmente
 * todo motorista que a gente colocar carga"). `placasFaltantes` já vem calculado por quem chama
 * (dashboard.js já tem os motoristas/status em memória via onSnapshot, não precisa reconsultar
 * aqui). Roda no máximo 1x por dia de verdade (controlado pelo doc `configCargas/
 * autoPopularSeparacaoNaoIniciada` — compartilhado entre qualquer sessão/computador que abrir a
 * tela, não é "1x por navegador"); site é estático, sem servidor pra agendar isso numa hora
 * fixa, então quem dispara é a PRIMEIRA pessoa com acesso que abrir Controle de Cargas depois
 * da virada do dia. Só ADICIONA quem está faltando — nunca mexe em quem já tem status hoje
 * (aditivo, nunca reseta/sobrescreve progresso em andamento). Cada doc novo nasce com
 * `visivel:false` — só aparece no Painel do Motorista depois do "Ativar" (ver
 * ativarStatusCarga acima). */
async function autoPopularSeparacaoNaoIniciada(placasFaltantes) {
  const hoje = cargasHojeAAAAMMDD();
  const refConfig = doc(db, CONFIG_CARGAS_COLECAO, AUTO_POPULAR_SEPARACAO_DOC_ID);
  const snapConfig = await getDoc(refConfig);
  if (snapConfig.exists() && snapConfig.data().ultimaExecucao === hoje) return;

  if (placasFaltantes.length) {
    await Promise.all(placasFaltantes.map(placa => definirStatusCarga(placa, 'NAO_INICIADA', '', false)));
  }
  await setDoc(refConfig, { ultimaExecucao: hoje, atualizadoEm: serverTimestamp() });
}

/** Tempo real do histórico de No Show (motorista com carga Separada que não chegou a
 * carregar) — coleção só de acréscimo, cada doc é 1 ocorrência (ver marcarNoShowStatusCarga). */
function assinarStatusCargaNoShow(callback, aoFalhar) {
  return onSnapshot(
    collection(db, STATUS_CARGA_NO_SHOW_COLECAO),
    snapshot => callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { console.error('Falha ao sincronizar histórico de No Show', err); if (aoFalhar) aoFalhar(err); }
  );
}

/** Marca No Show (pedido explícito da usuária, 2026-09-08: botão manual no card Separado pra
 * ela mesma acionar quando o motorista não carregou; `motivo` vem do modal "Motivo do No Show",
 * mesmo pedido do mesmo dia). Tira o motorista de `statusCarga` (mesma semântica de "retirar" —
 * o doc não representa mais um status ativo) e grava 1 ocorrência em `statusCargaNoShow` (usada
 * pelo card "No Show" e pelo ranking de motoristas) + 1 entrada no histórico geral de
 * transições, tudo no mesmo lote. */
async function marcarNoShowStatusCarga(placaBruta, motivo) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  const placa = normalizarPlaca(placaBruta);
  const refAtual = doc(db, STATUS_CARGA_COLECAO, placa);
  const snapAtual = await getDoc(refAtual);
  if (!snapAtual.exists()) return;
  const dadosAtuais = snapAtual.data();

  const lote = writeBatch(db);
  lote.delete(refAtual);
  const refNoShow = doc(collection(db, STATUS_CARGA_NO_SHOW_COLECAO));
  lote.set(refNoShow, {
    placa, rota: dadosAtuais.rota || '', statusAnterior: dadosAtuais.status, motivo: motivo || '',
    dataSeparado: dadosAtuais.atualizadoEm || null, marcadoEm: serverTimestamp(), marcadoPorEmail: usuario.email
  });
  const refHistorico = doc(collection(db, STATUS_CARGA_HISTORICO_COLECAO));
  lote.set(refHistorico, {
    placa, statusAnterior: dadosAtuais.status, statusNovo: 'NO_SHOW', dataHora: serverTimestamp(), alteradoPorEmail: usuario.email
  });
  await lote.commit();
}

/** Corrige/completa o Motivo de uma ocorrência de No Show já registrada (2026-09-15, pedido da
 * usuária: "editável, igual o campo de Observação") — diferente de marcarNoShowStatusCarga
 * (que sempre CRIA um doc novo, auto-ID), aqui é update de UM campo num doc que já existe,
 * identificado pelo próprio id do documento (statusCargaNoShow não tem chave de negócio única
 * tipo NF/cliente pra usar num setDoc com merge, então updateDoc no id é o jeito certo). */
async function atualizarMotivoNoShow(id, motivo) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  await updateDoc(doc(db, STATUS_CARGA_NO_SHOW_COLECAO, id), {
    motivo: motivo || '', motivoAtualizadoPorEmail: usuario.email, motivoAtualizadoEm: serverTimestamp()
  });
}

/** Tempo real de quem avisou disponibilidade (1 doc por placa — status DISPONIVEL/ENCERRADO,
 * ver disponibilidade/{placa}). */
function assinarDisponibilidade(callback, aoFalhar) {
  return onSnapshot(
    collection(db, DISPONIBILIDADE_COLECAO),
    snapshot => callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { console.error('Falha ao sincronizar disponibilidade', err); if (aoFalhar) aoFalhar(err); }
  );
}

/** Retira um motorista da lista de disponíveis pelo lado do Site Principal (foi selecionado
 * pra uma carga, ou a equipe decidiu encerrar manualmente) — usado só pela equipe
 * (podeGerenciarDisponibilidade); o motorista se marcando disponível sozinho é feito pelo
 * app dele (motoristas/index.html), com sua própria função de escrita. */
async function encerrarDisponibilidade(placaBruta, motivo) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  const placa = normalizarPlaca(placaBruta);
  const refAtual = doc(db, DISPONIBILIDADE_COLECAO, placa);

  const lote = writeBatch(db);
  lote.update(refAtual, {
    status: 'ENCERRADO', encerradoEm: serverTimestamp(), encerradoPorEmail: usuario.email
  });
  const refHistorico = doc(collection(db, DISPONIBILIDADE_HISTORICO_COLECAO));
  lote.set(refHistorico, {
    placa, evento: 'encerrado', dataHora: serverTimestamp(), origem: 'site', porEmail: usuario.email, motivo: motivo || ''
  });
  await lote.commit();
}

/** Move um motorista da lista de "Disponível" direto pra uma categoria de separação (2026-09-17,
 * pedido da usuária: "ter a opção de colocar o motorista em alguma categoria de Separação" a
 * partir do próprio card "Motoristas Disponíveis") — grava o novo statusCarga (mesmo formato de
 * definirStatusCarga, com histórico) E encerra a disponibilidade, tudo num ÚNICO lote atômico —
 * nunca existe um instante em que o motorista apareça nas duas listas ao mesmo tempo (ou em
 * nenhuma, se só uma das escritas falhasse). Precisa de podeEditarCargas (não só
 * podeGerenciarDisponibilidade — ver Firestore rules) porque grava em statusCarga. */
async function moverDisponibilidadeParaSeparacao(placaBruta, novoStatus, rota, transportadora = '') {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  const placa = normalizarPlaca(placaBruta);

  const refStatus = doc(db, STATUS_CARGA_COLECAO, placa);
  const snapStatus = await getDoc(refStatus);
  const statusAnterior = snapStatus.exists() ? snapStatus.data().status : null;
  // `duplicado` (2026-09-19) — mesmo critério de definirStatusCarga: cobre o caso raro dessa
  // placa já ter um doc de statusCarga CARREGADO (de uma carga anterior no mesmo dia) enquanto
  // também aparecia em Disponível (avisou disponibilidade de novo antes de alguém retirar o
  // status antigo).
  const duplicado = statusAnterior === 'CARREGADO' && novoStatus === 'SEPARADO';

  const lote = writeBatch(db);
  lote.set(refStatus, {
    placa, status: novoStatus, rota: rota || '', transportadora: transportadora || '', visivel: true, duplicado,
    atualizadoEm: serverTimestamp(), alteradoPorEmail: usuario.email
  });
  const refHistoricoStatus = doc(collection(db, STATUS_CARGA_HISTORICO_COLECAO));
  lote.set(refHistoricoStatus, {
    placa, statusAnterior, statusNovo: novoStatus, dataHora: serverTimestamp(), alteradoPorEmail: usuario.email
  });

  const refDisponibilidade = doc(db, DISPONIBILIDADE_COLECAO, placa);
  lote.update(refDisponibilidade, {
    status: 'ENCERRADO', encerradoEm: serverTimestamp(), encerradoPorEmail: usuario.email
  });
  const refHistoricoDisp = doc(collection(db, DISPONIBILIDADE_HISTORICO_COLECAO));
  lote.set(refHistoricoDisp, {
    placa, evento: 'encerrado', dataHora: serverTimestamp(), origem: 'site', porEmail: usuario.email,
    motivo: `Movido para ${novoStatus}`
  });

  await lote.commit();
}

/** Reconciliação automática Disponível -> Carregou/No-Show (pedido da usuária, 2026-09-04):
 * "quando você vê o nome do motorista na Base Bluesoft é porque ele já carregou... se passar
 * a data de hoje e ele não tiver carregado, precisa dar o retorno NO-SHOW". Só o Site
 * Principal consegue rodar essa checagem (só ele carrega a Base Bluesoft) — `dashboard.js`
 * cruza `DataStore.getRecords()` (por Placa, não por nome — mais confiável, já é a chave
 * principal de todo o resto do módulo) contra as disponibilidades ainda `DISPONIVEL` e chama
 * essa função com o resultado já decidido. `atualizacoes`: `[{placa, novoStatus, referencia}]`
 * — `novoStatus` é `'CARREGOU'` ou `'NO_SHOW'`, `referencia` é a NF/data da viagem encontrada
 * (só quando CARREGOU, pra dar contexto no histórico). Não é uma ação manual de ninguém —
 * roda sozinha (chamada por qualquer sessão logada olhando o painel), então não exige
 * `podeGerenciarDisponibilidade`; só transições válidas a partir de `DISPONIVEL` acontecem
 * (ver dashboard.js), nunca mexe num doc já `ENCERRADO` manualmente. */
async function atualizarDisponibilidadesEmLote(atualizacoes) {
  const usuario = auth.currentUser;
  const TAMANHO_MAX_LOTE = 400;
  for (let i = 0; i < atualizacoes.length; i += TAMANHO_MAX_LOTE) {
    const pedaco = atualizacoes.slice(i, i + TAMANHO_MAX_LOTE);
    const lote = writeBatch(db);
    pedaco.forEach(({ placa, novoStatus, referencia }) => {
      const placaNormalizada = normalizarPlaca(placa);
      const refAtual = doc(db, DISPONIBILIDADE_COLECAO, placaNormalizada);
      const camposAtuais = { status: novoStatus };
      if (novoStatus === 'CARREGOU') camposAtuais.carregouEm = serverTimestamp();
      lote.update(refAtual, camposAtuais);
      const refHistorico = doc(collection(db, DISPONIBILIDADE_HISTORICO_COLECAO));
      lote.set(refHistorico, {
        placa: placaNormalizada,
        evento: novoStatus === 'CARREGOU' ? 'carregou' : 'no_show',
        dataHora: serverTimestamp(),
        origem: 'sistema',
        referencia: referencia || '',
        porEmail: usuario ? usuario.email : ''
      });
    });
    await lote.commit();
  }
}

/* ============================================================
 * AVISO AOS MOTORISTAS (2026-09-13, prioridade + histórico em 2026-09-13)
 * Card informativo enviado pelo Controle de Cargas (painel administrativo) e exibido no topo
 * do Painel do Motorista — pedido da usuária: "essa mensagem vai durar 24hrs e depois vai
 * sumir, ou se for enviado outra manualmente". Modelado como 1 DOC SÓ (singleton, id fixo
 * 'atual'), não uma coleção de mensagens indexada — só existe "o aviso atual", sobrescrito a
 * cada envio novo; a expiração de 24h é decidida NO CLIENTE (quem lê compara `criadoEm` com a
 * hora atual), não tem job/cron nenhum apagando o doc sozinho.
 * `prioridade` ('info'/'atencao'/'urgente') muda só a cor/ícone de exibição, não o
 * comportamento — mesmo padrão em ambos os apps (dashboard.js e motoristas/index.html).
 * `avisoMotoristasHistorico` (auto-ID, só cresce) grava 1 cópia de CADA envio — pedido de
 * melhoria dela ("um histórico dos avisos já enviados"), já que o doc singleton por si só não
 * guarda rastro do que foi substituído. Remover o aviso NÃO gera entrada de histórico (não é
 * uma mensagem nova, só encerra a atual antes da hora). */
const AVISO_MOTORISTAS_COLECAO = 'avisoMotoristas';
const AVISO_MOTORISTAS_DOC_ID = 'atual';
const AVISO_MOTORISTAS_HISTORICO_COLECAO = 'avisoMotoristasHistorico';

/** Tempo real do aviso atual — dispara com `null` quando não existe (nunca foi enviado, ou foi
 * removido manualmente). A decisão de "já passou de 24h" fica por conta de quem consome (ver
 * cargasAvisoExpirado em dashboard.js e a mesma checagem em motoristas/index.html). */
function assinarAvisoMotoristas(callback, aoFalhar) {
  return onSnapshot(
    doc(db, AVISO_MOTORISTAS_COLECAO, AVISO_MOTORISTAS_DOC_ID),
    snap => callback(snap.exists() ? { id: snap.id, ...snap.data() } : null),
    err => { console.error('Falha ao sincronizar aviso aos motoristas', err); if (aoFalhar) aoFalhar(err); }
  );
}

/** Envia (ou substitui) o aviso atual — mesmo doc sempre, sobrescrito por completo, reiniciando
 * a contagem de 24h a partir de agora (é exatamente o "ou se for enviado outra manualmente"
 * pedido por ela) — e grava 1 cópia no histórico, no MESMO writeBatch (mesma técnica de
 * estado-atual + histórico já usada em statusCarga/disponibilidade). */
async function enviarAvisoMotoristas(mensagem, prioridade) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  const texto = String(mensagem || '').trim();
  if (!texto) throw new Error('Mensagem vazia.');
  const nivel = ['info', 'atencao', 'urgente'].includes(prioridade) ? prioridade : 'info';

  const lote = writeBatch(db);
  lote.set(doc(db, AVISO_MOTORISTAS_COLECAO, AVISO_MOTORISTAS_DOC_ID), {
    mensagem: texto, prioridade: nivel, criadoEm: serverTimestamp(), criadoPorEmail: usuario.email
  });
  lote.set(doc(collection(db, AVISO_MOTORISTAS_HISTORICO_COLECAO)), {
    mensagem: texto, prioridade: nivel, criadoEm: serverTimestamp(), criadoPorEmail: usuario.email
  });
  await lote.commit();
}

/** Remove o aviso atual antes das 24h (botão "Remover aviso" no painel administrativo). */
async function removerAvisoMotoristas() {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  await deleteDoc(doc(db, AVISO_MOTORISTAS_COLECAO, AVISO_MOTORISTAS_DOC_ID));
}

/** Tempo real dos últimos 20 avisos já enviados (mais recente primeiro) — só o painel
 * administrativo assina isso; o app do motorista não precisa de histórico nenhum. */
function assinarAvisoMotoristasHistorico(callback, aoFalhar) {
  return onSnapshot(
    query(collection(db, AVISO_MOTORISTAS_HISTORICO_COLECAO), orderBy('criadoEm', 'desc'), limit(20)),
    snapshot => callback(snapshot.docs.map(d => ({ id: d.id, ...d.data() }))),
    err => { console.error('Falha ao sincronizar histórico de avisos', err); if (aoFalhar) aoFalhar(err); }
  );
}

/* ============================================================
 * HISTÓRICO POR DATA — "ENCERRAR O DIA" (2026-09-25, pedido da usuária)
 * ------------------------------------------------------------
 * Decidido com ela (item 19 do pedido original, via pergunta): fechamento MANUAL, não automático
 * à meia-noite — ela clica "Encerrar o dia" quando quiser. 1 doc por dia (não subcoleção — lê o
 * dia inteiro num getDoc só), id = "AAAA-MM-DD". Não apaga `motoristas` (cadastro) nem
 * `disponibilidade` — só arquiva+limpa a fila de separação (`statusCarga`).
 * ============================================================ */
const PROGRAMACAO_DIARIA_COLECAO = 'programacaoDiaria';

/** Arquiva a programação de hoje (itens já montados por quem chama, dashboard.js — mesmo padrão
 * de autoPopularSeparacaoNaoIniciada/atualizarDisponibilidadesEmLote: quem já tem os dados em
 * memória via onSnapshot monta o payload, aqui só grava) e limpa `statusCarga` das placas
 * arquivadas, tudo no mesmo lote. */
async function encerrarDiaControleCargas(data, itens) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  if (!itens.length) return;

  const lote = writeBatch(db);
  lote.set(doc(db, PROGRAMACAO_DIARIA_COLECAO, data), {
    motoristas: itens, encerradoEm: serverTimestamp(), encerradoPorEmail: usuario.email
  });
  itens.forEach(item => lote.delete(doc(db, STATUS_CARGA_COLECAO, item.placa)));
  await lote.commit();
}

/** Lê o snapshot de um dia já encerrado — devolve `null` se esse dia nunca foi encerrado. */
async function getProgramacaoDiaria(data) {
  const snap = await getDoc(doc(db, PROGRAMACAO_DIARIA_COLECAO, data));
  return snap.exists() ? snap.data() : null;
}

/* ============================================================
 * OBSERVAÇÃO — AUDITORIA DE EMBARQUES (2026-09-24, pedido da usuária)
 * ------------------------------------------------------------
 * 1 doc por CHAVE REAL: número do embarque no Indicador de Frete (a maioria dos casos), ou
 * Placa+Data (mesma `chave` de DataStore.calcularAuditoriaEmbarques, data.js) quando o grupo não
 * tem nenhum embarque ("Não Criado") — nunca um índice de linha, que mudaria sozinho se a ordem
 * dos embarques do grupo mudasse numa reextração futura. Mesma coleção "simples" (getDocs 1x no
 * boot, sem onSnapshot) de CLIENTES_OBSERVACAO_DESCARGA_COLECAO acima — essa tela já recalcula
 * tudo em memória a cada render, sem tempo real; ver DataStore/dashboard.js pro resto do
 * cruzamento. Sem controle de permissão próprio (diferente de Manifesto/Cargas/Valor Descarga):
 * a tela inteira já é assim, qualquer usuário logado que a vê também edita a Observação.
 * ============================================================ */
const AUDITORIA_EMBARQUES_OBSERVACAO_COLECAO = 'auditoriaEmbarquesObservacoes';

async function getObservacoesAuditoriaEmbarques() {
  const snapshot = await getDocs(collection(db, AUDITORIA_EMBARQUES_OBSERVACAO_COLECAO));
  const porChave = {};
  snapshot.forEach(docSnap => { porChave[docSnap.id] = docSnap.data(); });
  return porChave;
}

async function salvarObservacaoAuditoriaEmbarques(chave, observacao) {
  const usuario = auth.currentUser;
  if (!usuario) throw new Error('Sem usuário logado — não é possível salvar.');
  const chaveDoc = String(chave || '').trim();
  if (!chaveDoc) throw new Error('Registro sem chave — não é possível salvar a Observação.');
  await setDoc(doc(db, AUDITORIA_EMBARQUES_OBSERVACAO_COLECAO, chaveDoc), {
    observacao: observacao || '',
    atualizadoPorEmail: usuario.email,
    atualizadoEm: serverTimestamp()
  }, { merge: true });
}

window.Firebase = {
  auth, db, createUser, signIn, signOutUser, sendPasswordReset, onAuthChange, garantirPerfilUsuario,
  getAgendamentosManuais, salvarAgendamentoManual, salvarAgendamentoManualPedido, salvarObservacaoNota,
  getValoresDescargaAprovados, salvarValorDescargaAprovado, salvarAjudanteEntrega, salvarQtdAjudante, salvarNecessitaAjudante,
  getClientesNecessitamAjudante, salvarClienteNecessitaAjudante,
  getClientesObservacaoDescarga, salvarClienteObservacaoDescarga,
  getUsuarios, definirPermissaoEdicaoAgendamento, getMinhaPermissaoEdicaoAgendamento,
  definirPermissaoEdicaoManifesto, definirPermissaoEdicaoValorDescarga, getMinhaPermissaoEdicaoValorDescarga,
  definirPermissaoEdicaoCargas, definirPermissaoGerenciarDisponibilidade, getMinhasPermissoesCargas,
  normalizarPlaca, getMotoristas, assinarMotoristas, sincronizarMotoristas, cadastrarMotorista, desativarMotorista,
  assinarStatusCarga, definirStatusCarga, retirarStatusCarga, ativarStatusCarga, autoPopularSeparacaoNaoIniciada,
  atualizarHoraLimiteCarregamento,
  atualizarRotaStatusCarga, atualizarTransportadoraStatusCarga, atualizarObservacaoStatusCarga, definirPlacaMotorista,
  assinarStatusCargaNoShow, marcarNoShowStatusCarga, atualizarMotivoNoShow, getStatusCargaHistoricoRecente,
  assinarDisponibilidade, encerrarDisponibilidade, atualizarDisponibilidadesEmLote, moverDisponibilidadeParaSeparacao,
  assinarAvisoMotoristas, enviarAvisoMotoristas, removerAvisoMotoristas, assinarAvisoMotoristasHistorico,
  encerrarDiaControleCargas, getProgramacaoDiaria,
  getObservacoesAuditoriaEmbarques, salvarObservacaoAuditoriaEmbarques
};
window.dispatchEvent(new Event('firebase-ready'));
