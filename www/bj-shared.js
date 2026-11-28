/* Batas Jajan - mode Bersama (Firebase Auth + Firestore) */
(function () {
  "use strict";

  var CFG = {
    apiKey: "AIzaSyBU3m-GhZso5aJDnxiodN0LgWHu3-qrvxo",
    authDomain: "aplikasi-batas-jajan-b41e7.firebaseapp.com",
    projectId: "aplikasi-batas-jajan-b41e7",
    storageBucket: "aplikasi-batas-jajan-b41e7.firebasestorage.app",
    messagingSenderId: "871229987953",
    appId: "1:871229987953:web:92b61147f16dbbf9db8fd0"
  };
  var COLS = ["acc", "tx", "debts", "assets"];

  var fb = window.firebase, auth = null, db = null, ME = null;
  var authReady = null, resolveAuth = null;
  var BOOKS = [], INVITES = [], book = null;
  var active = false, autoDone = false, enterAfter = false;
  var booksUnsub = null, invUnsub = null, unsubs = [];
  var cols = null, last = null, katDoc = null, katReady = false;
  var ARCH = null, archBusy = false;
  var ST = null, stReady = false, seenStreak = false, prevAll = false, pendDone = "";
  var msg = "";
  var LOG = [], UNSEEN = 0, logUnsub = null, logFor = null, notified = {};

  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }
  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }
  // JSON dengan urutan kunci tetap, supaya perbandingan tidak terpengaruh urutan field
  function sj(o) { return JSON.stringify(o, Object.keys(o).sort()); }
  function byId(a, b) { return a.id - b.id; }
  function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
  function jwtEmail(t) {
    try {
      var p = t.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
      return String(JSON.parse(atob(p)).email || "").toLowerCase();
    } catch (e) { return ""; }
  }
  function humanErr(e) {
    var c = (e && e.code) || "";
    if (c === "permission-denied") return "Akses ditolak oleh aturan keamanan Firestore. Pastikan aturan sudah dipasang dan dipublikasikan.";
    if (c === "unavailable") return "Tidak ada koneksi ke server. Coba lagi saat online.";
    if (/^auth\//.test(c)) return "Login ke mode Bersama gagal (" + c + "). Periksa pengaturan Authentication di Firebase.";
    return e && e.message ? e.message : String(e);
  }
  function note(t) { msg = t || ""; render(); }
  function myEmail() { return ME && ME.email ? ME.email.toLowerCase() : ""; }
  function keyOf(e) { return String(e || "").toLowerCase().replace(/\./g, ","); }
  function isOwner() { return !!(book && ME && book.ownerUid === ME.uid); }
  function roleOf(email) { var r = book && book.roles ? book.roles[keyOf(email)] : null; return r === "viewer" ? "viewer" : "editor"; }
  function readOnly() { return !!(book && ME && !isOwner() && roleOf(myEmail()) === "viewer"); }
  function short(e) { return String(e || "").split("@")[0]; }
  function rpf(n) { return "Rp" + Math.abs(Math.round(+n || 0)).toLocaleString("id-ID"); }
  function ts(x) { return x && x.t && x.t.toMillis ? x.t.toMillis() : 0; }

  // ---------- Inisialisasi ----------
  function init() {
    if (!fb || !fb.initializeApp) return false;
    try {
      fb.initializeApp(CFG);
      auth = fb.auth();
      db = fb.firestore();
      try { db.settings({ ignoreUndefinedProperties: true, experimentalAutoDetectLongPolling: true }); } catch (e) {}
      try { var p = db.enablePersistence({ synchronizeTabs: false }); if (p && p.catch) p.catch(function () {}); } catch (e) {}
    } catch (e) { db = null; return false; }
    authReady = new Promise(function (r) { resolveAuth = r; });
    auth.onAuthStateChanged(function (u) { ME = u; resolveAuth(); onUser(); });
    return true;
  }

  function stopLog() { if (logUnsub) { try { logUnsub(); } catch (e) {} logUnsub = null; } logFor = null; LOG = []; UNSEEN = 0; }
  function startLog() {
    if (!book || !db || logFor === book.id) return;
    stopLog();
    logFor = book.id;
    var bid = book.id, sk = "bj.logSeen." + bid;
    if (!ls(sk)) ls(sk, String(Date.now()));
    logUnsub = db.collection("books").doc(bid).collection("log").orderBy("t", "desc").limit(30).onSnapshot(function (s) {
      var seen = +ls(sk) || 0, fresh = [];
      LOG = s.docs.map(function (d) { var x = d.data(); x.id = d.id; x._pend = d.metadata.hasPendingWrites; return x; });
      LOG.forEach(function (x) {
        if (x.by !== (ME && ME.uid) && !x._pend && ts(x) > seen) {
          fresh.push(x);
        }
      });
      UNSEEN = fresh.length;
      var news = fresh.filter(function (x) { return !notified[x.id]; });
      news.forEach(function (x) { notified[x.id] = 1; });
      if (news.length && window.BJ_TOAST && !panelOpen()) {
        window.BJ_TOAST(news.length === 1 ? news[0].name + " " + news[0].txt : news.length + " perubahan baru dari " + news[0].name, "b");
      }
      render(); badge();
    }, function () {});
  }
  function panelOpen() { var v = $("v-bersama"); return !!(v && !v.classList.contains("hide")); }
  function markSeen() {
    if (!book) return;
    var mx = 0; LOG.forEach(function (x) { if (ts(x) > mx) mx = ts(x); });
    ls("bj.logSeen." + book.id, String(Math.max(mx, Date.now() - 1000)));
    UNSEEN = 0; badge();
  }
  function stopTop() {
    stopLog();
    if (booksUnsub) { booksUnsub(); booksUnsub = null; }
    if (invUnsub) { invUnsub(); invUnsub = null; }
  }

  function onUser() {
    stopTop(); msg = "";
    if (!ME) {
      BOOKS = []; INVITES = []; book = null; ARCH = null;
      if (active) { detach(); active = false; if (window.BJ_SWITCH) window.BJ_SWITCH("p"); }
      render(); badge();
      return;
    }
    booksUnsub = db.collection("books").where("members", "array-contains", ME.uid).onSnapshot(function (s) {
      BOOKS = s.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; });
      var nb = BOOKS[0] || null;
      var changed = (nb ? nb.id : null) !== (book ? book.id : null);
      book = nb;
      if (changed && active) {
        detach();
        if (book) attach(); else { active = false; if (window.BJ_SWITCH) window.BJ_SWITCH("p"); }
      }
      if (!autoDone) {
        autoDone = true;
        if (book && ls("bj.mode") === "b" && window.BJ_SWITCH) window.BJ_SWITCH("b");
      }
      if (enterAfter && book) { enterAfter = false; if (window.BJ_SWITCH) window.BJ_SWITCH("b"); }
      if (active && window.BJ_NAME) window.BJ_NAME(book ? book.name : "");
      if (book) startLog(); else stopLog();
      if (book && ME && book.ownerUid === ME.uid && book.leaveReq && book.leaveReq.at && ls("bj.lrSeen") !== String(book.leaveReq.at)) {
        ls("bj.lrSeen", String(book.leaveReq.at));
        if (window.BJ_TOAST) window.BJ_TOAST((book.leaveReq.email || "Temanmu") + " meminta keluar dari buku. Buka menu Bersama untuk menyetujui.", "b");
      }
      if (book && ME && book.ownerUid !== ME.uid && book.leaveReq && book.leaveReq.uid === ME.uid && reqBy() === book.ownerUid && ls("bj.lrSeen2") !== String(book.leaveReq.at)) {
        ls("bj.lrSeen2", String(book.leaveReq.at));
        if (window.BJ_TOAST) window.BJ_TOAST("Pembuat buku mengajak berpisah. Buka menu Bersama untuk menjawab.", "b");
      }
      autoFinish();
      render(); badge();
      if (active) renderStreak();
    }, function (e) { note(humanErr(e)); });
    var em = myEmail();
    if (em) {
      invUnsub = db.collection("books").where("invited", "array-contains", em).onSnapshot(function (s) {
        INVITES = s.docs.map(function (d) { var x = d.data(); x.id = d.id; return x; });
        render(); badge();
      }, function (e) { note(humanErr(e)); });
    }
  }

  function badge() {
    var b = $("mbB");
    if (b) b.textContent = "Bersama" + ((INVITES.length && !book) || UNSEEN || (book && ME && book.leaveReq && (book.ownerUid === ME.uid ? reqBy() !== book.ownerUid : (book.leaveReq.uid === ME.uid && reqBy() === book.ownerUid))) ? " •" : "");
  }

  // ---------- Data buku bersama ----------
  function attach() {
    if (!book) return;
    cols = { acc: null, tx: null, debts: null, assets: null };
    last = { acc: {}, tx: {}, debts: {}, assets: {}, kat: null };
    katDoc = null; katReady = false;
    var base = db.collection("books").doc(book.id);
    COLS.forEach(function (c) {
      unsubs.push(base.collection(c).onSnapshot(function (s) {
        var arr = [];
        s.forEach(function (d) { arr.push(d.data()); });
        cols[c] = arr; emit();
      }, function (e) { note(humanErr(e)); }));
    });
    unsubs.push(base.collection("cfg").doc("kat").onSnapshot(function (d) {
      katDoc = d.exists ? d.data() : null; katReady = true; emit();
    }, function (e) { note(humanErr(e)); }));
    unsubs.push(base.collection("streak").doc("main").onSnapshot(function (d) {
      ST = d.exists ? d.data() : {}; stReady = true; renderStreak();
    }, function () {}));
  }
  function detach() {
    unsubs.forEach(function (f) { try { f(); } catch (e) {} });
    unsubs = []; cols = null; last = null; katDoc = null; katReady = false;
    ST = null; stReady = false; seenStreak = false; pendDone = "";
    renderStreak();
  }
  function emit() {
    if (!active || !cols || !last) return;
    for (var i = 0; i < COLS.length; i++) if (cols[COLS[i]] === null) return;
    if (!katReady) return;
    var st = {};
    COLS.forEach(function (c) {
      var arr = cols[c].filter(function (x) { return x && x.id !== undefined; }).sort(byId);
      st[c] = arr;
      last[c] = {};
      arr.forEach(function (it) { last[c][it.id] = sj(it); });
    });
    if (katDoc) {
      st.kat = { keluar: katDoc.keluar || [], masuk: katDoc.masuk || [] };
      last.kat = sj(st.kat);
    } else last.kat = null;
    if (window.BJ_SETB) window.BJ_SETB(st);
  }

  function commitOps(ops) {
    for (var i = 0; i < ops.length; i += 400) {
      var b = db.batch();
      ops.slice(i, i + 400).forEach(function (o) { if (o.t === "s") b.set(o.r, o.d); else b.delete(o.r); });
      b.commit().catch(function (e) { note("Gagal menyimpan ke buku bersama: " + humanErr(e)); });
    }
  }
  // dipanggil aplikasi setiap data berubah di mode Bersama
  function changed(S) {
    if (!active || !book || !db || !last) return;
    var base = db.collection("books").doc(book.id), ops = [], said = [];
    function say(verb, c, it) {
      var w;
      if (c === "tx") w = (it.j === "masuk" ? "pemasukan" : it.j === "keluar" ? "pengeluaran" : "pindah dana") + " " + rpf(it.n) + (it.m ? " (" + it.m + ")" : "");
      else if (c === "acc") w = "dompet " + (it.nama || "");
      else if (c === "debts") w = (it.tipe === "hutang" ? "hutang " : it.tipe === "piutang" ? "piutang " : "paylater ") + (it.nama || "");
      else w = "aset " + (it.nama || "");
      said.push(verb + " " + w);
    }
    COLS.forEach(function (c) {
      var cur = {};
      (S[c] || []).forEach(function (it) { cur[it.id] = it; });
      var old = last[c];
      Object.keys(cur).forEach(function (id) {
        var j = sj(cur[id]);
        if (old[id] !== j) { say(id in old ? "mengubah" : "menambah", c, cur[id]); ops.push({ t: "s", r: base.collection(c).doc(String(id)), d: cur[id] }); old[id] = j; }
      });
      Object.keys(old).forEach(function (id) {
        if (!(id in cur)) { var o = {}; try { o = JSON.parse(old[id]); } catch (e) {} say("menghapus", c, o); ops.push({ t: "d", r: base.collection(c).doc(String(id)) }); delete old[id]; }
      });
    });
    if (S.kat) {
      var jk = sj(S.kat);
      if (jk !== last.kat) { said.push("mengubah kategori"); ops.push({ t: "s", r: base.collection("cfg").doc("kat"), d: S.kat }); last.kat = jk; }
    }
    if (ops.length) {
      var txt = said.slice(0, 3).join(", ") + (said.length > 3 ? " dan " + (said.length - 3) + " perubahan lain" : "");
      if (txt) ops.push({ t: "s", r: base.collection("log").doc(), d: { by: ME.uid, name: short(ME.email), t: fb.firestore.FieldValue.serverTimestamp(), txt: txt } });
      commitOps(ops);
    }
  }

  function enter() {
    if (!book) return;
    active = true;
    ls("bj.mode", "b"); ls("bj.hadShared", "1");
    attach();
    renderStreak();
  }
  function exit() {
    active = false; detach();
    ls("bj.mode", "p");
  }

  // ---------- Login dan keluar ----------
  function signInWithIdToken(t) {
    if (!auth) return Promise.reject(new Error("Mode Bersama belum tersedia."));
    return authReady.then(function () {
      var em = jwtEmail(t);
      if (auth.currentUser && em && (auth.currentUser.email || "").toLowerCase() === em) return;
      return auth.signInWithCredential(fb.auth.GoogleAuthProvider.credential(t));
    }).catch(function (e) { note(humanErr(e)); throw e; });
  }
  function signOut() {
    if (!auth) return Promise.resolve();
    var had = ls("bj.hadShared") === "1";
    exit(); stopTop(); ls("bj.mode", null);
    return auth.signOut().catch(function () {}).then(function () {
      if (!had) return;
      // hapus salinan data bersama di perangkat ini, lalu muat ulang agar bersih
      return db.terminate().then(function () { return db.clearPersistence(); }).catch(function () {}).then(function () {
        ls("bj.hadShared", null);
        try { location.reload(); } catch (e) {}
      });
    });
  }

  // ---------- Tindakan ----------
  function login() {
    if (!window.BJ_LOGIN) { note("Login hanya tersedia di aplikasi yang sudah diinstal."); return; }
    note("Membuka login Google...");
    window.BJ_LOGIN().then(function () {
      if (ME) { note(""); return; }
      if (msg === "Membuka login Google...") note("Login Google berhasil, tetapi belum masuk ke mode Bersama. Coba lagi.");
    }).catch(function (e) {
      if (msg === "Membuka login Google...") note(e && e.message ? e.message : "Login dibatalkan.");
    });
  }
  function resync() { if (active) emit(); }
  function createBook(name, friend, role) {
    if (book) { note("Anda sudah punya buku bersama."); return; }
    name = (name || "").trim();
    friend = (friend || "").trim().toLowerCase();
    if (!name) { note("Isi nama buku."); return; }
    if (friend && !validEmail(friend)) { note("Email teman tidak valid."); return; }
    if (friend && friend === myEmail()) { note("Itu email Anda sendiri."); return; }
    var ref = db.collection("books").doc();
    var data = { name: name, ownerUid: ME.uid, members: [ME.uid], memberEmails: {}, invited: friend ? [friend] : [], roles: {}, former: [], createdAt: fb.firestore.FieldValue.serverTimestamp() };
    if (friend) data.roles[keyOf(friend)] = role === "viewer" ? "viewer" : "editor";
    data.memberEmails[ME.uid] = ME.email || "";
    note("Membuat buku...");
    enterAfter = true;
    ref.set(data).then(function () {
      return ref.collection("acc").doc("1").set({ id: 1, nama: "Tunai", awal: 0 });
    }).then(function () { msg = ""; }).catch(function (e) { enterAfter = false; note(humanErr(e)); });
  }
  function accept(id) {
    if (book) { note("Anda sudah punya buku bersama. Keluar dulu dari buku itu."); return; }
    var up = { members: fb.firestore.FieldValue.arrayUnion(ME.uid), invited: fb.firestore.FieldValue.arrayRemove(myEmail()) };
    up["memberEmails." + ME.uid] = ME.email || "";
    enterAfter = true;
    db.collection("books").doc(id).update(up).catch(function (e) { enterAfter = false; note(humanErr(e)); });
  }
  function decline(id) {
    db.collection("books").doc(id).update({ invited: fb.firestore.FieldValue.arrayRemove(myEmail()) }).catch(function (e) { note(humanErr(e)); });
  }
  function invite(email, role) {
    email = (email || "").trim().toLowerCase();
    if (!book) return;
    if (!isOwner()) { note("Hanya pembuat buku yang bisa mengundang."); return; }
    if (!validEmail(email)) { note("Email teman tidak valid."); return; }
    if (email === myEmail()) { note("Itu email Anda sendiri."); return; }
    var mem = Object.keys(book.memberEmails || {}).map(function (k) { return String(book.memberEmails[k]).toLowerCase(); });
    if (mem.indexOf(email) >= 0) { note("Orang itu sudah menjadi anggota."); return; }
    if ((book.members || []).length >= 2) { note("Buku bersama maksimal 2 orang."); return; }
    var d = { invited: fb.firestore.FieldValue.arrayUnion(email), former: fb.firestore.FieldValue.arrayRemove(email), roles: {} };
    d.roles[keyOf(email)] = role === "viewer" ? "viewer" : "editor";
    db.collection("books").doc(book.id).set(d, { merge: true }).then(function () { note("Undangan dikirim ke " + email + ". Minta teman membuka aplikasi dan masuk dengan Google."); }).catch(function (e) { note(humanErr(e)); });
  }
  function setRole(email, role) {
    if (!book || !isOwner()) return;
    var d = { roles: {} };
    d.roles[keyOf(email)] = role === "viewer" ? "viewer" : "editor";
    db.collection("books").doc(book.id).set(d, { merge: true }).then(function () {
      note(short(email) + " sekarang " + (role === "viewer" ? "hanya bisa melihat." : "bisa mengubah data."));
    }).catch(function (e) { note(humanErr(e)); });
  }
  function cancelInvite(email) {
    if (!book) return;
    db.collection("books").doc(book.id).update({ invited: fb.firestore.FieldValue.arrayRemove(email) }).catch(function (e) { note(humanErr(e)); });
  }
  function deleteAll(ref) {
    var names = COLS.concat(["cfg", "log", "streak"]), chain = Promise.resolve();
    names.forEach(function (c) {
      chain = chain.then(function () { return ref.collection(c).get(); }).then(function (s) {
        var docs = s.docs, p = Promise.resolve();
        for (var i = 0; i < docs.length; i += 400) {
          (function (part) {
            p = p.then(function () { var b = db.batch(); part.forEach(function (d) { b.delete(d.ref); }); return b.commit(); });
          })(docs.slice(i, i + 400));
        }
        return p;
      });
    });
    return chain;
  }
  // ---------- Cadangan buku ke Drive pembuat ----------
  function snapshotBook(ref) {
    var out = {}, chain = Promise.resolve();
    COLS.forEach(function (c) {
      chain = chain.then(function () { return ref.collection(c).get(); }).then(function (s) {
        out[c] = s.docs.map(function (d) { return d.data(); }).filter(function (x) { return x && x.id !== undefined; });
      });
    });
    return chain.then(function () { return ref.collection("cfg").doc("kat").get(); }).then(function (d) {
      out.kat = d.exists ? d.data() : null;
      return ref.collection("streak").doc("main").get();
    }).then(function (d) { out.streak = d.exists ? d.data() : null; return out; });
  }
  function archiveBook(bk) {
    if (!window.BJ_DRIVE || !window.BJ_DRIVE.ok()) return Promise.reject(new Error("Login Google dengan akses Drive diperlukan untuk mencadangkan."));
    var ref = db.collection("books").doc(bk.id);
    return snapshotBook(ref).then(function (data) {
      var partners = Object.keys(bk.memberEmails || {}).filter(function (u) { return u !== bk.ownerUid; }).map(function (u) { return bk.memberEmails[u]; });
      var former = (bk.former || []).slice();
      return window.BJ_DRIVE.save(bk.id, { v: 1, kind: "book", bookId: bk.id, name: bk.name, ownerEmail: myEmail(), savedAt: Date.now(), partners: partners.concat(former), data: data });
    });
  }
  function backupNow() {
    if (!book || !isOwner()) return;
    note("Mencadangkan ke Google Drive...");
    archiveBook(book).then(function () { note("Buku sudah dicadangkan ke Google Drive Anda."); }).catch(function (e) { note("Gagal mencadangkan: " + humanErr(e)); });
  }
  // ---------- Keluar dengan persetujuan pembuat ----------
  function leave() {
    if (!book) return;
    if (navigator.onLine === false) { note("Perlu internet untuk meminta keluar dari buku bersama."); return; }
    if (isOwner()) { note("Pembuat buku tidak bisa keluar. Gunakan Hapus buku jika buku ini sudah tidak dipakai."); return; }
    if (book.leaveReq && book.leaveReq.uid === ME.uid) { note("Permintaan keluar masih menunggu persetujuan pembuat buku."); return; }
    if (!window.confirm("Kirim permintaan keluar ke pembuat buku? Anda baru keluar setelah pembuat menyetujui. Data tetap aman di akun pembuat.")) return;
    db.collection("books").doc(book.id).update({ leaveReq: { uid: ME.uid, by: ME.uid, email: myEmail(), at: Date.now(), atTs: fb.firestore.FieldValue.serverTimestamp() } })
      .then(function () { note("Permintaan keluar terkirim. Menunggu persetujuan pembuat buku."); }).catch(function (e) { note(humanErr(e)); });
  }
  function cancelLeave() {
    if (!book || !book.leaveReq) return;
    db.collection("books").doc(book.id).update({ leaveReq: fb.firestore.FieldValue.delete() })
      .then(function () { note("Permintaan keluar dibatalkan."); }).catch(function (e) { note(humanErr(e)); });
  }
  function rejectLeave() {
    if (!book || !book.leaveReq) return;
    db.collection("books").doc(book.id).update({ leaveReq: fb.firestore.FieldValue.delete() })
      .then(function () { note("Permintaan keluar ditolak."); }).catch(function (e) { note(humanErr(e)); });
  }
  var WAIT = 7 * 864e5, fin = false;
  function reqAt() { var r = book && book.leaveReq; if (!r) return 0; return r.atTs && r.atTs.toMillis ? r.atTs.toMillis() : (r.at || 0); }
  function reqDue() { return reqAt() ? new Date(reqAt() + WAIT).toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" }) : ""; }
  // 7 hari tanpa jawaban dianggap setuju: pengaju menyelesaikannya otomatis saat aplikasinya terbuka
  function autoFinish() {
    var r = book && book.leaveReq;
    if (!r || !ME || fin || !book.leaveReq.atTs || !(book.leaveReq.atTs.toMillis)) return;
    if ((r.by || r.uid) !== ME.uid) return;
    if (Date.now() < reqAt() + WAIT || navigator.onLine === false) return;
    fin = true;
    var ref = db.collection("books").doc(book.id), mine = r.uid === ME.uid, wasActive = active;
    var up = { members: fb.firestore.FieldValue.arrayRemove(r.uid), former: fb.firestore.FieldValue.arrayUnion(String(r.email || "").toLowerCase()), leaveReq: fb.firestore.FieldValue.delete() };
    up["memberEmails." + r.uid] = fb.firestore.FieldValue.delete();
    if (mine && wasActive && window.BJ_SWITCH) window.BJ_SWITCH("p");
    ref.update(up).then(function () {
      note(mine ? "Permintaan keluar disetujui otomatis karena tidak dijawab 7 hari. Anda sudah keluar." : "Ajakan berpisah disetujui otomatis karena tidak dijawab 7 hari.");
      if (window.BJ_TOAST) window.BJ_TOAST(mine ? "Kamu sudah keluar dari buku (7 hari tanpa jawaban)" : "Perpisahan selesai (7 hari tanpa jawaban)", "b");
    }).catch(function (e) { note(humanErr(e)); }).then(function () { fin = false; });
  }
  function reqBy() { return book && book.leaveReq ? (book.leaveReq.by || book.leaveReq.uid) : ""; }
  function approveLeave() {
    if (!book || !isOwner() || !book.leaveReq || reqBy() !== book.leaveReq.uid) return;
    if (navigator.onLine === false) { note("Perlu internet untuk menyetujui."); return; }
    var req = book.leaveReq, bk = book, ref = db.collection("books").doc(bk.id);
    if (!window.confirm(req.email + " akan keluar dari buku ini. Data buku dicadangkan dulu ke Google Drive Anda. Lanjutkan?")) return;
    note("Mencadangkan buku ke Google Drive...");
    archiveBook(bk).then(function () { return true; }, function (e) {
      return window.confirm("Cadangan ke Google Drive gagal (" + humanErr(e) + "). Tetap setujui tanpa cadangan? Datanya tetap ada di buku ini.");
    }).then(function (go) {
      if (!go) { note("Dibatalkan. Belum ada yang diubah."); return; }
      var up = { members: fb.firestore.FieldValue.arrayRemove(req.uid), former: fb.firestore.FieldValue.arrayUnion(req.email), leaveReq: fb.firestore.FieldValue.delete() };
      up["memberEmails." + req.uid] = fb.firestore.FieldValue.delete();
      return ref.update(up).then(function () { note(req.email + " sudah keluar. Buku dicadangkan di Google Drive Anda."); });
    }).catch(function (e) { note(humanErr(e)); });
  }
  // pembuat mengajak berpisah: perlu persetujuan teman; cadangan dibuat saat mengajukan
  function askEnd() {
    if (!book || !isOwner() || book.leaveReq) return;
    if (navigator.onLine === false) { note("Perlu internet."); return; }
    var pu = (book.members || []).filter(function (u) { return u !== ME.uid; })[0];
    if (!pu) { note("Tidak ada teman di buku ini."); return; }
    var pe = (book.memberEmails || {})[pu] || "";
    if (!window.confirm("Ajak " + (pe || "teman") + " berpisah dari buku ini? Dia baru keluar kalau dia setuju. Data dicadangkan dulu ke Google Drive Anda.")) return;
    var bk = book;
    note("Mencadangkan buku ke Google Drive...");
    archiveBook(bk).then(function () { return true; }, function (e) {
      return window.confirm("Cadangan ke Google Drive gagal (" + humanErr(e) + "). Tetap ajukan tanpa cadangan?");
    }).then(function (go) {
      if (!go) { note("Dibatalkan."); return; }
      return db.collection("books").doc(bk.id).update({ leaveReq: { uid: pu, by: ME.uid, email: String(pe).toLowerCase(), at: Date.now(), atTs: fb.firestore.FieldValue.serverTimestamp() } })
        .then(function () { note("Ajakan berpisah terkirim. Menunggu persetujuan " + (pe || "teman") + "."); });
    }).catch(function (e) { note(humanErr(e)); });
  }
  function agreeEnd() {
    if (!book || isOwner() || !book.leaveReq || book.leaveReq.uid !== ME.uid || reqBy() !== book.ownerUid) return;
    if (navigator.onLine === false) { note("Perlu internet."); return; }
    if (!window.confirm("Setuju keluar dari buku ini? Anda tidak bisa melihat datanya lagi. Data tetap aman di Google Drive pembuat, dan Anda bisa diundang kembali.")) return;
    var ref = db.collection("books").doc(book.id), uid = ME.uid;
    if (active && window.BJ_SWITCH) window.BJ_SWITCH("p");
    var up = { members: fb.firestore.FieldValue.arrayRemove(uid), former: fb.firestore.FieldValue.arrayUnion(myEmail()), leaveReq: fb.firestore.FieldValue.delete() };
    up["memberEmails." + uid] = fb.firestore.FieldValue.delete();
    ref.update(up).then(function () { note("Anda sudah keluar dari buku bersama."); }).catch(function (e) { note(humanErr(e)); });
  }
  function deleteBook() {
    if (!book || !isOwner()) return;
    if ((book.members || []).length > 1) { note("Buku tidak bisa dihapus selama masih ada teman. Ajak berpisah dulu, dan tunggu dia setuju."); return; }
    if (navigator.onLine === false) { note("Perlu internet untuk menghapus buku."); return; }
    if (!window.confirm("Hapus buku bersama \"" + book.name + "\" untuk SEMUA anggota? Data buku dicadangkan dulu ke Google Drive Anda, jadi bisa dipulihkan saat membuat buku baru.")) return;
    var bk = book, ref = db.collection("books").doc(bk.id);
    note("Mencadangkan buku ke Google Drive...");
    archiveBook(bk).then(function () { return true; }, function (e) {
      return window.confirm("Cadangan ke Google Drive gagal (" + humanErr(e) + "). Hapus tetap dilanjutkan? Data TIDAK bisa dipulihkan.") && window.confirm("Yakin? Ini tidak bisa dibatalkan.");
    }).then(function (go) {
      if (!go) { note("Dibatalkan. Buku tidak dihapus."); return; }
      if (active && window.BJ_SWITCH) window.BJ_SWITCH("p");
      return deleteAll(ref).then(function () { return ref.delete(); }).then(function () { ARCH = null; note("Buku bersama dihapus. Cadangannya ada di Google Drive Anda."); });
    }).catch(function (e) { note(humanErr(e)); });
  }

  // ---------- Pulihkan buku lama dari Drive ----------
  function loadArch() {
    if (!window.BJ_DRIVE || !window.BJ_DRIVE.ok()) { note("Login Google dengan akses Drive diperlukan."); return; }
    if (archBusy) return;
    archBusy = true; note("Mencari cadangan buku di Google Drive...");
    window.BJ_DRIVE.list().then(function (l) {
      ARCH = l.filter(function (x) { return x.d && x.d.kind === "book" && x.d.data; }).sort(function (a, b) { return (b.d.savedAt || 0) - (a.d.savedAt || 0); });
      note(ARCH.length ? "" : "Belum ada cadangan buku di Google Drive Anda.");
    }).catch(function (e) { note("Gagal membaca Drive: " + humanErr(e)); }).then(function () { archBusy = false; render(); });
  }
  function restoreBook(fid, friend, role) {
    if (book) { note("Anda sudah punya buku bersama."); return; }
    var it = (ARCH || []).filter(function (x) { return x.id === fid; })[0];
    if (!it) return;
    friend = (friend || "").trim().toLowerCase();
    if (friend && !validEmail(friend)) { note("Email teman tidak valid."); return; }
    if (friend && friend === myEmail()) { note("Itu email Anda sendiri."); return; }
    var dt = it.d.data, ref = db.collection("books").doc();
    var data = { name: it.d.name || "Buku pulihan", ownerUid: ME.uid, members: [ME.uid], memberEmails: {}, invited: friend ? [friend] : [], roles: {}, former: [], createdAt: fb.firestore.FieldValue.serverTimestamp() };
    if (friend) data.roles[keyOf(friend)] = role === "viewer" ? "viewer" : "editor";
    data.memberEmails[ME.uid] = ME.email || "";
    var ops = [];
    COLS.forEach(function (c) { (dt[c] || []).forEach(function (x) { ops.push({ r: ref.collection(c).doc(String(x.id)), d: x }); }); });
    if (dt.kat) ops.push({ r: ref.collection("cfg").doc("kat"), d: dt.kat });
    if (dt.streak) ops.push({ r: ref.collection("streak").doc("main"), d: dt.streak });
    note("Memulihkan buku \"" + data.name + "\"...");
    enterAfter = true;
    var chain = ref.set(data);
    for (var i = 0; i < ops.length; i += 400) {
      (function (part) {
        chain = chain.then(function () { var b = db.batch(); part.forEach(function (o) { b.set(o.r, o.d); }); return b.commit(); });
      })(ops.slice(i, i + 400));
    }
    chain.then(function () { msg = ""; ARCH = null; }).catch(function (e) { enterAfter = false; note("Gagal memulihkan: " + humanErr(e)); });
  }
  function delArch(fid) {
    if (!window.confirm("Hapus cadangan buku ini dari Google Drive? Tidak bisa dibatalkan.")) return;
    window.BJ_DRIVE.remove(fid).then(function () { ARCH = (ARCH || []).filter(function (x) { return x.id !== fid; }); render(); }).catch(function (e) { note("Gagal menghapus: " + humanErr(e)); });
  }

  // ---------- Tampilan panel ----------
  var KEEP = ["bbName", "bbFriend", "bbInv", "bbRole", "bbRole2"];
  function roleSel(id, val) {
    return '<select id="' + id + '"><option value="editor"' + (val !== "viewer" ? " selected" : "") + '>Bisa mengubah data</option><option value="viewer"' + (val === "viewer" ? " selected" : "") + '>Hanya melihat</option></select>';
  }
  function render() {
    var el = $("bbBody");
    if (!el) return;
    var keep = {};
    KEEP.forEach(function (k) { var x = $(k); if (x) keep[k] = x.value; });
    var h = "";
    if (!db) {
      h = '<p class="lbl">Mode Bersama belum tersedia di versi aplikasi ini.</p>';
    } else if (!ME) {
      h = '<p class="lbl">Mode Bersama dipakai untuk mengelola keuangan berdua. Data tersimpan online dan bisa dipakai offline. Masuk dengan Google untuk memulai.</p>' +
        '<button class="save" data-bb="login" type="button" style="margin-top:10px">Masuk dengan Google</button>';
    } else if (!book) {
      h = '<p class="lbl">Masuk sebagai ' + esc(ME.email || "") + '</p>';
      if (INVITES.length) {
        h += '<h2 style="margin-top:14px">Undangan untuk Anda</h2>';
        INVITES.forEach(function (b) {
          var who = Object.keys(b.memberEmails || {}).map(function (k) { return b.memberEmails[k]; }).join(", ");
          h += '<div class="item"><div class="top"><div><b>' + esc(b.name) + '</b><small>Dari ' + esc(who) + '</small></div></div>' +
            '<div class="acts"><button class="sm" data-bb="accept" data-id="' + esc(b.id) + '" type="button">Terima</button><button class="sm" data-bb="decline" data-id="' + esc(b.id) + '" type="button">Tolak</button></div></div>';
        });
      }
      h += '<h2 style="margin-top:14px">Buat buku bersama</h2>' +
        '<label>Nama buku<input id="bbName" type="text" maxlength="30" placeholder="Keuangan berdua"></label>' +
        '<label>Email teman (boleh diisi nanti)<input id="bbFriend" type="email" autocapitalize="off" placeholder="teman@gmail.com"></label>' +
        '<label>Hak teman<span style="display:block">' + roleSel("bbRole2", "editor") + '</span></label>' +
        '<p class="lbl" style="font-size:.8rem">Anda sebagai pembuat buku. Data buku tetap tersimpan di akun Anda walau teman keluar, dan bisa diundang kembali.</p>' +
        '<button class="save" data-bb="create" type="button">Buat buku</button>';
      h += '<h2 style="margin-top:18px">Buku lama</h2><p class="lbl" style="font-size:.8rem">Pernah punya buku bersama yang dihapus atau ditinggal? Cadangannya ada di Google Drive Anda dan bisa dipulihkan, juga dengan teman yang berbeda.</p>';
      if (ARCH === null) h += '<button class="sm" data-bb="archload" type="button"' + (archBusy ? " disabled" : "") + '>' + (archBusy ? "Mencari..." : "Lihat cadangan buku lama") + '</button>';
      else if (ARCH.length) {
        ARCH.forEach(function (x) {
          var d = x.d, n = d.data || {}, when = d.savedAt ? new Date(d.savedAt).toLocaleString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
          h += '<div class="item"><div class="top"><div><b>' + esc(d.name || "Buku") + '</b><small>Dicadangkan ' + esc(when) + ' · ' + ((n.tx || []).length) + ' transaksi · ' + ((n.acc || []).length) + ' dompet</small>' +
            ((d.partners && d.partners.length) ? '<small>Teman sebelumnya: ' + esc(d.partners.join(", ")) + '</small>' : '') + '</div></div>' +
            '<div class="acts"><button class="sm" data-bb="restore" data-id="' + esc(x.id) + '" type="button">Pulihkan buku ini</button><button class="sm" data-bb="archdel" data-id="' + esc(x.id) + '" type="button">Hapus cadangan</button></div></div>';
        });
        h += '<p class="lbl" style="font-size:.8rem">Saat memulihkan, email teman dan hak teman di atas ikut dipakai. Boleh dikosongkan dan diundang nanti.</p>';
      }
    } else {
      var mem = Object.keys(book.memberEmails || {}).map(function (k) { return { uid: k, email: book.memberEmails[k] }; });
      var owner = isOwner();
      h = '<h2>' + esc(book.name) + '</h2>';
      if (readOnly()) h += '<p class="lbl"><b>Anda hanya bisa melihat buku ini.</b> Pembuat buku yang mengatur hak ubah.</p>';
      h += '<p class="lbl">Anggota</p>';
      mem.forEach(function (m) {
        var isMe = ME && m.uid === ME.uid, isOwn = m.uid === book.ownerUid;
        h += '<div class="line"><span>' + esc(m.email) + (isMe ? " (Anda)" : "") + '<small style="display:block">' + (isOwn ? "Pembuat buku" : (roleOf(m.email) === "viewer" ? "Hanya melihat" : "Bisa mengubah data")) + '</small></span>';
        if (owner && !isOwn) h += '<select data-bbrole="' + esc(m.email) + '" aria-label="Hak anggota" style="max-width:48%"><option value="editor"' + (roleOf(m.email) !== "viewer" ? " selected" : "") + '>Bisa mengubah</option><option value="viewer"' + (roleOf(m.email) === "viewer" ? " selected" : "") + '>Hanya melihat</option></select>';
        h += '</div>';
      });
      if (book.leaveReq) {
        if (owner && reqBy() === book.ownerUid) h += '<p class="lbl" style="margin-top:10px"><b>Ajakan berpisah menunggu persetujuan ' + esc(book.leaveReq.email || "teman") + '.</b><br>Dianggap setuju otomatis jika tidak dijawab sampai ' + esc(reqDue()) + '.</p><button class="sm" data-bb="cancelleave" type="button">Batalkan ajakan</button>';
        else if (!owner && book.leaveReq.uid === ME.uid && reqBy() === book.ownerUid) h += '<h2 style="margin-top:14px">Ajakan berpisah</h2><p class="lbl">Pembuat buku mengajak berpisah dari buku ini. Datanya sudah dicadangkan di Google Drive pembuat. Jika tidak dijawab sampai ' + esc(reqDue()) + ', dianggap setuju.</p><div class="acts"><button class="sm" data-bb="agreeend" type="button">Setuju, keluar</button><button class="sm" data-bb="noleave" type="button">Tolak</button></div>';
        else if (owner) h += '<h2 style="margin-top:14px">Permintaan keluar</h2><div class="line"><span>' + esc(book.leaveReq.email || "") + ' ingin keluar dari buku ini<small style="display:block">Data dicadangkan ke Google Drive Anda saat disetujui. Jika tidak dijawab sampai ' + esc(reqDue()) + ', dianggap setuju.</small></span></div><div class="acts"><button class="sm" data-bb="okleave" type="button">Setujui</button><button class="sm" data-bb="noleave" type="button">Tolak</button></div>';
        else if (book.leaveReq.uid === ME.uid) h += '<p class="lbl" style="margin-top:10px"><b>Permintaan keluar menunggu persetujuan pembuat buku.</b><br>Dianggap setuju otomatis jika tidak dijawab sampai ' + esc(reqDue()) + '.</p><button class="sm" data-bb="cancelleave" type="button">Batalkan permintaan</button>';
      }
      var inv = book.invited || [];
      if (inv.length) {
        h += '<p class="lbl" style="margin-top:10px">Menunggu diterima</p>';
        inv.forEach(function (e) { h += '<div class="line"><span>' + esc(e) + '<small style="display:block">' + (roleOf(e) === "viewer" ? "Hanya melihat" : "Bisa mengubah data") + '</small></span>' + (owner ? '<button class="sm" data-bb="cancel" data-id="' + esc(e) + '" type="button">Batalkan</button>' : "") + '</div>'; });
      }
      var inMem = mem.map(function (m) { return String(m.email).toLowerCase(); });
      var former = (book.former || []).filter(function (e) { return inMem.indexOf(e) < 0 && inv.indexOf(e) < 0; });
      if (owner && former.length && (book.members || []).length < 2) {
        h += '<p class="lbl" style="margin-top:10px">Pernah bergabung (datanya tetap tersimpan di buku ini)</p>';
        former.forEach(function (e) { h += '<div class="line"><span>' + esc(e) + '</span><button class="sm" data-bb="reinvite" data-id="' + esc(e) + '" type="button">Undang lagi</button></div>'; });
      }
      if (owner && (book.members || []).length < 2 && !inv.length) {
        h += '<h2 style="margin-top:14px">Undang teman</h2>' +
          '<label>Email teman<input id="bbInv" type="email" autocapitalize="off" placeholder="teman@gmail.com"></label>' +
          '<label>Hak teman<span style="display:block">' + roleSel("bbRole", "editor") + '</span></label>' +
          '<button class="save" data-bb="invite" type="button">Undang</button>';
      }
      if (LOG.length) {
        h += '<h2 style="margin-top:16px">Aktivitas terbaru</h2>';
        LOG.slice(0, 8).forEach(function (x) {
          var d = ts(x) ? new Date(ts(x)).toLocaleString("id-ID", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "baru saja";
          h += '<div class="line"><span>' + esc(x.name || "") + " " + esc(x.txt || "") + '<small style="display:block">' + esc(d) + '</small></span></div>';
        });
      }
      h += '<div class="acts" style="margin-top:14px">' +
        (active ? "" : '<button class="sm" data-bb="open" type="button">Buka buku bersama</button>') +
        (owner ? '<button class="sm" data-bb="backup" type="button">Cadangkan ke Drive</button>' + ((book.members || []).length > 1 ? (book.leaveReq ? '' : '<button class="sm" data-bb="askend" type="button">Ajak berpisah</button>') : '<button class="sm" data-bb="delbook" type="button">Hapus buku</button>') : (book.leaveReq && book.leaveReq.uid === ME.uid ? '' : '<button class="sm" data-bb="leave" type="button">Minta keluar dari buku</button>')) + '</div>';
      if (panelOpen()) markSeen();
    }
    if (msg) h += '<p class="err" role="status">' + esc(msg) + '</p>';
    el.innerHTML = h;
    KEEP.forEach(function (k) { var x = $(k); if (x && keep[k]) x.value = keep[k]; });
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-bb]");
    if (!t) return;
    var a = t.getAttribute("data-bb"), id = t.getAttribute("data-id");
    msg = "";
    if (a === "login") login();
    else if (!db || !ME) { render(); }
    else if (a === "create") createBook($("bbName") && $("bbName").value, $("bbFriend") && $("bbFriend").value, $("bbRole2") && $("bbRole2").value);
    else if (a === "accept") accept(id);
    else if (a === "decline") decline(id);
    else if (a === "invite") invite($("bbInv") && $("bbInv").value, $("bbRole") && $("bbRole").value);
    else if (a === "reinvite") invite(id, book && book.roles && book.roles[keyOf(id)]);
    else if (a === "delbook") deleteBook();
    else if (a === "cancel") cancelInvite(id);
    else if (a === "leave") leave();
    else if (a === "cancelleave") cancelLeave();
    else if (a === "askend") askEnd();
    else if (a === "agreeend") agreeEnd();
    else if (a === "okleave") approveLeave();
    else if (a === "noleave") rejectLeave();
    else if (a === "backup") backupNow();
    else if (a === "archload") loadArch();
    else if (a === "restore") restoreBook(id, $("bbFriend") && $("bbFriend").value, $("bbRole2") && $("bbRole2").value);
    else if (a === "archdel") delArch(id);
    else if (a === "open") { if (window.BJ_SWITCH) window.BJ_SWITCH("b"); }
    else render();
  });

  document.addEventListener("change", function (e) {
    var t = e.target, em = t && t.getAttribute && t.getAttribute("data-bbrole");
    if (em && db && ME) setRole(em, t.value);
  });


  // ---------- Api (streak) berdua ----------
  var CHANCES = 3;
  var FLAME = '<svg class="flame" viewBox="0 0 64 64" aria-hidden="true"><path class="f1" d="M33 3c1 10 12 16 16 27 4 11-1 22-10 27-7 4-18 3-24-3-7-7-7-17-2-25 2-3 6-6 7-11 1-3 0-8 2-12 4 3 6 7 6 12 2-2 3-5 3-9 1-2 1-4 2-6z"/><path class="f2" d="M32 29c1 6 8 9 9 16 1 6-4 11-9 11s-10-4-9-10c1-6 7-10 9-17z"/></svg>';
  function dkey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function addDays(s, n) { var d = new Date(s + "T00:00:00"); d.setDate(d.getDate() + n); return dkey(d); }
  function diffDays(a, b) { return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 864e5); }
  function stRef() { return db.collection("books").doc(book.id).collection("streak").doc("main"); }
  function partnerName() {
    var m = (book && book.memberEmails) || {}, k = Object.keys(m).filter(function (u) { return ME && u !== ME.uid; })[0];
    return k ? short(m[k]) : "";
  }
  function streakCalc() {
    var t = dkey(new Date()), y = addDays(t, -1), st = ST || {};
    var uids = (book && book.members) || [], lit = st.lit || {};
    var all = uids.length > 0 && uids.every(function (u) { return lit[u] === t; });
    var done = {}, fix = {}, days = {};
    (st.done || []).forEach(function (d) { done[d] = 1; days[d] = 1; });
    (st.fix || []).forEach(function (d) { fix[d] = 1; days[d] = 1; });
    var needDone = all && !done[t];
    if (all) { done[t] = 1; days[t] = 1; }
    var end = days[t] ? t : (days[y] ? y : null), cur = 0, d = end;
    while (d && days[d]) { if (done[d]) cur++; d = addDays(d, -1); }
    var arr = Object.keys(days).sort(), best = 0, run = 0, prev = null;
    arr.forEach(function (x) {
      run = (prev && diffDays(prev, x) === 1 ? run : 0) + (done[x] ? 1 : 0);
      if (run > best) best = run;
      prev = x;
    });
    var used = (st.used && st.used[t.slice(0, 7)]) || 0, left = Math.max(0, CHANCES - used);
    var offer = null, broken = !end && arr.length > 0;
    if (broken) {
      var lastD = arr[arr.length - 1], gap = diffDays(lastD, t) - 1;
      if (gap >= 1 && gap <= left) offer = { gap: gap, from: lastD };
    }
    var me = ME ? lit[ME.uid] === t : false;
    var others = uids.filter(function (u) { return ME && u !== ME.uid; });
    var other = others.length > 0 && others.every(function (u) { return lit[u] === t; });
    return { today: t, cur: cur, best: best, me: me, other: other, all: all, needDone: needDone, left: left, offer: offer, broken: broken };
  }
  // pencapaian api: warna dan aura berubah menurut jumlah hari beruntun
  var TIERS = [
    { d: 1, n: "Percikan", c: "#ff8a1f" }, { d: 3, n: "Api Kecil", c: "#ffb300" }, { d: 7, n: "Api Berkobar", c: "#ff3b30" },
    { d: 14, n: "Api Biru", c: "#1e88ff" }, { d: 30, n: "Api Ungu", c: "#8e44ff" }, { d: 60, n: "Api Zamrud", c: "#00b86b" },
    { d: 100, n: "Api Pelangi", c: "#ff3b30" }, { d: 365, n: "Api Abadi", c: "#ffd36b" }
  ];
  function tierOf(n) { var t = null; TIERS.forEach(function (x) { if (n >= x.d) t = x; }); return t; }
  function tierNext(n) { for (var i = 0; i < TIERS.length; i++) if (TIERS[i].d > n) return TIERS[i]; return null; }
  function renderStreak() {
    var el = $("streakCard");
    if (!el) return;
    if (!active || !book || !ME || !db) { el.classList.add("hide"); return; }
    el.classList.remove("hide");
    if (!stReady) { el.className = "streak"; el.innerHTML = '<p class="lbl">Memuat api...</p>'; return; }
    var c = streakCalc(), p = partnerName();
    if (c.needDone && pendDone !== c.today) {
      pendDone = c.today;
      stRef().set({ done: fb.firestore.FieldValue.arrayUnion(c.today) }, { merge: true }).catch(function () { pendDone = ""; });
    }
    if (seenStreak && c.all && !prevAll && window.BJ_TOAST) window.BJ_TOAST("Api kalian menyala! " + Math.max(c.cur, 1) + " hari beruntun", "ok");
    seenStreak = true; prevAll = c.all;
    var msg;
    if (c.all) msg = p ? "Kamu dan " + p + " sudah menyalakan api hari ini. Sampai jumpa besok!" : "Kamu sudah menyalakan api hari ini. Sampai jumpa besok!";
    else if (c.me) msg = "Kamu sudah menyalakan api. Menunggu " + (p || "temanmu") + "...";
    else if (c.other) msg = p + " sudah menyalakan api. Giliranmu!";
    else if (c.cur > 0) msg = "Nyalakan api hari ini supaya tidak padam.";
    else if (c.broken) msg = "Api sedang padam. Nyalakan lagi untuk memulai dari awal.";
    else msg = "Belum ada api. Nyalakan hari ini!";
    var h = '<div class="sk-top">' + FLAME + '<div><div class="sk-n">' + c.cur + '<small>hari beruntun</small></div></div></div>' +
      '<p class="sk-msg">' + esc(msg) + '</p>';
    if (c.offer) h += '<p class="sk-msg">Api sempat padam ' + c.offer.gap + ' hari. Kamu bisa memulihkannya dengan ' + c.offer.gap + ' kesempatan (sisa ' + c.left + ' bulan ini).</p>';
    h += '<div class="sk-act"><button class="save" data-api="light" type="button"' + (c.me ? " disabled" : "") + '>' + (c.me ? "Api sudah kamu nyalakan" : "Nyalakan api") + '</button>' +
      (c.offer ? '<button class="sm" data-api="recover" type="button">Pulihkan api</button>' : "") + '</div>' +
      '<p class="sk-meta">Rekor terbaik ' + c.best + ' hari · Kesempatan pulih bulan ini ' + c.left + ' dari ' + CHANCES + '</p>';
    var lit = c.all || c.me || c.other, tr = tierOf(Math.max(c.cur, lit ? 1 : 0)), nx = tierNext(c.cur);
    var bt = tierOf(c.best);
    // tanda tingkat + daftar pencapaian
    h = h.replace('<p class="sk-msg">', (tr ? '<span class="sk-tier">' + esc(tr.n) + '</span>' : '') + '<p class="sk-msg">');
    h += '<p class="sk-meta">' + (nx ? "Tingkat berikutnya: " + esc(nx.n) + " (" + (nx.d - c.cur) + " hari lagi)" : "Tingkat tertinggi tercapai") + '</p>';
    h += '<div class="sk-ach" aria-label="Pencapaian">' + TIERS.map(function (x) {
      return '<span class="ach' + (c.best >= x.d ? " on" : "") + '" style="--c:' + x.c + '" title="' + esc(x.n) + '"><i></i>' + x.d + ' hari</span>';
    }).join("") + '</div>';
    el.className = "streak " + (tr ? "tier-" + tr.d + " " : "") + (c.all ? "full" : (c.me || c.other ? "half" : (c.cur > 0 ? "idle" : "")));
    el.innerHTML = h;
    if (bt && c.cur > 0) {
      var key = "bj.tier." + book.id, seen = parseInt(ls(key) || "0", 10) || 0, ct = tierOf(c.cur);
      if (ct && ct.d > seen) {
        ls(key, String(ct.d));
        if (seen > 0 && window.BJ_TOAST) window.BJ_TOAST("Pencapaian baru: " + ct.n + " (" + ct.d + " hari beruntun)", "ok");
      }
    }
  }
  function streakLog(txt) {
    db.collection("books").doc(book.id).collection("log").doc().set({ by: ME.uid, name: short(ME.email), t: fb.firestore.FieldValue.serverTimestamp(), txt: txt }).catch(function () {});
  }
  function lightFire() {
    if (!active || !book || !ME || !stReady) return;
    var c = streakCalc();
    if (c.me) return;
    var d = { lit: {} }; d.lit[ME.uid] = c.today;
    stRef().set(d, { merge: true }).then(function () { streakLog("menyalakan api"); }).catch(function (e) { note(humanErr(e)); });
    if (window.BJ_TOAST) window.BJ_TOAST("Api kamu menyala", "ok");
  }
  function recoverFire() {
    if (!active || !book || !ME || !stReady) return;
    var c = streakCalc();
    if (!c.offer) return;
    var days = [], i;
    for (i = 1; i <= c.offer.gap; i++) days.push(addDays(c.offer.from, i));
    if (!window.confirm("Pulihkan api dengan " + days.length + " kesempatan? Sisa kesempatan bulan ini jadi " + (c.left - days.length) + ".")) return;
    var F = fb.firestore.FieldValue, d = { fix: F.arrayUnion.apply(F, days), used: {} };
    d.used[c.today.slice(0, 7)] = F.increment(days.length);
    stRef().set(d, { merge: true }).then(function () { streakLog("memulihkan api"); if (window.BJ_TOAST) window.BJ_TOAST("Api dipulihkan", "ok"); }).catch(function (e) { note(humanErr(e)); });
  }
  document.addEventListener("click", function (e) {
    var t = e.target.closest && e.target.closest("[data-api]");
    if (!t) return;
    var a = t.getAttribute("data-api");
    if (a === "light") lightFire(); else if (a === "recover") recoverFire();
  });
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { renderStreak(); autoFinish(); } });

  window.BJB = {
    readOnly: readOnly, resync: resync, isOwner: isOwner, renderStreak: renderStreak,
    available: function () { return !!db; },
    canEnter: function () { return !!(db && ME && book); },
    enter: enter, exit: exit, changed: changed, render: render, badge: badge,
    name: function () { return book ? book.name : ""; },
    signInWithIdToken: signInWithIdToken, signOut: signOut, note: note
  };
  init();
  render();
})();
