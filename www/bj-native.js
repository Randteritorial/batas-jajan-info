/* Batas Jajan - lapisan native: unduh file, login Google, sinkron ke Google Drive (appDataFolder) */
(function () {
  "use strict";

  // ====== ISI INI ======
  var WEB_CLIENT_ID = "321813585395-md1dtfu41bm1jc37mf32p5n73lkodpv1.apps.googleusercontent.com"; // OAuth client type "Web application"
  var IOS_CLIENT_ID = ""; // OAuth client type "iOS" (kosongkan jika belum membuat iOS)
  // =====================

  var SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  var FILE_NAME = "batas-jajan-data.json";
  var APP_KEY = "keuangan.v2";

  var C = window.Capacitor || {};
  var P = C.Plugins || {};
  var isNative = !!(C.isNativePlatform && C.isNativePlatform());

  var token = null, tokenExp = 0, inited = false, busy = false, timer = null;

  function $(id) { return document.getElementById(id); }
  function ls(k, v) {
    try {
      if (v === undefined) return localStorage.getItem(k);
      if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }
  function user() { try { return JSON.parse(ls("bj.user") || "null"); } catch (e) { return null; } }
  function online() { return navigator.onLine !== false; }
  function say(t) {
    var a = $("sync"); if (a) a.textContent = t;
    var b = $("gMsg"); if (b) b.textContent = t;
  }
  function refreshUi() {
    var u = user();
    var i = $("gIn"), o = $("gOut"), s = $("gNow"), w = $("gWho");
    if (i) i.classList.toggle("hide", !!u);
    if (o) o.classList.toggle("hide", !u);
    if (s) s.classList.toggle("hide", !u);
    if (w) w.textContent = u ? ("Masuk sebagai " + (u.email || u.name || "akun Google")) : "Belum masuk. Data hanya tersimpan di perangkat ini.";
  }

  // ---------- Unduh / bagikan file ----------
  function toBase64(d) {
    if (typeof d === "string") return btoa(unescape(encodeURIComponent(d)));
    var bytes = d instanceof Uint8Array ? d : new Uint8Array(d);
    var s = "", CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    return btoa(s);
  }
  window.BJ_DL = {
    save: function (o) {
      if (isNative && P.Filesystem && P.Share) {
        return P.Filesystem.writeFile({ path: o.filename, data: toBase64(o.data), directory: "CACHE" })
          .then(function () { return P.Filesystem.getUri({ path: o.filename, directory: "CACHE" }); })
          .then(function (r) { return P.Share.share({ title: o.filename, url: r.uri, dialogTitle: "Simpan atau bagikan file" }); })
          .catch(function (e) {
            if (/cancel/i.test(String(e && (e.message || e)))) return Promise.reject({ code: "declined" });
            return Promise.reject(e);
          });
      }
      return new Promise(function (res) {
        var blob = new Blob([o.data], { type: "application/octet-stream" });
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob); a.download = o.filename;
        document.body.appendChild(a); a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); res(); }, 500);
      });
    }
  };

  // ---------- Login Google ----------
  function initLogin() {
    if (inited) return Promise.resolve();
    if (!isNative || !P.SocialLogin) return Promise.reject(new Error("Login Google hanya tersedia di aplikasi yang sudah diinstal."));
    if (/ISI_WEB_CLIENT_ID/.test(WEB_CLIENT_ID)) return Promise.reject(new Error("Client ID Google belum diisi di bj-native.js."));
    var g = { webClientId: WEB_CLIENT_ID, mode: "online" };
    if (IOS_CLIENT_ID) g.iOSClientId = IOS_CLIENT_ID;
    return P.SocialLogin.initialize({ google: g }).then(function () { inited = true; });
  }
  function doLogin(force) {
    return initLogin().then(function () {
      return P.SocialLogin.login({ provider: "google", options: { scopes: ["email", "profile", SCOPE], forceRefreshToken: !!force } });
    }).then(function (r) {
      var res = r.result || {};
      var t = res.accessToken && res.accessToken.token;
      if (!t) throw new Error("Google tidak memberi izin akses Drive.");
      token = t; tokenExp = Date.now() + 50 * 60 * 1000;
      ls("bj.tok", t); ls("bj.tokExp", String(tokenExp));
      var p = res.profile || {};
      ls("bj.user", JSON.stringify({ email: p.email || "", name: p.name || "" }));
      window.BJ_IDTOKEN = res.idToken || null;
      refreshUi();
      // masuk juga ke mode Bersama (Firebase) memakai login Google yang sama
      if (window.BJB && res.idToken) return window.BJB.signInWithIdToken(res.idToken).catch(function () {});
    });
  }
  function loadSavedToken() {
    var t = ls("bj.tok"), e = +ls("bj.tokExp") || 0;
    if (t && Date.now() < e - 60000) { token = t; tokenExp = e; }
  }
  function getToken(interactive) {
    if (!token) loadSavedToken();
    if (token && Date.now() < tokenExp) return Promise.resolve(token);
    if (!interactive) return Promise.reject(new Error("NEED_LOGIN"));
    return doLogin(true).then(function () { return token; });
  }

  // ---------- Drive API ----------
  function api(url, opt) {
    opt = opt || {};
    opt.headers = Object.assign({ Authorization: "Bearer " + token }, opt.headers || {});
    return fetch(url, opt).then(function (r) {
      if (r.status === 401) { token = null; ls("bj.tok", null); throw new Error("NEED_LOGIN"); }
      if (!r.ok) throw new Error("Drive " + r.status);
      return r;
    });
  }
  function findFile() {
    var q = encodeURIComponent("name='" + FILE_NAME + "'");
    return api("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=" + q + "&fields=files(id)")
      .then(function (r) { return r.json(); })
      .then(function (j) { return j.files && j.files[0] ? j.files[0].id : null; });
  }
  function download(id) {
    return api("https://www.googleapis.com/drive/v3/files/" + id + "?alt=media").then(function (r) { return r.json(); });
  }
  function upload(id, body, fname) {
    var text = JSON.stringify(body);
    if (id) {
      return api("https://www.googleapis.com/upload/drive/v3/files/" + id + "?uploadType=media", {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: text
      });
    }
    var b = "bjboundary" + Date.now();
    var meta = JSON.stringify({ name: fname || FILE_NAME, parents: ["appDataFolder"], mimeType: "application/json" });
    var multi = "--" + b + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" + meta +
      "\r\n--" + b + "\r\nContent-Type: application/json\r\n\r\n" + text + "\r\n--" + b + "--";
    return api("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST", headers: { "Content-Type": "multipart/related; boundary=" + b }, body: multi
    });
  }

  // ---------- Sinkronisasi ----------
  function isEmptyState() {
    try {
      var s = JSON.parse(window.BJ_GET());
      return !s.tx.length && !s.debts.length && !s.assets.length && s.acc.every(function (a) { return !a.awal; });
    } catch (e) { return true; }
  }
  function sync(interactive) {
    var u = user();
    if (!u || busy) return Promise.resolve();
    if (!online()) { say("Offline. Perubahan akan dicadangkan saat ada internet."); return Promise.resolve(); }
    busy = true; say("Menyinkronkan...");
    return getToken(interactive).then(findFile).then(function (id) {
      var firstLink = ls("bj.linked") !== (u.email || "-");
      var dirty = ls("bj.dirty") === "1" || (firstLink && !isEmptyState());
      var localAt = +ls("bj.updated") || Date.now();
      var remoteAt = +ls("bj.remoteAt") || 0;
      var push = function () {
        var at = dirty ? localAt : Date.now();
        return upload(id, { v: 1, updatedAt: at, state: JSON.parse(window.BJ_GET()) }).then(function () {
          ls("bj.dirty", "0"); ls("bj.updated", String(at)); ls("bj.remoteAt", String(at));
          ls("bj.linked", u.email || "-");
        });
      };
      if (!id) return push();
      return download(id).then(function (rem) {
        var rAt = +rem.updatedAt || 0, rState = rem.state;
        var apply = function () {
          window.BJ_APPLY(JSON.stringify(rState));
          ls("bj.dirty", "0"); ls("bj.updated", String(rAt)); ls("bj.remoteAt", String(rAt));
          ls("bj.linked", u.email || "-");
        };
        var remoteChanged = rAt > remoteAt;
        if (remoteChanged && dirty) {
          var useDrive = window.confirm("Data di Google Drive berbeda dengan data di perangkat ini.\n\nOK = pakai data Google Drive (data perangkat diganti)\nBatal = pakai data perangkat (data Drive ditimpa)");
          return useDrive ? apply() : push();
        }
        if (remoteChanged) return apply();
        if (dirty) return push();
      });
    }).then(function () {
      ls("bj.lastOk", String(Date.now()));
      say("Tersimpan di Google Drive " + new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }));
    }).catch(function (e) {
      if (e && e.message === "NEED_LOGIN") say("Cadangan tertunda: izin Google habis. Ketuk Sinkronkan sekarang di menu Riwayat.");
      else say("Sinkron gagal: " + (e && e.message ? e.message : "coba lagi nanti"));
    }).then(function () { busy = false; });
  }

  // dipanggil app setiap data berubah
  function changed() {
    ls("bj.dirty", "1"); ls("bj.updated", String(Date.now()));
    if (!user()) return;
    clearTimeout(timer);
    timer = setTimeout(function () { sync(false); }, 3000);
  }

  // ---------- Tombol ----------
  function wire() {
    var i = $("gIn"), o = $("gOut"), s = $("gNow");
    if (i) i.onclick = function () {
      say("Membuka login Google...");
      doLogin(false).then(function () { return sync(true); }).catch(function (e) {
        say(e && e.message ? e.message : "Login dibatalkan.");
      });
    };
    if (s) s.onclick = function () { sync(true); };
    if (o) o.onclick = function () {
      var finish = function () {
        var out = P.SocialLogin && P.SocialLogin.logout ? P.SocialLogin.logout({ provider: "google" }).catch(function () {}) : Promise.resolve();
        out.then(function () {
          if (window.BJ_SWITCH) window.BJ_SWITCH("p");
          token = null;
          ["bj.tok", "bj.tokExp", "bj.user", "bj.dirty", "bj.updated", "bj.remoteAt", "bj.linked"].forEach(function (k) { ls(k, null); });
          ls(APP_KEY, null);
          window.BJ_RESET();
          refreshUi(); say("Sudah keluar. Data di perangkat dihapus; data tetap aman di Google Drive.");
          if (window.BJB) window.BJB.signOut();
        });
      };
      sync(false).then(function () {
        if (ls("bj.dirty") === "1" && !window.confirm("Ada perubahan yang belum tersimpan ke Google Drive dan akan hilang jika keluar. Tetap keluar?")) return;
        finish();
      });
    };
    document.addEventListener("visibilitychange", function () { if (!document.hidden) sync(false); });
    window.addEventListener("online", function () { sync(false); });
    if (P.Network && P.Network.addListener) P.Network.addListener("networkStatusChange", function (st) { if (st && st.connected) sync(false); });
  }

  // cadangan buku bersama di Drive pembuat (folder khusus aplikasi), satu berkas per buku
  var BK = "bj-book-";
  function findByName(n) {
    var q = encodeURIComponent("name='" + n + "'");
    return api("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=" + q + "&fields=files(id)")
      .then(function (r) { return r.json(); }).then(function (j) { return j.files && j.files[0] ? j.files[0].id : null; });
  }
  window.BJ_DRIVE = {
    ok: function () { return !!user(); },
    save: function (bookId, obj) {
      var n = BK + bookId + ".json";
      return getToken(true).then(function () { return findByName(n); }).then(function (id) { return upload(id, obj, n); });
    },
    list: function () {
      var q = encodeURIComponent("name contains '" + BK + "'");
      return getToken(true).then(function () {
        return api("https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=" + q + "&fields=files(id,name)&pageSize=50");
      }).then(function (r) { return r.json(); }).then(function (j) {
        var fs = j.files || [];
        return Promise.all(fs.map(function (f) {
          return download(f.id).then(function (d) { return { id: f.id, name: f.name, d: d }; }).catch(function () { return null; });
        }));
      }).then(function (a) { return a.filter(Boolean); });
    },
    remove: function (id) {
      return getToken(true).then(function () { return api("https://www.googleapis.com/drive/v3/files/" + id, { method: "DELETE" }); });
    }
  };

  window.BJ_LOGIN = function () { return doLogin(false); };
  window.BJ = { changed: changed, sync: sync };
  window.BJ_INIT = function () {
    wire(); refreshUi();
    if (user()) {
      // Tetap dianggap masuk. Login otomatis hanya dicoba jika izin habis DAN ada data belum tercadang / cadangan sudah lama.
      // Cadangan memakai izin yang tersimpan; jika sudah kedaluwarsa, ketuk "Sinkronkan sekarang".
      loadSavedToken();
      var needAuto = !(token && Date.now() < tokenExp) && online() &&
        (ls("bj.dirty") === "1" || Date.now() - (+ls("bj.lastOk") || 0) > 6 * 3600 * 1000);
      if (needAuto) doLogin(false).catch(function () {}).then(function () { return sync(false); });
      else sync(false);
    }
  };
})();
