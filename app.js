/* Dire Salon — public booking app (vanilla JS) */
(function () {
  'use strict';

  var TZ = 'America/New_York';
  var SLOT_START = 9, SLOT_END = 17, DAY_COUNT = 14;
  var SESSION_KEY = 'fb_pub_account';

  var STYLES = [
    { id: 'skin-fade', name: 'Signature Skin Fade', price: '$35', mins: '40 min', desc: 'Zero-blend fade with a crisp lineup', img: 'assets/style-skin-fade.jpg?v=3' },
    { id: 'taper', name: 'Classic Taper', price: '$30', mins: '30 min', desc: 'Clean sides with a natural finish', img: 'assets/style-taper.jpg?v=3' },
    { id: 'buzz', name: 'Buzz Cut', price: '$25', mins: '20 min', desc: 'Sharp and low-maintenance', img: 'assets/style-buzz.jpg?v=3' },
    { id: 'curly', name: 'Curly Top + Fade', price: '$38', mins: '45 min', desc: 'Defined curls, faded sides', img: 'assets/style-curly.jpg?v=3' },
    { id: 'beard', name: 'Beard Sculpt', price: '$20', mins: '20 min', desc: 'Razor-sharp edges, hot-towel finish', img: 'assets/style-beard.jpg?v=3' },
    { id: 'kids', name: 'Kids Cut', price: '$25', mins: '30 min', desc: 'Patient and kid-friendly, 12 & under', img: 'assets/style-kids.jpg?v=3' }
  ];
  var BIZ_ADDR = '946 Sligo Ave, Silver Spring, MD 20910';
  var GARAGE_ADDR = '8100 Fenton St, Silver Spring, MD 20910';
  var MAPS_URL = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(BIZ_ADDR);

  /* ---------- helpers ---------- */
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function digitsOnly(s) { return (s || '').replace(/\D/g, ''); }
  function normEmail(s) { return (s || '').trim().toLowerCase(); }

  // Eastern (shop-local) calendar helpers
  function tzDateStr(iso) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  }
  function tzHHMM(iso) {
    return new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
  }
  function todayStr() { return tzDateStr(new Date().toISOString()); }
  function addDaysStr(dateStr, days) {
    var p = dateStr.split('-').map(Number);
    var d = new Date(p[0], p[1] - 1, p[2]);
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function nyOffsetMinutes(date) {
    var utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
    var ny = new Date(date.toLocaleString('en-US', { timeZone: TZ })).getTime();
    return (ny - utc) / 60000;
  }
  // Eastern wall time -> UTC ISO
  function wallToISO(dateStr, hhmm) {
    var dp = dateStr.split('-').map(Number), tp = hhmm.split(':').map(Number);
    var guess = new Date(Date.UTC(dp[0], dp[1] - 1, dp[2], tp[0], tp[1]));
    return new Date(guess.getTime() - nyOffsetMinutes(guess) * 60000).toISOString();
  }
  function formatLong(dateStr) {
    return new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function formatTime(hhmm) {
    var p = hhmm.split(':').map(Number);
    var ap = p[0] >= 12 ? 'PM' : 'AM';
    var h = p[0] % 12 === 0 ? 12 : p[0] % 12;
    return h + ':' + pad(p[1]) + ' ' + ap;
  }
  function apptWhen(iso) {
    var d = new Date(iso);
    var datePart = new Intl.DateTimeFormat(undefined, { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(d);
    var timePart = new Intl.DateTimeFormat(undefined, { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(d);
    return datePart + ' · ' + timePart;
  }
  function buildSlots() {
    var out = [];
    for (var h = SLOT_START; h <= SLOT_END; h++) { out.push(pad(h) + ':00'); out.push(pad(h) + ':30'); }
    return out;
  }
  var SLOTS = buildSlots();

  /* ---------- crypto / session ---------- */
  function randomSalt() {
    var b = new Uint8Array(16);
    (window.crypto || window.msCrypto).getRandomValues(b);
    return Array.prototype.map.call(b, function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
  }
  function sha256Hex(str) {
    var data = new TextEncoder().encode(str);
    return crypto.subtle.digest('SHA-256', data).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (x) { return ('0' + x.toString(16)).slice(-2); }).join('');
    });
  }
  function saveSession(acct) {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(acct)); } catch (e) {}
  }
  function readSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }
  function clearSession() {
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
  }

  /* ---------- api ---------- */
  var ERRORS = {
    duplicate: 'This email or phone number already has a booking on that day.',
    exists: 'An account with this email already exists. Sign in — or use "Forgot password?" below if you don\'t remember it.',
    badcode: 'That code is wrong or expired. Request a new one and try again.',
    noaccount: 'No account found for this email. Please sign up first.',
    badpassword: 'Incorrect password. Please try again.',
    taken: 'That time was just taken. Please pick another.',
    forbidden: 'Request was rejected. Please reload and try again.'
  };
  function apiError(data) {
    var e = data && data.error;
    if (!e) return 'Request failed. Please try again.';
    if (typeof e === 'object') return e.message || 'Request failed. Please try again.';
    return ERRORS[e] || e;
  }
  function api(action, params) {
    params = params || {};
    var payload = { action: action, key: FB_CONFIG.apiKey };
    for (var k in params) { if (Object.prototype.hasOwnProperty.call(params, k)) payload[k] = params[k]; }
    return fetch(FB_CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload)
    }).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) {
        if (!res.ok) throw new Error(apiError(data));
        return data;
      });
    });
  }

  /* ---------- state ---------- */
  var S = {
    view: 'home', step: 1,
    date: addDaysStr(todayStr(), 1), time: '', taken: [], loadingSlots: false,
    selectedStyle: '', error: '', submitting: false,
    confirm: null,
    account: readSession(),
    authMode: 'signin', authError: '', authBusy: false,
    forgot: null,
    bookings: [], bookingsLoading: false, bookingsError: '',
    resched: null,
    admin: null,
    quickBusy: false, quickError: '', quickDone: false
  };

  function styleById(id) {
    for (var i = 0; i < STYLES.length; i++) if (STYLES[i].id === id) return STYLES[i];
    return null;
  }
  function slotDisabled(slot, dateStr, taken) {
    if (taken.indexOf(slot) >= 0) return true;
    if (dateStr === todayStr() && slot <= tzHHMM(new Date().toISOString())) return true;
    return false;
  }

  /* ---------- public actions ---------- */
  var App = {
    goHome: function () { S.view = 'home'; S.step = 1; S.error = ''; S.resched = null; render(); window.scrollTo(0, 0); },
    goBooking: function (styleId) {
      S.view = 'booking'; S.step = 1; S.error = '';
      if (styleId) S.selectedStyle = styleId;
      S.date = addDaysStr(todayStr(), 1); S.time = '';
      render(); window.scrollTo(0, 0);
      loadTaken();
    },
    goAuth: function (mode) {
      S.view = 'auth'; S.authMode = mode || 'signin'; S.authError = ''; S.authBusy = false;
      render(); window.scrollTo(0, 0);
    },
    goMyBookings: function () {
      if (!S.account) { App.goAuth('signin'); return; }
      S.view = 'mybookings'; S.bookingsError = ''; S.resched = null;
      render(); window.scrollTo(0, 0);
      loadBookings();
    },
    signOut: function () {
      clearSession(); S.account = null; S.bookings = []; S.resched = null;
      App.goHome();
    },
    goAdmin: function () {
      S.view = 'admin'; S.admin = S.admin || { authed: false };
      render(); window.scrollTo(0, 0);
    },
    adminLogin: function () {
      var email = normEmail(val('ad-email'));
      var pw = val('ad-pw');
      S.admin = S.admin || {};
      if (!email || email.indexOf('@') < 0) { S.admin.error = 'Please enter your email address.'; render(); return false; }
      if (!pw) { S.admin.error = 'Please enter your password.'; render(); return false; }
      S.admin.busy = true; S.admin.error = ''; render();
      api('salt', { email: email }).then(function (r) {
        if (!r.salt) throw new Error('No account found for this email.');
        return sha256Hex(r.salt + ':' + pw).then(function (hash) {
          S.admin.hash = hash; S.admin.email = email;
          return api('timesheet', { email: email, hash: hash });
        });
      }).then(function (data) {
        S.admin.busy = false; S.admin.loading = false;
        if (!data || !data.ok) throw new Error('Not authorized.');
        S.admin.authed = true; S.admin.sheet = data.bookings || [];
        S.admin.tab = 'upcoming'; S.admin.q = ''; S.admin.dateF = '';
        var _now = new Date();
        S.admin.calY = _now.getFullYear(); S.admin.calM = _now.getMonth() + 1;
        S.admin.calCache = {}; S.admin.calDay = ''; S.admin.calLoading = false;
        S.admin.customers = null; S.admin.custQ = ''; S.admin.custLoading = false;
        S.admin.mailOpen = false;
        S.admin.mvOpen = false;
        render(); window.scrollTo(0, 0);
      }).catch(function (err) {
        S.admin.busy = false; S.admin.loading = false; S.admin.error = err.message; render();
      });
      return false;
    },
    adminTab: function (t) {
      var a = S.admin; if (!a || !a.authed) return;
      a.tab = t; a.error = ''; render();
      if (t === 'calendar' && !a.calCache[calKey(a.calY, a.calM)]) loadCalMonth(a, a.calY, a.calM);
      if (t === 'customers' && !a.customers) loadCustomers(a);
      window.scrollTo(0, 0);
    },
    adminRefresh: function () {
      var a = S.admin; if (!a || !a.authed) return;
      a.error = '';
      if (a.tab === 'calendar') {
        delete a.calCache[calKey(a.calY, a.calM)]; a.calLoading = false;
        loadCalMonth(a, a.calY, a.calM);
      } else if (a.tab === 'customers') {
        a.customers = null; a.custLoading = false; loadCustomers(a);
      } else {
        a.loading = true; render();
        api('timesheet', { email: a.email, hash: a.hash }).then(function (data) {
          a.loading = false;
          if (!data || !data.ok) throw new Error('Not authorized.');
          a.sheet = data.bookings || []; render();
        }).catch(function (err) { a.loading = false; a.error = err.message; render(); });
      }
    },
    adminCalNav: function (d) {
      var a = S.admin; if (!a) return;
      var m = a.calM + d, y = a.calY;
      if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
      a.calM = m; a.calY = y; a.calDay = ''; a.error = ''; render();
      loadCalMonth(a, y, m);
      var el = document.getElementById('calhead'); if (el && el.scrollIntoView) el.scrollIntoView();
    },
    adminCalDay: function (ds) {
      var a = S.admin; if (!a) return;
      a.calDay = (a.calDay === ds) ? '' : ds; render();
      var el = document.getElementById('daypanel'); if (el && el.scrollIntoView) el.scrollIntoView();
    },
    adminSearch: function (v) {
      var a = S.admin; if (!a) return;
      a.q = v;
      var el = document.getElementById('adm-list');
      if (el) el.innerHTML = upcomingListHTML(a);
    },
    adminCustQ: function (v) {
      var a = S.admin; if (!a) return;
      a.custQ = v;
      var el = document.getElementById('adm-clist');
      if (el) el.innerHTML = customersListHTML(a);
    },
    adminDateF: function (v) { var a = S.admin; if (!a) return; a.dateF = v; render(); },
    openMailer: function (btn) {
      var a = S.admin; if (!a) return;
      a.mailOpen = true;
      a.mailTo = btn.getAttribute('data-email'); a.mailName = btn.getAttribute('data-name');
      a.mailSubject = ''; a.mailBody = ''; a.mailDone = ''; a.mailError = ''; a.mailBusy = false;
      render();
    },
    closeMailer: function () { var a = S.admin; if (!a) return; a.mailOpen = false; render(); },
    sendMail: function () {
      var a = S.admin; if (!a || a.mailBusy) return;
      a.mailSubject = val('mail-subj'); a.mailBody = val('mail-body');
      if (!a.mailSubject.trim()) { a.mailError = 'Add a subject.'; render(); return; }
      if (!a.mailBody.trim()) { a.mailError = 'Write a message first.'; render(); return; }
      a.mailBusy = true; a.mailError = ''; a.mailDone = ''; render();
      api('adminemail', { email: a.email, hash: a.hash, to: a.mailTo, subject: a.mailSubject.trim(), body: a.mailBody.trim() }).then(function (data) {
        a.mailBusy = false;
        if (!data || !data.ok) throw new Error('Could not send. Please try again.');
        a.mailDone = 'Email sent to ' + (a.mailName || a.mailTo) + '.';
        a.mailSubject = ''; a.mailBody = ''; render();
      }).catch(function (err) { a.mailBusy = false; a.mailError = err.message; render(); });
    },
    openMover: function (btn) {
      var a = S.admin; if (!a) return;
      a.mvOpen = true; a.mvDone = ''; a.mvError = ''; a.mvBusy = false; a.mvLoading = false;
      a.mvId = btn.getAttribute('data-id');
      a.mvName = btn.getAttribute('data-name');
      a.mvEmail = btn.getAttribute('data-email');
      var t = btn.getAttribute('data-time');
      a.mvWhen = t ? fmtDate(t) + ' · ' + fmtTime(t) : '';
      a.mvOrigDate = t ? tzDateStr(t) : '';
      a.mvOrigHHMM = t ? tzHHMM(t) : '';
      a.mvDate = a.mvOrigDate || todayStr();
      a.mvTime = ''; a.mvTaken = [];
      render(); mvLoadSlots(a);
    },
    closeMover: function () { var a = S.admin; if (!a) return; a.mvOpen = false; render(); },
    mvDateChange: function (v) {
      var a = S.admin; if (!a) return;
      a.mvDate = v; a.mvTime = ''; a.mvError = '';
      if (isSunday(v)) { a.mvTaken = []; a.mvError = 'Closed on Sundays — pick another day.'; render(); return; }
      render(); mvLoadSlots(a);
    },
    mvPickTime: function (t) { var a = S.admin; if (!a) return; a.mvTime = t; a.mvError = ''; render(); },
    mvConfirm: function () {
      var a = S.admin; if (!a || a.mvBusy) return;
      if (!a.mvDate || isSunday(a.mvDate)) { a.mvError = 'Pick a valid date (not Sunday).'; render(); return; }
      if (!a.mvTime) { a.mvError = 'Pick a time slot.'; render(); return; }
      a.mvBusy = true; a.mvError = ''; render();
      api('adminmove', { email: a.email, hash: a.hash, id: a.mvId, time: wallToISO(a.mvDate, a.mvTime) }).then(function (data) {
        a.mvBusy = false;
        if (!data || !data.ok) throw new Error('Could not update. Please try again.');
        a.mvDone = 'Time updated — ' + (a.mvName || 'customer') + ' was emailed the new time.';
        render(); App.adminRefresh();
      }).catch(function (err) { a.mvBusy = false; a.mvError = err.message; render(); });
    },
    adminSignOut: function () { S.admin = null; App.goHome(); },
    setTab: function (mode) { S.authMode = mode; S.authError = ''; render(); },
    pickDate: function (d) { if (isSunday(d)) return; S.date = d; S.time = ''; S.error = ''; render(); loadTaken(); },
    pickTime: function (t) { S.time = t; S.error = ''; render(); },
    pickStyle: function (id) { S.selectedStyle = (S.selectedStyle === id) ? '' : id; render(); },
    clearStyle: function () { S.selectedStyle = ''; render(); },
    goDetails: function () {
      if (!S.time) { S.error = 'Pick a time slot to continue.'; render(); return; }
      S.step = 2; S.error = ''; render(); window.scrollTo(0, 0);
    },
    backToSchedule: function () { S.step = 1; S.error = ''; render(); window.scrollTo(0, 0); },
    bookAnother: function () {
      S.step = 1; S.date = addDaysStr(todayStr(), 1); S.time = ''; S.error = '';
      S.selectedStyle = ''; S.confirm = null; S.quickDone = false; S.quickError = '';
      render(); window.scrollTo(0, 0); loadTaken();
    },
    copyAddress: function () {
      try {
        var tmp = document.createElement('textarea');
        tmp.value = BIZ_ADDR; document.body.appendChild(tmp); tmp.select();
        document.execCommand('copy'); document.body.removeChild(tmp);
      } catch (e) {}
    }
  };
  window.App = App;

  /* ---------- data loading ---------- */
  function loadTaken() {
    S.loadingSlots = true; S.taken = []; render();
    api('slots', { date: S.date }).then(function (data) {
      var items = data.items || [];
      var taken = [];
      for (var i = 0; i < items.length; i++) {
        if (!items[i].Time) continue;
        if (tzDateStr(items[i].Time) === S.date) taken.push(tzHHMM(items[i].Time));
      }
      S.taken = taken; S.loadingSlots = false; render();
    }).catch(function () { S.loadingSlots = false; render(); });
  }

  function loadBookings() {
    if (!S.account) return;
    S.bookingsLoading = true; S.bookingsError = ''; render();
    api('mybookings', { email: S.account.email }).then(function (data) {
      S.bookings = (data.bookings || []).map(function (b) { b.Id = b.ID; return b; });
      S.bookingsLoading = false; render();
    }).catch(function (err) {
      S.bookingsLoading = false; S.bookingsError = err.message; render();
    });
  }

  /* ---------- booking submit ---------- */
  function val(id) { var el = document.getElementById(id); return el ? el.value : ''; }

  App.submitDetails = function () {
    var name = val('f-name').trim();
    var email = normEmail(val('f-email'));
    var phone = digitsOnly(val('f-phone'));
    if (!name) return setError('Please enter your name.');
    if (!email || email.indexOf('@') < 0) return setError('Please enter a valid email address.');
    if (phone.length < 7) return setError('Please enter a valid phone number.');
    var st = styleById(S.selectedStyle);
    S.submitting = true; S.error = ''; render();
    api('book', {
      name: name, email: email, phone: phone,
      title: st ? name + ' — ' + st.name : name,
      date: S.date,
      timeISO: wallToISO(S.date, S.time),
      style: st ? st.name : ''
    }).then(function (data) {
      S.submitting = false;
      if (!data || !data.id) throw new Error('Booking did not complete. Please try again.');
      S.confirm = {
        id: data.id, name: name, email: email, phone: phone,
        date: S.date, time: S.time, style: st ? st.name : '', stylePrice: st ? st.price : ''
      };
      S.step = 3; render(); window.scrollTo(0, 0);
    }).catch(function (err) {
      S.submitting = false; setError(err.message);
    });
    return false;
  };
  function setError(msg) { S.error = msg; render(); var ab = document.querySelector('.actionbar'); if (ab) ab.scrollIntoView(false); return false; }

  /* ---------- auth ---------- */
  App.signin = function () {
    var email = normEmail(val('a-email'));
    var pw = val('a-pw');
    if (!email || email.indexOf('@') < 0) { S.authError = 'Please enter your email address.'; render(); return false; }
    if (!pw) { S.authError = 'Please enter your password.'; render(); return false; }
    S.authBusy = true; S.authError = ''; render();
    api('salt', { email: email }).then(function (r) {
      if (!r.salt) throw new Error(ERRORS.noaccount);
      return sha256Hex(r.salt + ':' + pw).then(function (hash) {
        return api('signin', { email: email, hash: hash });
      });
    }).then(function (data) {
      S.authBusy = false;
      if (!data || !data.ok) throw new Error('Signup did not complete. Please try again.');
      S.account = { name: data.name, email: data.email, phone: data.phone };
      saveSession(S.account);
      App.goMyBookings();
    }).catch(function (err) { S.authBusy = false; S.authError = err.message; render(); });
    return false;
  };

  App.signup = function () {
    var name = val('a-name').trim();
    var email = normEmail(val('a-email'));
    var phone = digitsOnly(val('a-phone'));
    var pw = val('a-pw'), pw2 = val('a-pw2');
    if (!name) { S.authError = 'Please enter your name.'; render(); return false; }
    if (!email || email.indexOf('@') < 0) { S.authError = 'Please enter a valid email address.'; render(); return false; }
    if (phone.length < 7) { S.authError = 'Please enter a valid phone number.'; render(); return false; }
    if (pw.length < 6) { S.authError = 'Choose a password with at least 6 characters.'; render(); return false; }
    if (pw !== pw2) { S.authError = 'Passwords do not match.'; render(); return false; }
    S.authBusy = true; S.authError = ''; render();
    var salt = randomSalt();
    sha256Hex(salt + ':' + pw).then(function (hash) {
      return api('signup', { name: name, email: email, phone: phone, salt: salt, hash: hash });
    }).then(function (data) {
      S.authBusy = false;
      S.account = { name: data.name, email: data.email, phone: data.phone };
      saveSession(S.account);
      App.goMyBookings();
    }).catch(function (err) { S.authBusy = false; S.authError = err.message; render(); });
    return false;
  };

  App.quickCreate = function () {
    var pw = val('q-pw');
    if (!S.confirm) return false;
    if (pw.length < 6) { S.quickError = 'Choose a password with at least 6 characters.'; render(); return false; }
    S.quickBusy = true; S.quickError = ''; render();
    var salt = randomSalt();
    var c = S.confirm;
    sha256Hex(salt + ':' + pw).then(function (hash) {
      return api('signup', { name: c.name, email: c.email, phone: c.phone, salt: salt, hash: hash });
    }).then(function (data) {
      S.quickBusy = false; S.quickDone = true;
      if (!data || !data.ok) throw new Error('Signup did not complete. Please try again.');
      S.account = { name: data.name, email: data.email, phone: data.phone };
      saveSession(S.account);
      render();
    }).catch(function (err) { S.quickBusy = false; S.quickError = err.message; render(); });
    return false;
  };

  App.goForgot = function () {
    S.view = 'forgot'; S.forgot = { step: 'email', email: '', error: '', busy: false };
    render(); window.scrollTo(0, 0);
  };

  App.sendResetCode = function () {
    var f = S.forgot;
    var email = normEmail(val('f-email'));
    if (!email || email.indexOf('@') < 0) { f.error = 'Please enter your email address.'; render(); return false; }
    f.busy = true; f.error = ''; render();
    api('forgot', { email: email }).then(function () {
      f.busy = false; f.step = 'code'; f.email = email; render();
    }).catch(function (err) { f.busy = false; f.error = err.message; render(); });
    return false;
  };

  App.doReset = function () {
    var f = S.forgot;
    var code = val('f-code').replace(/\D/g, '');
    var pw = val('f-pw'), pw2 = val('f-pw2');
    if (code.length !== 6) { f.error = 'Enter the 6-digit code from your email.'; render(); return false; }
    if (pw.length < 6) { f.error = 'Choose a password with at least 6 characters.'; render(); return false; }
    if (pw !== pw2) { f.error = 'Passwords do not match.'; render(); return false; }
    f.busy = true; f.error = ''; render();
    var salt = randomSalt();
    sha256Hex(salt + ':' + pw).then(function (hash) {
      return api('reset', { email: f.email, code: code, salt: salt, hash: hash });
    }).then(function (data) {
      f.busy = false;
      if (!data || !data.ok) throw new Error('Password reset did not complete. Please try again.');
      f.step = 'done'; render(); window.scrollTo(0, 0);
    }).catch(function (err) { f.busy = false; f.error = err.message; render(); });
    return false;
  };

  /* ---------- my bookings ---------- */
  App.openResched = function (id) {
    var b = findBooking(id);
    if (!b) return;
    S.resched = {
      id: b.Id, title: b.Title, cur: tzHHMM(b.Time),
      date: tzDateStr(b.Time), time: '', taken: [], loading: true, error: '', busy: false
    };
    render(); window.scrollTo(0, 0);
    loadReschedTaken();
  };
  App.closeResched = function () { S.resched = null; render(); };
  App.pickReschedDate = function (d) {
    if (!S.resched || isSunday(d)) return;
    S.resched.date = d; S.resched.time = ''; S.resched.error = ''; S.resched.loading = true;
    render(); loadReschedTaken();
  };
  App.pickReschedTime = function (t) { if (S.resched) { S.resched.time = t; S.resched.error = ''; render(); } };

  function findBooking(id) {
    for (var i = 0; i < S.bookings.length; i++) if (S.bookings[i].Id === id) return S.bookings[i];
    return null;
  }
  function loadReschedTaken() {
    var r = S.resched;
    if (!r) return;
    api('slots', { date: r.date }).then(function (data) {
      if (S.resched !== r) return;
      var items = data.items || [], taken = [];
      for (var i = 0; i < items.length; i++) {
        if (!items[i].Time) continue;
        if (tzDateStr(items[i].Time) === r.date) {
          var hm = tzHHMM(items[i].Time);
          if (hm !== r.cur) taken.push(hm);
        }
      }
      r.taken = taken; r.loading = false; render();
    }).catch(function () { if (S.resched === r) { r.loading = false; render(); } });
  }

  App.confirmResched = function () {
    var r = S.resched;
    if (!r || !r.time) { if (r) { r.error = 'Pick an available time to move your booking.'; render(); } return; }
    if (r.taken.indexOf(r.time) >= 0) { r.error = 'That time was just taken. Please pick another.'; render(); return; }
    r.busy = true; r.error = ''; render();
    api('reschedule', { id: r.id, email: S.account.email, timeISO: wallToISO(r.date, r.time) })
      .then(function () { S.resched = null; loadBookings(); })
      .catch(function (err) { r.busy = false; r.error = err.message; render(); });
  };

  App.cancelBooking = function (id, label) {
    var b = findBooking(id);
    if (!b) return;
    if (!window.confirm(label + ' "' + b.Title + '" on ' + apptWhen(b.Time) + '? This cannot be undone.')) return;
    api('cancel', { id: id, email: S.account.email })
      .then(function () { loadBookings(); })
      .catch(function (err) { S.bookingsError = err.message; render(); });
  };

  /* ---------- rendering ---------- */
  var appEl = document.getElementById('app');

  function isSunday(dateStr) { return new Date(dateStr + 'T12:00:00').getDay() === 0; }

  function dateRail(dateStr, activeCls, onpick) {
    var days = [];
    for (var i = 0; i < DAY_COUNT; i++) days.push(addDaysStr(todayStr(), i));
    return '<div class="daterail">' + days.map(function (d) {
      var dt = new Date(d + 'T12:00:00');
      var closed = isSunday(d);
      var cls = d === dateStr ? 'datecard-active' : (closed ? 'datecard-closed' : 'datecard');
      var label = closed
        ? '<span class="dcdow">Sun</span><span class="dcnum">' + dt.getDate() + '</span><span class="dcmon">Closed</span>'
        : '<span class="dcdow">' + dt.toLocaleDateString(undefined, { weekday: 'short' }) + '</span>' +
          '<span class="dcnum">' + dt.getDate() + '</span>' +
          '<span class="dcmon">' + dt.toLocaleDateString(undefined, { month: 'short' }) + '</span>';
      return '<button type="button" class="' + cls + '"' + (closed ? ' disabled aria-disabled="true"' : ' onclick="' + onpick + '(\'' + d + '\')"') + '>' + label + '</button>';
    }).join('') + '</div>';
  }

  function timeGrid(dateStr, taken, selected, onpick) {
    return '<div class="timegrid">' + SLOTS.map(function (s) {
      var dis = slotDisabled(s, dateStr, taken);
      var cls = s === selected ? 'slot-active' : dis ? 'slot-taken' : 'slot';
      return '<button type="button" class="' + cls + '"' + (dis ? ' disabled' : '') +
        ' onclick="' + onpick + '(\'' + s + '\')">' + formatTime(s) + '</button>';
    }).join('') + '</div>' +
    '<div class="legend"><span><i class="dot-free"></i>Available</span><span><i class="dot-taken"></i>Booked</span></div>';
  }

  function renderHeader() {
    var inFlow = S.view === 'booking';
    var right = '';
    if (S.view === 'home') {
      right = '<div class="navright">' +
        (S.account
          ? '<button type="button" class="signinbtn" onclick="App.goMyBookings()"><span class="avatardot">' + esc((S.account.name || S.account.email || '?').charAt(0).toUpperCase()) + '</span>My bookings</button>'
          : '<button type="button" class="signinbtn" onclick="App.goAuth(\'signin\')">Sign in</button>') +
        '<button type="button" class="navbook" onclick="App.goBooking()">Book</button></div>';
    }
    var pills = inFlow ? '<div class="pills">' +
      [1, 2, 3].map(function (i) {
        var cls = S.step > i ? 'pill-done' : S.step === i ? 'pill-active' : 'pill';
        return '<div class="' + cls + '">' + (S.step > i ? '✓' : i) + '</div>';
      }).join('') + '</div>' : '';
    return '<header class="appbar">' +
      '<button type="button" class="brand" onclick="App.goHome()" aria-label="Dire Salon home">' +
      '<span class="mono">DS</span><span class="brandname">Dire Salon</span></button>' +
      pills + right + '</header>';
  }

  function renderHome() {
    return '<div class="anim" style="padding:0">' +
      '<section class="hero" style="background-image:url(assets/hero.jpg)"><div class="heroshade"></div>' +
      '<div class="hero-inner">' +
      '<p class="hero-kicker">Silver Spring, Maryland</p>' +
      '<h1 class="hero-title">Look sharp.<br>Feel <em>sharper.</em></h1>' +
      '<p class="hero-sub">Precision fades, tapers and beard sculpting from master barbers. Book in 30 seconds — your chair is waiting.</p>' +
      '<div class="herorating"><span class="stars">★★★★★</span><span>4.9 · 2,000+ happy clients</span></div>' +
      '<div class="hero-ctas"><button type="button" class="btn-primary" onclick="App.goBooking()">Book appointment</button>' +
      '<button type="button" class="btn-outline" onclick="document.getElementById(\'bb-styles\').scrollIntoView({behavior:\'smooth\'})">View services</button></div>' +
      '<div class="hero-stats"><div><strong>4.9</strong><span>2k+ reviews</span></div><div><strong>15 min</strong><span>Avg. wait</span></div><div><strong>Free</strong><span>Parking</span></div></div>' +
      '</div></section>' +
      '<div class="marquee" aria-hidden="true"><div class="marquee-inner"><span>Skin fade ◆ Taper ◆ Buzz cut ◆ Curly top ◆ Beard sculpt ◆ Kids cut ◆&nbsp;</span><span>Skin fade ◆ Taper ◆ Buzz cut ◆ Curly top ◆ Beard sculpt ◆ Kids cut ◆&nbsp;</span></div></div>' +
      '<section id="bb-styles" class="section"><p class="kicker">01 — Services</p><h2 class="title">Signature cuts</h2>' +
      '<p class="sub">The work we\'re known for. Tap a service to book it.</p><div class="stylegrid">' +
      STYLES.map(function (s) {
        return '<button type="button" class="stylecard" onclick="App.goBooking(\'' + s.id + '\')">' +
          '<span class="styleimg"><img src="' + s.img + '" alt="' + esc(s.name) + '" loading="lazy"></span>' +
          '<span class="stylebody"><span class="stylename">' + esc(s.name) + '</span>' +
          '<span class="styledesc">' + esc(s.desc) + '</span>' +
          '<span class="stylemeta"><span>' + s.mins + '</span><span class="bookhint">Tap to book →</span></span></span></button>';
      }).join('') + '</div></section>' +
      '<section class="section"><p class="kicker">02 — Why us</p><h2 class="title">The Dire Salon standard</h2><div class="whylist">' +
      '<div class="whyrow"><span class="whynum">01</span><div><strong>Master barbers</strong><p>Precision fades and crisp lineups, consistent every visit.</p></div></div>' +
      '<div class="whyrow"><span class="whynum">02</span><div><strong>Zero waiting</strong><p>Your chair is held. Arrive at your time, leave sharp.</p></div></div>' +
      '<div class="whyrow"><span class="whynum">03</span><div><strong>Hot-towel finish</strong><p>Every service ends clean with a hot towel and style.</p></div></div>' +
      '</div></section>' +
      '<section class="section"><p class="kicker">03 — Visit</p><h2 class="title">Find the shop</h2><div class="visitcard">' +
      '<div class="visitrow"><span class="visitlabel">Location</span><div><strong>946 Sligo Ave</strong><p>Silver Spring, MD 20910</p></div></div>' +
      '<div class="visitrow"><span class="visitlabel">Parking</span><div><strong>Parking garage</strong><p>' + GARAGE_ADDR + '</p></div></div>' +
      '<div class="visitrow"><span class="visitlabel">Hours</span><div><strong>Mon–Fri 9a–7p · Sat 9a–5p · Sun Closed</strong><p>Walk-ins welcome; bookings get priority.</p></div></div>' +
      '<div class="visitbtns"><a class="btn-primary" href="' + MAPS_URL + '" target="_blank" rel="noreferrer">Get directions</a>' +
      '<button type="button" class="btn-outline" onclick="App.copyAddress()">Copy address</button></div>' +
      '</div></section>' +
      '<footer class="homefooter"><div class="footbrand"><span class="mono">DS</span><span class="footname">Dire Salon</span></div>' +
      '<p>' + BIZ_ADDR + '<br>Parking garage nearby · Book in 30 seconds</p>' +
      '<p class="footadmin"><button type="button" class="linklike" onclick="App.goAdmin()">Admin</button></p></footer>' +
      '</div>';
  }

  function renderSchedule() {
    var st = styleById(S.selectedStyle);
    var body = '<div class="anim"><button type="button" class="linkback" onclick="App.goHome()">← Back</button>' +
      '<p class="kicker">Booking</p><h2 class="title">Pick your time</h2>' +
      '<p class="sub">Choose a day, then a time that suits you.</p>';
    if (st) {
      body += '<div class="selstyle"><span>' + esc(st.name) + '</span><button type="button" onclick="App.clearStyle()">Remove</button></div>';
    } else {
      body += '<div class="stylepicker"><span>Service</span><div class="chips">' +
        STYLES.map(function (s) {
          return '<button type="button" class="' + (S.selectedStyle === s.id ? 'chip-active' : 'chip') + '" onclick="App.pickStyle(\'' + s.id + '\')">' + esc(s.name) + '</button>';
        }).join('') + '</div></div>';
    }
    body += dateRail(S.date, 0, 'App.pickDate') + '<h3 class="h3">Available times</h3>';
    body += S.loadingSlots
      ? '<div class="skel"><div class="shimmer"></div><div class="shimmer" style="width:70%"></div>Checking availability…</div>'
      : timeGrid(S.date, S.taken, S.time, 'App.pickTime');
    return body + '</div>';
  }

  function renderDetails() {
    var st = styleById(S.selectedStyle);
    var acct = S.account;
    return '<div class="anim"><form onsubmit="return App.submitDetails()">' +
      '<button type="button" class="linkback" onclick="App.backToSchedule()">← Change time</button>' +
      '<p class="kicker">Booking</p><h2 class="title">Your details</h2>' +
      '<p class="sub">We\'ll hold your chair with this information.</p>' +
      '<div class="selsummary">' +
      (st ? '<div class="sumrow"><span>Service</span><strong>' + esc(st.name) + '</strong></div>' : '') +
      '<div class="sumrow"><span>Date</span><strong>' + formatLong(S.date) + '</strong></div>' +
      '<div class="sumrow"><span>Time</span><strong>' + formatTime(S.time) + '</strong></div></div>' +
      '<label class="field"><span>Full name</span><input id="f-name" type="text" maxlength="255" autocomplete="name" placeholder="Your full name" value="' + esc(acct ? acct.name : '') + '"></label>' +
      '<label class="field"><span>Email</span><input id="f-email" type="email" maxlength="255" autocomplete="email" inputmode="email" placeholder="you@example.com" value="' + esc(acct ? acct.email : '') + '"></label>' +
      '<label class="field"><span>Phone</span><input id="f-phone" type="tel" maxlength="30" autocomplete="tel" inputmode="tel" placeholder="(555) 123-4567" value="' + esc(acct ? acct.phone : '') + '"></label>' +
      '<p class="note">One booking per email or phone number, per day.</p>' +
      '</form></div>';
  }

  function renderDone() {
    var c = S.confirm;
    if (!c) return '<div class="anim"><p class="sub">Nothing to show.</p></div>';
    var body = '<div class="anim success"><div class="checkpop">✓</div>' +
      '<p class="kicker">Confirmed</p><h2 class="title">You\'re booked</h2>' +
      '<p class="sub">See you soon, ' + esc(c.name) + '.</p>' +
      '<div class="ticket">' +
      (c.style ? '<div class="ticketrow"><span>Service</span><strong>' + esc(c.style) + '</strong></div>' : '') +
      '<div class="ticketrow"><span>Date</span><strong>' + formatLong(c.date) + '</strong></div>' +
      '<div class="ticketrow"><span>Time</span><strong>' + formatTime(c.time) + '</strong></div>' +
      '<div class="ticketrow"><span>Address</span><strong class="ticketsmall">' + BIZ_ADDR + '</strong></div></div>' +
      '<p class="note">Parking garage: ' + GARAGE_ADDR + '.</p>';
    if (!S.account && !S.quickDone) {
      body += '<form class="quickacct" onsubmit="return App.quickCreate()">' +
        '<strong>Keep track of this booking</strong>' +
        '<p>Create a free account with one tap — see your history, move or cancel anytime.</p>' +
        '<label class="field"><span>Choose a password</span><input id="q-pw" type="password" maxlength="128" autocomplete="new-password" placeholder="Min. 6 characters"></label>' +
        (S.quickError ? '<div class="error">' + esc(S.quickError) + '</div>' : '') +
        '<button type="submit" class="btn-primary" ' + (S.quickBusy ? 'disabled' : '') + '>' +
        (S.quickBusy ? 'Creating…' : 'Create account for ' + esc(c.email)) + '</button></form>';
    }
    if (S.quickDone && S.account) {
      body += '<div class="quickdone">Account created — you\'re signed in as ' + esc(S.account.name) + '.' +
        '<button type="button" class="inlinelink" onclick="App.goMyBookings()">View my bookings</button></div>';
    }
    body += '<div class="donebtns"><a class="btn-outline" href="' + MAPS_URL + '" target="_blank" rel="noreferrer">Get directions</a></div></div>';
    return body;
  }

  function renderAuth() {
    var isSignup = S.authMode === 'signup';
    return '<div class="anim center"><button type="button" class="linkback" onclick="App.goHome()">← Back</button>' +
      '<p class="kicker">' + (isSignup ? 'Create account' : 'Welcome back') + '</p>' +
      '<h2 class="title">' + (isSignup ? 'Sign up in seconds' : 'Sign in') + '</h2>' +
      '<p class="sub">' + (isSignup ? 'One account to see your history, move bookings and manage everything.' : 'See your bookings and manage them anytime.') + '</p>' +
      '<div class="authtabs">' +
      '<button type="button" class="' + (!isSignup ? 'authtab-active' : 'authtab') + '" onclick="App.setTab(\'signin\')">Sign in</button>' +
      '<button type="button" class="' + (isSignup ? 'authtab-active' : 'authtab') + '" onclick="App.setTab(\'signup\')">Create account</button></div>' +
      '<form class="authcard" onsubmit="return App.' + (isSignup ? 'signup' : 'signin') + '()">' +
      (isSignup ? '<label class="field"><span>Full name</span><input id="a-name" type="text" maxlength="255" autocomplete="name" placeholder="Your full name"></label>' : '') +
      '<label class="field"><span>Email</span><input id="a-email" type="email" maxlength="255" autocomplete="email" inputmode="email" placeholder="you@example.com"></label>' +
      (isSignup ? '<label class="field"><span>Phone</span><input id="a-phone" type="tel" maxlength="30" autocomplete="tel" inputmode="tel" placeholder="(555) 123-4567"></label>' : '') +
      '<label class="field"><span>Password' + (isSignup ? ' (min. 6 characters)' : '') + '</span><input id="a-pw" type="password" maxlength="128" autocomplete="' + (isSignup ? 'new-password' : 'current-password') + '" placeholder="••••••••"></label>' +
      (isSignup ? '<label class="field"><span>Confirm password</span><input id="a-pw2" type="password" maxlength="128" autocomplete="new-password" placeholder="••••••••"></label>' : '') +
      (S.authError ? '<div class="error">' + esc(S.authError) + '</div>' : '') +
      '<button type="submit" class="cta" ' + (S.authBusy ? 'disabled' : '') + '>' + (S.authBusy ? 'Please wait…' : isSignup ? 'Create account' : 'Sign in') + '</button>' +
      (!isSignup ? '<p class="note"><button type="button" class="inlinelink" onclick="App.goForgot()">Forgot password?</button></p><p class="note">New here? <button type="button" class="inlinelink" onclick="App.setTab(\'signup\')">Create an account</button></p>' : '') +
      '</form></div>';
  }

  function renderForgot() {
    var f = S.forgot || { step: 'email', email: '', error: '', busy: false };
    var inner = '';
    if (f.step === 'done') {
      inner = '<div class="success">Password updated. Sign in with your new password.</div>' +
        '<button type="button" class="cta" onclick="App.goAuth(\'signin\')">Back to sign in</button>';
    } else if (f.step === 'code') {
      inner = '<form class="authcard" onsubmit="return App.doReset()">' +
        '<p class="note">If an account exists for <strong>' + esc(f.email) + '</strong>, a 6-digit code is on its way. It expires in 15 minutes.</p>' +
        '<label class="field"><span>Reset code</span><input id="f-code" type="text" maxlength="6" inputmode="numeric" autocomplete="one-time-code" placeholder="123456"></label>' +
        '<label class="field"><span>New password (min. 6 characters)</span><input id="f-pw" type="password" maxlength="128" autocomplete="new-password" placeholder="••••••••"></label>' +
        '<label class="field"><span>Confirm new password</span><input id="f-pw2" type="password" maxlength="128" autocomplete="new-password" placeholder="••••••••"></label>' +
        (f.error ? '<div class="error">' + esc(f.error) + '</div>' : '') +
        '<button type="submit" class="cta" ' + (f.busy ? 'disabled' : '') + '>' + (f.busy ? 'Please wait…' : 'Reset password') + '</button>' +
        '<p class="note">Didn\'t get it? <button type="button" class="inlinelink" onclick="App.goForgot()">Send a new code</button></p></form>';
    } else {
      inner = '<form class="authcard" onsubmit="return App.sendResetCode()">' +
        '<p class="note">Enter your account email and we\'ll send you a 6-digit reset code.</p>' +
        '<label class="field"><span>Email</span><input id="f-email" type="email" maxlength="255" autocomplete="email" inputmode="email" placeholder="you@example.com"></label>' +
        (f.error ? '<div class="error">' + esc(f.error) + '</div>' : '') +
        '<button type="submit" class="cta" ' + (f.busy ? 'disabled' : '') + '>' + (f.busy ? 'Sending…' : 'Send reset code') + '</button></form>';
    }
    return '<div class="anim center"><button type="button" class="linkback" onclick="App.goAuth(\'signin\')">← Back to sign in</button>' +
      '<p class="kicker">Account recovery</p><h2 class="title">Reset your password</h2>' + inner + '</div>';
  }

  function renderMyBookings() {
    var nowIso = new Date().toISOString();
    var upcoming = [], past = [];
    for (var i = 0; i < S.bookings.length; i++) {
      var b = S.bookings[i];
      (b.Time >= nowIso ? upcoming : past).push(b);
    }
    upcoming.sort(function (a, b) { return a.Time < b.Time ? -1 : 1; });

    var body = '<div class="anim wide"><button type="button" class="linkback" onclick="App.goHome()">← Back</button>' +
      '<div class="accthead"><div><p class="kicker">Your account</p><h2 class="title">My bookings</h2>' +
      (S.account ? '<p class="sub">Signed in as ' + esc(S.account.name) + ' · ' + esc(S.account.email) + '</p>' : '') +
      '</div><button type="button" class="btn-outline" onclick="App.signOut()">Sign out</button></div>';

    if (S.bookingsLoading) {
      body += '<div class="skel"><div class="shimmer"></div>Loading your bookings…</div>';
    } else if (S.bookingsError) {
      body += '<div class="error">' + esc(S.bookingsError) + '</div>';
    } else {
      body += '<h3 class="h3">Upcoming</h3>';
      if (!upcoming.length) {
        body += '<div class="emptystate"><p>No upcoming bookings.</p><button type="button" class="btn-primary" onclick="App.goBooking()">Book appointment</button></div>';
      }
      body += upcoming.map(renderApptCard).join('');
      body += '<h3 class="h3">History</h3>';
      if (!past.length) body += '<p class="note">Nothing here yet — past appointments will show up here.</p>';
      body += past.map(function (b) {
        return '<div class="apptcard apptpast"><div class="apptmain"><strong class="appttitle">' + esc(b.Title) + '</strong>' +
          '<span class="apptwhen">' + esc(apptWhen(b.Time)) + '</span></div>' +
          '<div class="apptactions"><button type="button" class="minibtn dangerbtn" onclick="App.cancelBooking(' + b.Id + ',\'Delete from history\')">Delete</button></div></div>';
      }).join('');
    }
    return body + '</div>';
  }

  /* ---------- admin dashboard ---------- */
  function renderAdminLogin(a) {
    return '<div class="authcard"><p class="kicker">Admin</p><h2 class="title">Admin sign in</h2>' +
      '<p class="sub">Staff only. Bookings data loads after sign in.</p>' +
      (a.error ? '<div class="error">' + esc(a.error) + '</div>' : '') +
      '<form onsubmit="return App.adminLogin()">' +
      '<label class="field"><span>Admin email</span><input id="ad-email" type="email" autocomplete="username" value="' + esc(a.email || '') + '"></label>' +
      '<label class="field"><span>Password</span><input id="ad-pw" type="password" autocomplete="current-password"></label>' +
      '<button class="cta" type="submit"' + (a.loading ? ' disabled' : '') + '>' + (a.loading ? 'Signing in…' : 'Sign in') + '</button>' +
      '</form></div>';
  }
  function renderAdmin() {
    var a = S.admin || { authed: false };
    if (!a.authed) return renderAdminLogin(a);
    return '<div class="wrap narrow">' + renderAdminDash(a) + '</div>';
  }
  function calKey(y, m) { return y + '-' + m; }
  function dayBookings(list, ds) {
    return (list || []).filter(function (b) { return b.time && tzDateStr(b.time) === ds; });
  }
  function monthName(y, m) { return new Date(y, m - 1, 1).toLocaleString(undefined, { month: 'long' }); }
  function prettyDay(ds) {
    return new Date(ds + 'T12:00:00').toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function fmtDate(iso) {
    return new Intl.DateTimeFormat(undefined, { timeZone: TZ, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso));
  }
  function fmtTime(iso) {
    return new Intl.DateTimeFormat(undefined, { timeZone: TZ, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  }
  function fmtPhone(p) {
    var d = digitsOnly(p || '');
    if (d.length === 10) return '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6);
    if (d.length === 11 && d.charAt(0) === '1') return '+1 (' + d.slice(1, 4) + ') ' + d.slice(4, 7) + '-' + d.slice(7);
    return p || '';
  }
  function loadCalMonth(a, y, m) {
    var k = calKey(y, m);
    if (a.calCache[k] || a.calLoading) return;
    a.calLoading = true; a.error = ''; render();
    api('monthbookings', { email: a.email, hash: a.hash, year: y, month: m }).then(function (data) {
      a.calLoading = false;
      if (!data || !data.ok) throw new Error('Not authorized.');
      a.calCache[k] = data.bookings || []; render();
    }).catch(function (err) { a.calLoading = false; a.error = err.message; render(); });
  }
  function loadCustomers(a) {
    if (a.customers || a.custLoading) return;
    a.custLoading = true; a.error = ''; render();
    api('customers', { email: a.email, hash: a.hash }).then(function (data) {
      a.custLoading = false;
      if (!data || !data.ok) throw new Error('Not authorized.');
      a.customers = data.customers || []; render();
    }).catch(function (err) { a.custLoading = false; a.error = err.message; render(); });
  }
  function bookingCard(b) {
    var tel = b.phone ? 'tel:' + esc(digitsOnly(b.phone)) : '';
    var h = '<div class="bcard"><div class="brow1"><span class="bname">' + esc(b.name || '—') + '</span>' +
      (b.time ? '<span class="btimepill">' + esc(fmtTime(b.time)) + '</span>' : '') + '</div>';
    if (b.time) h += '<div class="bdate">' + esc(fmtDate(b.time)) + '</div>';
    if (b.phone || b.email) {
      h += '<div class="bcontact">' +
        (b.phone ? '<a href="' + tel + '">' + esc(fmtPhone(b.phone)) + '</a>' : '') +
        (b.email ? '<span>' + esc(b.email) + '</span>' : '') + '</div>';
    }
    h += '<div class="bactions">';
    if (b.phone) h += '<a class="minibtn" href="' + tel + '">Call</a>';
    if (b.email) h += '<button type="button" class="minibtn" data-email="' + esc(b.email) + '" data-name="' + esc(b.name || '') + '" onclick="App.openMailer(this)">Email</button>';
    h += '<button type="button" class="minibtn" data-id="' + esc(b.id) + '" data-name="' + esc(b.name || '') +
      '" data-email="' + esc(b.email || '') + '" data-time="' + esc(b.time || '') +
      '" onclick="App.openMover(this)">Change time</button></div></div>';
    return h;
  }
  function customerCard(c) {
    var tel = c.phone ? 'tel:' + esc(digitsOnly(c.phone)) : '';
    var h = '<div class="bcard"><div class="brow1"><span class="bname">' + esc(c.name || '—') + '</span></div>' +
      '<div class="bcontact">' +
      (c.phone ? '<a href="' + tel + '">' + esc(fmtPhone(c.phone)) + '</a>' : '') +
      (c.email ? '<span>' + esc(c.email) + '</span>' : '') + '</div>' +
      '<div class="bactions">';
    if (c.phone) h += '<a class="minibtn" href="' + tel + '">Call</a>';
    if (c.email) h += '<button type="button" class="minibtn" data-email="' + esc(c.email) + '" data-name="' + esc(c.name || '') + '" onclick="App.openMailer(this)">Email</button>';
    h += '</div></div>';
    return h;
  }
  function upcomingFiltered(a) {
    var q = (a.q || '').toLowerCase();
    return (a.sheet || []).filter(function (b) {
      if (a.dateF && (!b.time || tzDateStr(b.time) !== a.dateF)) return false;
      if (!q) return true;
      return (b.name || '').toLowerCase().indexOf(q) >= 0 ||
        (b.phone || '').toLowerCase().indexOf(q) >= 0 ||
        (b.email || '').toLowerCase().indexOf(q) >= 0;
    });
  }
  function upcomingListHTML(a) {
    if (a.loading) return '<div class="skel"><div class="shimmer"></div>Loading…</div>';
    var rows = upcomingFiltered(a);
    if (!rows.length) return '<div class="emptystate"><p>No bookings match.</p></div>';
    return '<p class="listcount">' + rows.length + ' shown</p>' + rows.map(bookingCard).join('');
  }
  function renderUpcoming(a) {
    var h = '<div class="stat3">' +
      '<div class="stat"><b>' + (a.sheet || []).length + '</b><span>Upcoming</span></div>' +
      '<div class="stat"><b>' + dayBookings(a.sheet, todayStr()).length + '</b><span>Today</span></div>' +
      '<div class="stat"><b>' + (a.customers ? a.customers.length : '—') + '</b><span>Customers</span></div></div>';
    h += '<input id="adm-q" class="admq" type="search" placeholder="Search name, phone, email…" value="' +
      esc(a.q || '') + '" oninput="App.adminSearch(this.value)" onsearch="App.adminSearch(this.value)">' +
      '<input id="adm-date" class="admq" type="date" value="' + esc(a.dateF || '') +
      '" onchange="App.adminDateF(this.value)" aria-label="Filter by date">';
    h += '<div id="adm-list">' + upcomingListHTML(a) + '</div>';
    return h;
  }
  function renderCalendar(a) {
    var y = a.calY, m = a.calM, k = calKey(y, m);
    var list = a.calCache[k];
    var counts = {};
    (list || []).forEach(function (b) {
      if (b.time) { var ds = tzDateStr(b.time); counts[ds] = (counts[ds] || 0) + 1; }
    });
    var first = new Date(y, m - 1, 1).getDay();
    var dim = new Date(y, m, 0).getDate();
    var tds = todayStr();
    var h = '<div class="calhead" id="calhead"><button type="button" class="calnav" onclick="App.adminCalNav(-1)" aria-label="Previous month">‹</button>' +
      '<h3>' + monthName(y, m) + ' ' + y + '</h3>' +
      '<button type="button" class="calnav" onclick="App.adminCalNav(1)" aria-label="Next month">›</button></div>';
    h += '<div class="caldow"><span>SU</span><span>MO</span><span>TU</span><span>WE</span><span>TH</span><span>FR</span><span>SA</span></div><div class="calgrid">';
    for (var i = 0; i < first; i++) h += '<div class="calday blank"></div>';
    for (var d = 1; d <= dim; d++) {
      var ds = y + '-' + pad(m) + '-' + pad(d);
      var c = counts[ds] || 0, sun = isSunday(ds);
      var cls = 'calday' + (sun ? ' calsun' : '') + (ds === tds ? ' caltoday' : '') + (ds === a.calDay ? ' calsel' : '');
      h += '<button type="button" class="' + cls + '" onclick="App.adminCalDay(\'' + ds + '\')"><span class="n">' + d + '</span>' +
        (sun ? '<span class="calclosed">Closed</span>' : (c ? '<span class="calbadge">' + c + ' booked</span>' : '')) + '</button>';
    }
    h += '</div>';
    if (a.calLoading) h += '<div class="skel"><div class="shimmer"></div>Loading…</div>';
    else if (a.error) h += '<div class="error">' + esc(a.error) + '</div>';
    if (a.calDay) {
      var dayList = dayBookings(list, a.calDay);
      h += '<div class="daypanel" id="daypanel"><h3 class="h3">' + esc(prettyDay(a.calDay)) + ' · ' + dayList.length + ' booked</h3>';
      h += dayList.length ? dayList.map(bookingCard).join('') : '<div class="emptystate"><p>No bookings this day.</p></div>';
      h += '</div>';
    } else {
      h += '<p class="note">Tap a day to see who booked.</p>';
    }
    return h;
  }
  function customersFiltered(a) {
    var q = (a.custQ || '').toLowerCase();
    return (a.customers || []).filter(function (c) {
      if (!q) return true;
      return (c.name || '').toLowerCase().indexOf(q) >= 0 ||
        (c.phone || '').toLowerCase().indexOf(q) >= 0 ||
        (c.email || '').toLowerCase().indexOf(q) >= 0;
    });
  }
  function customersListHTML(a) {
    if (a.custLoading) return '<div class="skel"><div class="shimmer"></div>Loading…</div>';
    if (a.error) return '<div class="error">' + esc(a.error) + '</div>';
    var list = customersFiltered(a);
    if (!list.length) return '<div class="emptystate"><p>No customers found.</p></div>';
    return '<p class="listcount">' + list.length + ' customers</p>' + list.map(customerCard).join('');
  }
  function renderCustomers(a) {
    return '<input id="adm-cq" class="admq" type="search" placeholder="Search customers…" value="' +
      esc(a.custQ || '') + '" oninput="App.adminCustQ(this.value)" onsearch="App.adminCustQ(this.value)">' +
      '<div id="adm-clist">' + customersListHTML(a) + '</div>';
  }
  function renderMailer(a) {
    var h = '<div class="mailwrap"><div class="mailcard">';
    h += '<p class="kicker">Email customer</p><p class="msub"><strong>' +
      esc(a.mailName || a.mailTo) + '</strong><br>' + esc(a.mailTo) + '</p>';
    if (a.mailDone) h += '<div class="mailsent">' + esc(a.mailDone) + '</div>';
    if (a.mailError) h += '<div class="error">' + esc(a.mailError) + '</div>';
    h += '<label class="field"><span>Subject</span><input id="mail-subj" maxlength="120" value="' +
      esc(a.mailSubject || '') + '" placeholder="Subject"></label>';
    h += '<label class="field"><span>Message</span><textarea id="mail-body" maxlength="2000" placeholder="Write your message…">' +
      esc(a.mailBody || '') + '</textarea></label>';
    h += '<div class="mailrow"><button type="button" class="cta" style="flex:1;margin:0"' +
      (a.mailBusy ? ' disabled' : '') + ' onclick="App.sendMail()">' + (a.mailBusy ? 'Sending…' : 'Send email') + '</button>' +
      '<button type="button" class="btn-outline" onclick="App.closeMailer()">Close</button></div>';
    h += '</div></div>';
    return h;
  }
  function mvLoadSlots(a) {
    if (!a.mvDate || isSunday(a.mvDate)) { a.mvTaken = []; render(); return; }
    a.mvLoading = true; render();
    api('slots', { date: a.mvDate }).then(function (data) {
      var items = data.items || [], taken = [];
      for (var i = 0; i < items.length; i++) {
        if (!items[i].Time) continue;
        if (tzDateStr(items[i].Time) !== a.mvDate) continue;
        var hhmm = tzHHMM(items[i].Time);
        if (a.mvDate === a.mvOrigDate && hhmm === a.mvOrigHHMM) continue;
        taken.push(hhmm);
      }
      a.mvTaken = taken; a.mvLoading = false; render();
    }).catch(function () { a.mvTaken = []; a.mvLoading = false; render(); });
  }
  function renderMover(a) {
    var h = '<div class="mailwrap"><div class="mailcard">';
    h += '<p class="kicker">Change booking time</p><p class="msub"><strong>' + esc(a.mvName || '—') + '</strong><br>' +
      (a.mvWhen ? esc(a.mvWhen) : '') + '</p>';
    if (a.mvDone) h += '<div class="mailsent">' + esc(a.mvDone) + '</div>';
    if (a.mvError) h += '<div class="error">' + esc(a.mvError) + '</div>';
    h += '<label class="field"><span>New date</span><input id="mv-date" type="date" value="' + esc(a.mvDate || '') +
      '" min="' + esc(todayStr()) + '" onchange="App.mvDateChange(this.value)"></label>';
    if (a.mvLoading) h += '<div class="skel"><div class="shimmer"></div>Checking availability…</div>';
    else if (a.mvDate && !isSunday(a.mvDate)) h += timeGrid(a.mvDate, a.mvTaken || [], a.mvTime, 'App.mvPickTime');
    h += '<div class="mailrow"><button type="button" class="cta" style="flex:1;margin:0"' +
      (a.mvBusy ? ' disabled' : '') + ' onclick="App.mvConfirm()">' + (a.mvBusy ? 'Updating…' : 'Confirm change') + '</button>' +
      '<button type="button" class="btn-outline" onclick="App.closeMover()">Cancel</button></div>';
    h += '<p class="note">The customer is emailed automatically about the new time.</p>';
    h += '</div></div>';
    return h;
  }
  function renderAdminDash(a) {
    var tabs = [['upcoming', 'Upcoming'], ['calendar', 'Calendar'], ['customers', 'Customers']];
    var h = '<div class="admhead"><div class="admbrand"><span class="admavatar">DS</span>' +
      '<div class="admtitles"><strong>Dire Salon</strong><span class="admpill">Admin</span></div></div>' +
      '<div class="rowbtns"><button type="button" class="iconbtn" onclick="App.adminRefresh()" aria-label="Refresh">↻</button>' +
      '<button type="button" class="btn-outline" onclick="App.adminSignOut()">Sign out</button></div></div>';
    h += '<div class="seg">' + tabs.map(function (t) {
      return '<button type="button" class="segbtn' + (a.tab === t[0] ? ' seg-on' : '') +
        '" onclick="App.adminTab(\'' + t[0] + '\')">' + t[1] + '</button>';
    }).join('') + '</div>';
    if (a.tab === 'calendar') {
      if (!a.calCache[calKey(a.calY, a.calM)] && !a.calLoading) loadCalMonth(a, a.calY, a.calM);
      h += renderCalendar(a);
    } else if (a.tab === 'customers') {
      if (!a.customers && !a.custLoading) loadCustomers(a);
      h += renderCustomers(a);
    } else {
      h += renderUpcoming(a);
    }
    if (a.mailOpen) h += renderMailer(a);
    if (a.mvOpen) h += renderMover(a);
    return h;
  }
  function renderApptCard(b) {
    var r = S.resched;
    var isR = r && r.id === b.Id;
    var html = '<div class="apptcard"><div class="apptmain"><strong class="appttitle">' + esc(b.Title) + '</strong>' +
      '<span class="apptwhen">' + esc(apptWhen(b.Time)) + '</span></div>' +
      '<div class="apptactions"><button type="button" class="minibtn" onclick="App.openResched(' + b.Id + ')">Change time</button>' +
      '<button type="button" class="minibtn dangerbtn" onclick="App.cancelBooking(' + b.Id + ',\'Cancel booking\')">Cancel</button></div>';
    if (isR) {
      html += '<div class="reschedbox"><p class="reschedtitle">Move to an available time</p>' +
        '<p class="note">Currently ' + formatTime(r.cur) + ' on ' + formatLong(r.date) + '. Only open slots can be picked.</p>' +
        dateRail(r.date, 0, 'App.pickReschedDate') +
        (r.loading ? '<div class="skel">Checking availability…</div>' : timeGrid(r.date, r.taken, r.time, 'App.pickReschedTime')) +
        (r.error ? '<div class="error">' + esc(r.error) + '</div>' : '') +
        '<div class="reschedbtns"><button type="button" class="backbtn" onclick="App.closeResched()">Keep as is</button>' +
        '<button type="button" class="cta" ' + (r.busy ? 'disabled' : '') + ' onclick="App.confirmResched()">' + (r.busy ? 'Moving…' : 'Confirm new time') + '</button></div></div>';
    }
    return html + '</div>';
  }

  function renderActionBar() {
    if (S.view === 'auth') return '';
    var err = S.error ? '<div class="error">' + esc(S.error) + '</div>' : '';
    var inner = '';
    if (S.view === 'home') {
      inner = '<button type="button" class="cta" onclick="App.goBooking()">Book appointment</button>';
    } else if (S.view === 'mybookings' && S.account) {
      inner = '<button type="button" class="cta" onclick="App.goBooking()">Book new appointment</button>';
    } else if (S.view === 'booking' && S.step === 1) {
      inner = '<button type="button" class="cta" onclick="App.goDetails()">Continue</button>';
    } else if (S.view === 'booking' && S.step === 2) {
      inner = '<div class="cta-row"><button type="button" class="backbtn" onclick="App.backToSchedule()">Back</button>' +
        '<button type="button" class="cta" ' + (S.submitting ? 'disabled' : '') + ' onclick="App.submitDetails()">' + (S.submitting ? 'Booking…' : 'Confirm booking') + '</button></div>';
    } else if (S.view === 'booking' && S.step === 3) {
      inner = '<div class="cta-row"><button type="button" class="backbtn" onclick="App.goHome()">Home</button>' +
        '<button type="button" class="cta" onclick="App.bookAnother()">Book another</button></div>';
    }
    if (!inner && !err) return '';
    return '<div class="actionbar">' + err + inner + '</div>';
  }

  function render() {
    var main = '';
    if (S.view === 'home') main = renderHome();
    else if (S.view === 'auth') main = renderAuth();
    else if (S.view === 'forgot') main = renderForgot();
    else if (S.view === 'mybookings') main = S.account ? renderMyBookings() : renderAuth();
    else if (S.view === 'admin') main = renderAdmin();
    else if (S.view === 'booking') {
      main = S.step === 1 ? renderSchedule() : S.step === 2 ? renderDetails() : renderDone();
    }
    appEl.innerHTML = renderHeader() + '<main>' + main + '</main>' + renderActionBar();
  }

  if (!FB_CONFIG.apiUrl || FB_CONFIG.apiUrl.indexOf('__API_URL__') >= 0) {
    console.warn('FB_CONFIG.apiUrl is not set yet.');
  }
  render();
})();
