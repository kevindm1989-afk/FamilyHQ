/* eslint-disable */
// Family HQ — FCM background service worker (PR B4).
//
// Vanilla CommonJS / no bundler — the browser fetches this file directly from
// the site origin. importScripts() pulls the firebase compat builds into the
// SW global scope; this is the canonical Web Push pattern documented by the
// Firebase team. Hardcoded URL versions match the firebase package pinned in
// package.json.
//
// HARD INVARIANT: this file MUST NOT hardcode any field-specific text. It
// relays the payload FCM delivered (which the server composed under M34
// payload hygiene) straight to the OS. No template substitution. No PI
// substrings. The static scan in serviceWorker.test.ts enforces this — if
// the test grep ever flags a substring here, the SW has drifted off
// payload-relay duty.
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js');

// Public web app config (these are public identifiers, NOT secrets —
// the real authority is firestore.rules + App Check). The literal object
// between the two marker comments below is substituted at `vite build`
// time by the inline plugin in vite.config.ts; the source file keeps a
// hardcoded placeholder so static unit tests + dev mode have a working
// SW even before the build runs.
firebase.initializeApp(
  /* __FIREBASE_CONFIG_START__ */ {
    apiKey: 'web-public-identifier',
    authDomain: 'familyhq.firebaseapp.com',
    projectId: 'familyhq',
    storageBucket: 'familyhq.appspot.com',
    messagingSenderId: '000000000000',
    appId: '1:000000000000:web:0000000000000000000000',
  } /* __FIREBASE_CONFIG_END__ */,
);

var messaging = firebase.messaging();

// Background-message handler — runs when the page is not visible. The
// payload was composed server-side under the vague-by-default policy
// (architect's brief §1). We pass it through to the OS verbatim — no
// templating, no fallback PI lookup.
messaging.onBackgroundMessage(function (payload) {
  var title = (payload && payload.notification && payload.notification.title) || 'Family HQ';
  var options = {
    body: (payload && payload.notification && payload.notification.body) || '',
    data: (payload && payload.data) || {},
  };
  return self.registration.showNotification(title, options);
});

// Notification-click handler — focus an existing client if one matches the
// data.url; otherwise open a new window at data.url (default '/').
self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then(function (clientList) {
        for (var i = 0; i < clientList.length; i++) {
          var client = clientList[i];
          if (client.url.indexOf(url) !== -1 && 'focus' in client) {
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
