var DEFAULT_BASE_URL = 'http://10.20.30.40';
var DEFAULT_TMDB_KEY = 'b5ce7bb7d827e838685ef4b98ff4941f';

function norm(s) {
  return (s || '').toLowerCase().replace(/&amp;/g, 'and').replace(/[^a-z0-9]+/g, '');
}

function search(base, q) {
  return fetch(base + '/search.php?q=' + encodeURIComponent(q))
    .then(function (r) { return r.text(); })
    .then(function (html) {
      var out = [];
      var re = /<a[^>]+href=["']view\.php\?id=(\d+)["'][^>]*>([\s\S]*?)<\/a>/gi, m;
      while ((m = re.exec(html))) {
        var alt = (m[2].match(/alt=["']([^"']*)["']/i) || [])[1] || '';
        var year = (m[2].match(/\b(19|20)\d{2}\b/) || [])[0] || '';
        out.push({ id: m[1], title: alt, year: year });
      }
      return out;
    });
}

function getStreams(tmdbId, mediaType) {
  // TV not supported yet (episode addressing unknown)
  if (mediaType === 'tv') return Promise.resolve([]);

  var settings = (typeof globalThis !== 'undefined' && globalThis.SCRAPER_SETTINGS) || {};
  var BASE = String(settings.basplayBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  var TMDB_KEY = settings.tmdbApiKey || DEFAULT_TMDB_KEY;

  return fetch('https://api.themoviedb.org/3/movie/' + tmdbId + '?api_key=' + TMDB_KEY)
    .then(function (r) { return r.json(); })
    .then(function (t) {
      var title = t.title || '';
      var year = (t.release_date || '').slice(0, 4);
      var short = title.split(':')[0];

      return search(BASE, title).then(function (res) {
        if (!res.length && short !== title) return search(BASE, short);
        return res;
      }).then(function (res) {
        var nt = norm(title);
        var hit = res.filter(function (r) { return norm(r.title) === nt && r.year === year; })[0]
               || res.filter(function (r) { return norm(r.title) === nt; })[0]
               || res.filter(function (r) { return r.year === year && norm(r.title).indexOf(norm(short)) === 0; })[0];
        if (!hit) return [];

        var url = BASE + '/player.php?id=' + hit.id;
        return fetch(url).then(function (r) { return r.text(); }).then(function (html) {
          var m = html.match(/<source[^>]+src=["']([^"']+)["']/i)
               || html.match(/["']([^"']*\/Data\/[^"']+\.(?:mkv|mp4|m3u8)[^"']*)["']/i)
               || html.match(/["'](https?:[^"']+\.(?:mkv|mp4|m3u8)[^"']*)["']/i);
          if (!m) return [];
          var src = m[1].replace(/&amp;/g, '&');
          if (src.indexOf('//') === 0) src = 'http:' + src;
          else if (src.charAt(0) === '/') src = BASE + src;
          src = src.replace(/ /g, '%20');
          var q = (decodeURIComponent(src).match(/(2160|1080|720|480)p/i) || [])[0] || 'Unknown';
          return [{
            name: 'BAS PLAY',
            title: title + ' ' + q,
            url: src,
            quality: q,
            headers: { Referer: url },
            provider: 'basplay'
          }];
        });
      });
    })
    .catch(function () { return []; });
}

function onSettings() {
  return Promise.resolve([
    { type: 'header', label: 'BAS PLAY Configuration' },
    {
      type: 'text',
      key: 'basplayBaseUrl',
      label: 'BAS PLAY Base URL',
      placeholder: DEFAULT_BASE_URL,
      defaultValue: DEFAULT_BASE_URL,
      description: 'Default: ' + DEFAULT_BASE_URL
    },
    { type: 'header', label: 'TMDB' },
    {
      type: 'text',
      key: 'tmdbApiKey',
      label: 'TMDB API Key (optional)',
      placeholder: 'Your TMDB v3 API key',
      description: 'Built-in key is used when blank.'
    }
  ]);
}

module.exports = { getStreams: getStreams, onSettings: onSettings };

if (typeof globalThis !== 'undefined' && typeof module !== 'undefined' && module.exports) {
  globalThis.getStreams = module.exports.getStreams;
  globalThis.onSettings = module.exports.onSettings;
}
