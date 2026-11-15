// Firebase bağlantısı: Google ile giriş ve kullanıcının kayıtlarını saklama.
// Kitaplık yalnızca giriş istendiğinde yüklenir; yüklenemezse uygulama girişsiz çalışmaya devam eder.
// Her kullanıcının verisi tek belgede durur: users/{uid}/apps/kuyruk

var SDK = 'https://www.gstatic.com/firebasejs/13.3.0/';

export function connectFirebase(config) {
  return Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore-lite.js')
  ]).then(function (m) {
    var app = m[0].initializeApp(config), auth = m[1].getAuth(app), db = m[2].getFirestore(app);
    function ref(uid) { return m[2].doc(db, 'users', uid, 'apps', 'kuyruk'); }
    return {
      onUser: function (fn) { m[1].onAuthStateChanged(auth, fn); },
      signIn: function () { return m[1].signInWithPopup(auth, new m[1].GoogleAuthProvider()); },
      signOut: function () { return m[1].signOut(auth); },
      load: function (uid) { return m[2].getDoc(ref(uid)).then(function (s) { return s.exists() ? s.data() : null; }); },
      save: function (uid, data) { return m[2].setDoc(ref(uid), data); }
    };
  });
}
