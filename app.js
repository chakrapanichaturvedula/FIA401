/* ============================================================
   app.js — DerivativesLab FIA 401 Shared Application Logic
   Covers: session mgmt · gradebook · unlock system · nav · quiz
   ============================================================ */

'use strict';

/* ─── CONSTANTS ──────────────────────────────────────────────── */
const APPS_SCRIPT_URL =
  (window.DLabConfig &&
    window.DLabConfig.backend &&
    window.DLabConfig.backend.legacyAppsScriptUrl) ||
  'https://script.google.com/macros/s/AKfycbxxPNgz_A3qUPdQXkRglL_GCg3R9Nr_HxA6GF5yitb5TffLE3xI0Rl3rFBuOdBUevUFUQ/exec';
const CLASS_KEY  = 'IMTFD26';
const VALID_IDS  = ['26A1HP013','26A1HP085','26A1HP153','26A3HP640','26A1HP215'];
const SESSION_KEY = 'dlabSession';
const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 hours

/* ─── INSTRUCTOR UNLOCK CONFIG ──────────────────────────────── *
 *  Instructor toggles sections from Dashboard (dashboard.html)   *
 *  which writes to localStorage key 'dlabUnlock'.               *
 *  Fall-back default: only 1.1 open for demo.                   *
 * ─────────────────────────────────────────────────────────── */
const DEFAULT_UNLOCK = {
  '1.1': true,  '1.2': false,
  '2.1': false, '2.2': false, '2.3': false, '2.4': false,
  '3.1': false, '3.2': false, '3.3': false, '3.4': false,
  '4.1': false, '4.2': false, '4.3': false,
  '5.1': false
};

const DLab = {

  /* ── SESSION ─────────────────────────────────────────────── */

  /** Save session after successful login */
  saveSession(studentId, extras = {}) {
    const payload = typeof studentId === 'object'
      ? { ts: Date.now(), ...studentId }
      : {
          id: studentId,
          enrollId: studentId,
          studentId: studentId,
          ts: Date.now(),
          expires: Date.now() + SESSION_TTL,
          ...extras
        };
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  },

  /** Return session object or null if expired / missing */
  getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      const expiryTs = s.expires || (s.ts + SESSION_TTL);
      if (Date.now() > expiryTs) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return s;
    } catch (e) { return null; }
  },

  /** Redirect to login if no valid session. Call at top of every protected page. */
  requireSession() {
    const s = this.getSession();
    if (!s) { window.location.href = 'student-access.html'; return null; }
    return s;
  },

  /** Logout */
  logout() {
    localStorage.removeItem(SESSION_KEY);
    if (window.DLabFirebase && typeof window.DLabFirebase.signOutEverywhere === 'function') {
      window.DLabFirebase.signOutEverywhere().finally(() => {
        window.location.href = 'student-access.html';
      });
      return;
    }
    window.location.href = 'student-access.html';
  },
