(function () {
  'use strict';

  const cfg = window.DLabConfig || {};
  const firebaseConfig = cfg.firebase || {};
  const authCfg = cfg.auth || {};
  const SESSION_TTL = 24 * 60 * 60 * 1000;

  function isConfigured() {
    return !!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.authDomain);
  }

  function normalise(value) {
    return String(value || '').trim().toLowerCase();
  }

  function isEmail(value) {
    return normalise(value).includes('@');
  }

  function getDomain(email) {
    return normalise(email).split('@')[1] || '';
  }

  function normaliseStudent(doc, docId) {
    if (!doc) return null;
    return {
      uid: doc.uid || '',
      studentId: doc.studentId || doc.enrollmentId || doc.id || docId || '',
      enrollmentId: doc.enrollmentId || doc.studentId || doc.id || docId || '',
      name: doc.name || '',
      email: normalise(doc.email),
      active: doc.active !== false,
      role: doc.role || 'student'
    };
  }

  async function ensureAnonymousAuth() {
    if (!window.firebase || !firebase.auth) {
      throw new Error('Firebase auth library is not available.');
    }
    const current = firebase.auth().currentUser;
    if (current) return current;
    const result = await firebase.auth().signInAnonymously();
    return result.user;
  }

  async function lookupRoster(identifier) {
    const db = firebase.firestore();
    const collection = authCfg.rosterCollection || 'students';
    const value = String(identifier || '').trim();
    const clean = normalise(value);
    let snapshot;

    if (isEmail(value)) {
      snapshot = await db
        .collection(collection)
        .where('email', '==', clean)
        .limit(1)
        .get();
    } else {
      snapshot = await db
        .collection(collection)
        .where('studentId', '==', value.toUpperCase())
        .limit(1)
        .get();

      if (snapshot.empty) {
        const doc = await db.collection(collection).doc(value.toUpperCase()).get();
        if (doc.exists) {
          return normaliseStudent(doc.data(), doc.id);
        }
      }
    }

    if (snapshot.empty) return null;
    return normaliseStudent(snapshot.docs[0].data(), snapshot.docs[0].id);
  }

  async function signInStudentWithRoster(identifier) {
    if (!isConfigured()) throw new Error('Firebase config is incomplete.');
    const trimmed = String(identifier || '').trim();
    if (!trimmed) {
      throw new Error('Enter your student ID or institute email.');
    }

    await ensureAnonymousAuth();
    const rosterEntry = await lookupRoster(trimmed);
    if (!rosterEntry || rosterEntry.active === false) {
      throw new Error('Your student record is not enabled in the course roster yet.');
    }

    const allowedDomain = authCfg.studentEmailDomain || 'imthyderabad.edu.in';
    if (rosterEntry.email && getDomain(rosterEntry.email) !== allowedDomain.toLowerCase()) {
      throw new Error(`Roster email must use @${allowedDomain}.`);
    }

    const currentUser = firebase.auth().currentUser;
    const payload = {
      id: rosterEntry.studentId,
      enrollId: rosterEntry.enrollmentId || rosterEntry.studentId,
      studentId: rosterEntry.studentId,
      name: rosterEntry.name || rosterEntry.studentId,
      email: rosterEntry.email,
      uid: currentUser ? currentUser.uid : '',
      provider: 'roster',
      role: rosterEntry.role || 'student',
      ts: Date.now(),
      expires: Date.now() + SESSION_TTL
    };

    localStorage.setItem('dlabSession', JSON.stringify(payload));
    return payload;
  }

  async function signOutEverywhere() {
    try {
      localStorage.removeItem('dlabSession');
      if (window.firebase && firebase.auth) {
        await firebase.auth().signOut();
      }
    } catch (error) {
      console.warn('Firebase sign-out warning:', error);
    }
  }

  window.DLabFirebase = {
    isConfigured,
    lookupRoster,
    signInStudentWithRoster,
    signOutEverywhere
  };
})();
