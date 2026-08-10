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
  updateProfile
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import {
  getFirestore,
  doc,
  setDoc,
  serverTimestamp
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

/** Cria a conta no Authentication, define o nome e grava um perfil básico no Firestore. */
async function createUser(email, password, nome) {
  const credential = await createUserWithEmailAndPassword(auth, email, password);
  await updateProfile(credential.user, { displayName: nome });
  // Gravação do perfil no Firestore é "melhor esforço": roda em segundo plano, sem `await`,
  // pra nunca travar o cadastro se o Firestore ainda não estiver criado/configurado.
  setDoc(doc(db, 'users', credential.user.uid), {
    nome,
    email,
    criadoEm: serverTimestamp()
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

window.Firebase = { auth, db, createUser, signIn, signOutUser, sendPasswordReset, onAuthChange };
window.dispatchEvent(new Event('firebase-ready'));
