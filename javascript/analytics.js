// ComicCluck shared analytics loader (Google Tag Manager).
// Include once per page: <script src="javascript/analytics.js"></script>
// Change GTM_ID here and every page picks it up.
(function (w, d, s, l, i) {
  w[l] = w[l] || [];
  w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
  var f = d.getElementsByTagName(s)[0],
      j = d.createElement(s);
  j.async = true;
  j.src = 'https://www.googletagmanager.com/gtm.js?id=' + i;
  f.parentNode.insertBefore(j, f);
})(window, document, 'script', 'dataLayer', 'GTM-5HNFZFMQ');

// Optional helper for custom events from any page, e.g. track('comic_published', { frames: 12 })
window.track = function (name, params) {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(Object.assign({ event: name }, params || {}));
};
