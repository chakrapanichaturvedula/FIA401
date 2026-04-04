/* ============================================================
   app.js — DerivativesLab FIA 401 Shared Application Logic
   Covers: session mgmt · gradebook · unlock system · nav · quiz
   ============================================================ */

'use strict';

/* ─── CONSTANTS ─────────────────────────────────────────────── */
const APPS_SCRIPT_URL =
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
  saveSession(studentId) {
    const payload = { id: studentId, ts: Date.now() };
    localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
  },

  /** Return session object or null if expired / missing */
  getSession() {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (Date.now() - s.ts > SESSION_TTL) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return s;
    } catch (e) { return null; }
  },

  /** Redirect to login if no valid session. Call at top of every protected page. */
  requireSession() {
    const s = this.getSession();
    if (!s) { window.location.href = 'index.html'; return null; }
    return s;
  },

  /** Logout */
  logout() {
    localStorage.removeItem(SESSION_KEY);
    window.location.href = 'index.html';
  },

  /* ── UNLOCK SYSTEM ──────────────────────────────────────── */

  /** Read current unlock map from localStorage (instructor writes this) */
  getUnlock() {
    try {
      const raw = localStorage.getItem('dlabUnlock');
      if (!raw) return { ...DEFAULT_UNLOCK };
      return { ...DEFAULT_UNLOCK, ...JSON.parse(raw) };
    } catch (e) { return { ...DEFAULT_UNLOCK }; }
  },

  /** Write unlock map (instructor dashboard only) */
  setUnlock(map) {
    localStorage.setItem('dlabUnlock', JSON.stringify(map));
  },

  /** Check if a specific subsection key like '2.1' is unlocked */
  isUnlocked(key) {
    return !!this.getUnlock()[key];
  },

  /**
   * Unlock / lock a single subsection. Used from dashboard.
   * @param {string} key   e.g. '2.1'
   * @param {boolean} val  true = unlock
   */
  setSection(key, val) {
    const map = this.getUnlock();
    map[key] = !!val;
    this.setUnlock(map);
  },

  /** Unlock an entire section (all subsections starting with prefix) */
  unlockSection(prefix) {
    const map = this.getUnlock();
    Object.keys(map).forEach(k => {
      if (k.startsWith(prefix + '.')) map[k] = true;
    });
    this.setUnlock(map);
  },

  /* ── GRADEBOOK (JSONP via Google Apps Script) ───────────── */

  /**
   * Fire-and-forget gradebook event.
   * @param {string} action  e.g. 'MODULE_OPEN', 'QUIZ_SUBMIT', 'ASSIGNMENT_ATTEMPT'
   * @param {object} data    Additional fields merged into the payload
   */
  track(action, data = {}) {
    const s = this.getSession();
    if (!s) return;
    const payload = {
      action,
      studentId: s.id,
      classKey: CLASS_KEY,
      timestamp: new Date().toISOString(),
      ...data
    };
    this._callAppsScript(payload);
  },

  /** Raw JSONP call — internal use */
  _callAppsScript(payload) {
    const cb = 'dlabCb_' + Date.now();
    const params = new URLSearchParams({ ...payload, callback: cb });
    const script = document.createElement('script');
    script.src = APPS_SCRIPT_URL + '?' + params.toString();
    // Self-clean after 10 s
    const cleanup = () => { script.remove(); delete window[cb]; };
    window[cb] = (resp) => { console.log('[DLab GS]', resp); cleanup(); };
    script.onerror = cleanup;
    setTimeout(cleanup, 10000);
    document.head.appendChild(script);
  },

  /* ── NAVIGATION RENDER ───────────────────────────────────── */

  /**
   * Inject the shared nav bar into an element.
   * @param {string} activeHref  href of the current page (highlights active link)
   * @param {string} containerId DOM id to inject into (default 'nav-root')
   */
  renderNav(activeHref = '', containerId = 'nav-root') {
    const s = this.getSession();
    const sid = (s && s.id) ? s.id : null;   // guard against undefined id
    const links = [
      { href: 'course.html',      label: 'Home'        },
      { href: 'tools.html',       label: 'Calculators' },
      { href: 'assignments.html', label: 'Assignments'  },
    ];
    const linksHtml = links.map(l => {
      const active = l.href === activeHref ? ' active' : '';
      return `<a href="${l.href}" class="nav-link${active}">${l.label}</a>`;
    }).join('');
    const studentHtml = sid
      ? `<span class="nav-student">${sid}</span>
         <button class="nav-btn" onclick="DLab.logout()">Sign out</button>`
      : `<button class="nav-btn" onclick="DLab.logout()">Sign out</button>`;
    const html = `
      <nav class="dl-nav">
        <a href="course.html" class="nav-logo">
          <span class="nav-logo-icon">◈</span>
          <span class="nav-logo-text">Derivatives<span>Lab</span></span>
        </a>
        <div class="nav-links">${linksHtml}</div>
        <div class="nav-right">${studentHtml}</div>
      </nav>`;
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = html;
  },

  /* ── LEFT SIDEBAR MODULE TREE ───────────────────────────── */

  /**
   * Render the left-sidebar module tree.
   * Locked items get .locked class; active item gets .active.
   * @param {string} activePage  current subsection id e.g. '2.1'
   * @param {string} containerId
   */
  renderSidebar(activePage = '', containerId = 'sidebar-tree') {
    const unlock = this.getUnlock();

    // Section colour tokens matching styles.css --c1 … --c5
    const COLORS = {
      '1': { fg: 'var(--c1)', bg: 'var(--c1-bg)' },
      '2': { fg: 'var(--c2)', bg: 'var(--c2-bg)' },
      '3': { fg: 'var(--c3)', bg: 'var(--c3-bg)' },
      '4': { fg: 'var(--c4)', bg: 'var(--c4-bg)' },
      '5': { fg: 'var(--c5)', bg: 'var(--c5-bg)' },
    };

    const sections = [
      { id: '1', label: 'Derivative Basics', subs: [
        { id: '1.1', label: 'Markets, Longs & Shorts', href: 's1-1.html' },
        { id: '1.2', label: 'Trader Types',             href: 's1-2.html' },
      ]},
      { id: '2', label: 'Futures', subs: [
        { id: '2.1', label: 'Futures Mechanics',   href: 's2-1.html' },
        { id: '2.2', label: 'Futures Pricing',     href: 's2-2.html' },
        { id: '2.3', label: 'Currency Futures',    href: 's2-3.html' },
        { id: '2.4', label: 'Hedging Strategies',  href: 's2-4.html' },
      ]},
      { id: '3', label: 'Options', subs: [
        { id: '3.1', label: 'Option Basics',      href: 's3-1.html' },
        { id: '3.2', label: 'Option Strategies',  href: 's3-2.html' },
        { id: '3.3', label: 'Option Pricing',     href: 's3-3.html' },
        { id: '3.4', label: 'Volatility',         href: 's3-4.html' },
      ]},
      { id: '4', label: 'Greeks', subs: [
        { id: '4.1', label: 'Delta & Gamma',      href: 's4-1.html' },
        { id: '4.2', label: 'Theta, Vega & Rho',  href: 's4-2.html' },
        { id: '4.3', label: 'Delta Neutrality',   href: 's4-3.html' },
      ]},
      { id: '5', label: 'Simulation & Valuation', subs: [
        { id: '5.1', label: 'Monte Carlo Simulation', href: 's5-1.html' },
      ]},
    ];

    const html = sections.map(sec => {
      const col = COLORS[sec.id] || {};
      const titleStyle = `style="color:${col.fg};border-left:3px solid ${col.fg};padding-left:15px;"`;

      const subItems = sec.subs.map(sub => {
        const locked = !unlock[sub.id];
        const active = sub.id === activePage;

        // Build class list using the actual styles.css classes
        let cls = 'sb-item';
        if (locked)  cls += ' sb-locked';

        // Active style: matching section colour
        const activeStyle = active
          ? `style="border-left-color:${col.fg};background:${col.bg};color:${col.fg};font-weight:600;"`
          : '';

        if (locked) {
          return `<div class="${cls}" ${activeStyle}>
            <span class="sb-dot"></span>
            ${sub.id} ${sub.label}
            <span class="sb-lock">🔒</span>
          </div>`;
        }
        return `<a href="${sub.href}" class="${cls}${active ? ' sb-active' : ''}" ${activeStyle}>
          <span class="sb-dot"></span>
          ${sub.id} ${sub.label}
        </a>`;
      }).join('');

      return `<div class="sb-section">
        <div class="sb-section-title" ${titleStyle}>${sec.label}</div>
        ${subItems}
      </div>`;
    }).join('');

    const el = document.getElementById(containerId);
    if (el) el.innerHTML = html;
  },

  /* ── QUIZ ENGINE ─────────────────────────────────────────── */

  /**
   * Initialise an MCQ quiz block.
   * HTML expected:
   *   <div class="quiz-block" data-quiz-id="q1">
   *     <p class="quiz-q">Question text?</p>
   *     <ul class="quiz-opts">
   *       <li data-correct="true">Right answer</li>
   *       <li>Wrong A</li>
   *       <li>Wrong B</li>
   *     </ul>
   *     <div class="quiz-feedback"></div>
   *   </div>
   *
   * @param {string} blockId  CSS selector or 'all' to init all .quiz-block
   * @param {object} opts     { trackGradebook: true, sectionId: '2.1' }
   */
  initQuiz(selector = '.quiz-block', opts = {}) {
    document.querySelectorAll(selector).forEach(block => {
      const opts_ul = block.querySelector('.quiz-opts');
      const feedback = block.querySelector('.quiz-feedback');
      if (!opts_ul || !feedback) return;
      let answered = false;

      opts_ul.querySelectorAll('li').forEach(li => {
        li.addEventListener('click', () => {
          if (answered) return;
          answered = true;
          const correct = li.dataset.correct === 'true';

          // Mark all options
          opts_ul.querySelectorAll('li').forEach(o => {
            o.classList.remove('opt-correct','opt-wrong');
            if (o.dataset.correct === 'true') o.classList.add('opt-correct');
          });
          if (!correct) li.classList.add('opt-wrong');

          // Feedback
          feedback.classList.remove('fb-correct','fb-wrong');
          feedback.classList.add(correct ? 'fb-correct' : 'fb-wrong');
          feedback.textContent = correct
            ? (block.dataset.feedbackCorrect || '✓ Correct!')
            : (block.dataset.feedbackWrong   || '✗ Not quite — see highlighted answer.');
          feedback.style.display = 'block';

          // Track
          if (opts.trackGradebook !== false) {
            DLab.track('QUIZ_SUBMIT', {
              quizId: block.dataset.quizId || 'unknown',
              section: opts.sectionId || '',
              correct: correct ? 1 : 0
            });
          }
        });
      });
    });
  },

  /* ── PRACTICE PROBLEM ENGINE ─────────────────────────────── */

  /**
   * Bind a numeric practice problem with tolerance checking.
   * HTML expected:
   *   <div class="practice-block" data-answer="47.31" data-tol="0.05" data-section="2.2">
   *     <input class="answer-input" type="number" />
   *     <button class="check-btn">Check</button>
   *     <div class="feedback-box"></div>
   *     <div class="steps-panel" style="display:none">...</div>
   *     <button class="steps-btn">Show steps</button>
   *   </div>
   */
  initPractice(selector = '.practice-block') {
    document.querySelectorAll(selector).forEach(block => {
      const input    = block.querySelector('.answer-input');
      const checkBtn = block.querySelector('.check-btn');
      const fb       = block.querySelector('.feedback-box');
      const steps    = block.querySelector('.steps-panel');
      const stepsBtn = block.querySelector('.steps-btn');
      if (!input || !checkBtn) return;

      const answer = parseFloat(block.dataset.answer);
      const tol    = parseFloat(block.dataset.tol || '0.01');
      let attempted = false;

      checkBtn.addEventListener('click', () => {
        const val = parseFloat(input.value);
        if (isNaN(val)) { fb.textContent = 'Please enter a number.'; fb.style.display='block'; return; }
        const correct = Math.abs(val - answer) <= tol;   // tol is absolute (e.g. ±10)
        fb.className = 'feedback-box ' + (correct ? 'fb-correct' : 'fb-wrong');
        fb.textContent = correct
          ? `✓ Correct! (${answer})`
          : `✗ Your answer: ${val}. Expected: ${answer.toFixed(4)}. Try again or show steps.`;
        fb.style.display = 'block';

        if (!attempted) {
          attempted = true;
          DLab.track('ASSIGNMENT_ATTEMPT', {
            problemId: block.dataset.problemId || 'unknown',
            section: block.dataset.section || '',
            correct: correct ? 1 : 0,
            answer: val
          });
        }
      });

      if (stepsBtn && steps) {
        stepsBtn.addEventListener('click', () => {
          const open = steps.style.display !== 'none';
          steps.style.display = open ? 'none' : 'block';
          stepsBtn.textContent = open ? 'Show steps' : 'Hide steps';
        });
      }

      // Allow Enter key
      input.addEventListener('keydown', e => { if (e.key === 'Enter') checkBtn.click(); });
    });
  },

  /* ── UTILITY ─────────────────────────────────────────────── */

  /** Breadcrumb helper */
  setBreadcrumb(items) {
    // items: [{label, href}, ...]  last item = current (no href)
    const el = document.getElementById('breadcrumb');
    if (!el) return;
    el.innerHTML = items.map((it, i) => {
      if (i === items.length - 1) return `<span class="bc-current">${it.label}</span>`;
      return `<a href="${it.href}" class="bc-link">${it.label}</a>`;
    }).join(' <span class="bc-sep">›</span> ');
  },

  /** Inject page-open tracking on DOMContentLoaded */
  trackPageOpen(pageId) {
    window.addEventListener('DOMContentLoaded', () => {
      DLab.track('MODULE_OPEN', { pageId });
    });
  },

  /** Simple toast notification */
  toast(msg, type = 'info', duration = 3000) {
    const t = document.createElement('div');
    t.className = `dlab-toast toast-${type}`;
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('toast-show'));
    setTimeout(() => { t.classList.remove('toast-show'); setTimeout(() => t.remove(), 300); }, duration);
  }

};

/* ─── CSS for toast (injected at runtime) ───────────────────── */
(function injectToastStyles() {
  if (document.getElementById('dlab-toast-css')) return;
  const s = document.createElement('style');
  s.id = 'dlab-toast-css';
  s.textContent = `
    .dlab-toast {
      position: fixed; bottom: 24px; right: 24px; z-index: 9999;
      padding: 12px 20px; border-radius: 8px; font-size: .875rem;
      font-family: var(--font-sans, Inter, sans-serif);
      box-shadow: 0 4px 16px rgba(0,0,0,.15);
      opacity: 0; transform: translateY(8px);
      transition: opacity .25s, transform .25s;
      max-width: 320px;
    }
    .dlab-toast.toast-show { opacity: 1; transform: none; }
    .dlab-toast.toast-info    { background: #152744; color: #fff; }
    .dlab-toast.toast-success { background: #2D6A4F; color: #fff; }
    .dlab-toast.toast-error   { background: #c0392b; color: #fff; }
  `;
  document.head.appendChild(s);
})();

/* ─── EXPOSE GLOBALLY ────────────────────────────────────────── */
window.DLab = DLab;
