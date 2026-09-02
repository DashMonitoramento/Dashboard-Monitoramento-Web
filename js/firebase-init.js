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
  getFirestore,
  doc,
  getDoc,
  setDoc,
  updateDoc,
  serverTimestamp,
  collection,
  getDocs
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
const db = getFirestore(app);

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
    podeEditarManifesto: false
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
 * de segurança do Firestore restringem essa consulta ao super admin (ver Regras no console). */
async function getUsuarios() {
  const snapshot = await getDocs(collection(db, 'users'));
  const lista = [];
  snapshot.forEach(docSnap => {
    const d = docSnap.data();
    lista.push({
      uid: docSnap.id,
      nome: d.nome || d.email || docSnap.id,
      email: d.email || '',
      podeEditarAgendamento: !!d.podeEditarAgendamento,
      podeEditarManifesto: !!d.podeEditarManifesto
    });
  });
  return lista;
}

/** Habilita/desabilita a edição de agendamento de um usuário específico. */
async function definirPermissaoEdicaoAgendamento(uid, pode) {
  await updateDoc(doc(db, 'users', uid), { podeEditarAgendamento: !!pode });
}

/** Habilita/desabilita a edição do Manifesto (Controle de Entregas) de um usuário específico —
 * mesma ideia de definirPermissaoEdicaoAgendamento acima, campo separado. Quem não tem essa
 * permissão ainda pode ABRIR o Manifesto e criar notas novas ("alimentar"), só não edita/exclui
 * as existentes nem exporta/importa — ver manifesto/index.html. */
async function definirPermissaoEdicaoManifesto(uid, pode) {
  await updateDoc(doc(db, 'users', uid), { podeEditarManifesto: !!pode });
}

/** Verifica se o usuário logado agora tem permissão de editar agendamento (chamado 1x no
 * login) — separado de getUsuarios() porque um usuário comum só pode ler o próprio perfil. */
async function getMinhaPermissaoEdicaoAgendamento() {
  const usuario = auth.currentUser;
  if (!usuario) return false;
  const snap = await getDoc(doc(db, 'users', usuario.uid));
  return snap.exists() ? !!snap.data().podeEditarAgendamento : false;
}

window.Firebase = {
  auth, db, createUser, signIn, signOutUser, sendPasswordReset, onAuthChange,
  getAgendamentosManuais, salvarAgendamentoManual, salvarAgendamentoManualPedido, salvarObservacaoNota,
  getUsuarios, definirPermissaoEdicaoAgendamento, getMinhaPermissaoEdicaoAgendamento,
  definirPermissaoEdicaoManifesto
};
window.dispatchEvent(new Event('firebase-ready'));
