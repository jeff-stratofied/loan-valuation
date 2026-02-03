self.addEventListener('install', e => {
  e.waitUntil(
    caches.open('loan-cache').then(cache => {
      return cache.addAll([
        '/loan-valuation/loanValuation.html',
        '/loan-valuation/valuationEngine.js',
        '/loan-valuation/loans.json',  // etc.
      ]);
    })
  );
});

self.addEventListener('fetch', e => {
  e.respondWith(caches.match(e.request).then(res => res || fetch(e.request)));
});
