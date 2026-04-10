(function () {
  'use strict';

  const cfg = window.DLabConfig || {};
  const firebaseConfig = cfg.firebase || {};
  const authCfg = cfg.auth || {};
  const SESSION_TTL = 24 * 60 * 60 * 1000;

  function isConfigured() {
    return !!(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.authDomain);
  }

  function getDomain(email) {
    return String(email || '').split('@')[1] || '';
  }

  function normaliseStudent(doc) {
    if (!doc) return null;
    return {
      uid: doc.uid || '',
      studentId: doc.studentId || doc.enrollmentId || doc.id || '',
      enrollmentId: doc.enrollmentId || doc.studentId || doc.id || '',
      name: doc.name || '',
      email: doc.email || '',
      active: doc.active !== false,
      role: doc.role || 'student'
    };
  }

  async function lookupRosterByEmail(email) {
    const db = firebase.firestore();
    const collection = authCfg.rosterCollection || 'students';
    const snapshot = await db
      .collection(collection)
      .where('email', '==', String(email || '').toLowerCase())
      .limit(1)
      .get();

    if (snapshot.empty) return null;
    return normaliseStudent(snapshot.docs[0].data());
  }

  async function signInStudentWithGoogle() {
    if (!isConfigured()) throw new Error('Firebase config is incomplete.');

    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({
      hd: authCfg.studentEmailDomain || 'imthyderabad.edu.in',
      prompt: 'select_account'
    });

    const result = await firebase.auth().signInWithPopup(provider);
    const user = result.user;
    if (!user || !user.email) throw new Error('Google sign-in did not return an email address.');

    const allowedDomain = authCfg.studentEmailDomain || 'imthyderabad.edu.in';
    if (getDomain(user.email).toLowerCase() !== allowedDomain.toLowerCase()) {
      await firebase.auth().signOut();
      throw new Error(`Please sign in with your institute email (@${allowedDomain}).`);
    }

    const rosterEntry = await lookupRosterByEmail(user.email);
    if (!rosterEntry || rosterEntry.active === false) {
      await firebase.auth().signOut();
      throw new Error('Your institute email is not yet enabled for this course roster.');
    }

    const payload = {
      id: rosterEntry.studentId,
      enrollId: rosterEntry.enrollmentId || rosterEntry.studentId,
      studentId: rosterEntry.studentId,
      name: rosterEntry.name || user.displayName || rosterEntry.studentId,
      email: String(user.email || '').toLowerCase(),
      uid: user.uid,
      provider: 'google',
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
    lookupRosterByEmail,
    signInStudentWithGoogle,
    signOutEverywhere
  };
})();