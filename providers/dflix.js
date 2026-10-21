var DEFAULT_BASE_URL = 'https://movies.discoveryftp.net';
var DEFAULT_TMDB_KEY = 'b5ce7bb7d827e838685ef4b98ff4941f';

function norm(s) {
  return (s || '').toLowerCase().replace(/&amp;/g, 'and').replace(/[^a-z0-9]+/g, '');
}

function getMeta(id, key) {
  return fetch('https://api.themoviedb.org/3/movie/' + id + '?api_key=' + key)
    .then(function (r) { return r.json(); })
    .then(function (t) {
      return { title: t.title || '', year: (t.release_date || '').slice(0, 4) };
    });
}

function search(base, q) {
  return fetch(base + '/m/find/' + encodeURIComponent(q))
    .then(function (r) { return r.text(); })
    .then(function (html) {
      var out = [];
      html.split('<div class="card"').slice(1).forEach(function (p) {
        var id = (p.match(/href=["']\/m\/view\/(\d+)["']/) || [])[1];
        if (!id) return;
        var d = p.slice(p.indexOf('class="details"'));
        var tokens = d.replace(/<[^>]+>/g, '|').split('|')
          .map(function (s) { return s.replace(/&amp;/g, '&').replace(/&#039;|&#39;/g, "'").trim(); })
          .filter(Boolean);
        var year = (tokens.join(' ').match(/(\d{4})-\d{2}-\d{2}/) || [])[1] || '';
        out.push({ id: id, tokens: tokens, year: year });
      });
      return out;
    });
}

function pick(res, title, year) {
  var nt = norm(title);
  function has(r) {
    return r.tokens.some(function (t) { return norm(t) === nt; });
  }
  return res.filter(function (r) { return has(r) && r.year === year; })[0]
      || res.filter(has)[0];
}

function fix(base, src) {
  src = src.replace(/&amp;/g, '&').replace(/ /g, '%20').replace(/\[/g, '%5B').replace(/\]/g, '%5D');
  if (src.indexOf('//') === 0) src = 'https:' + src;
  else if (src.charAt(0) === '/') src = base + src;
  return src;
}

function files(base, html) {
  var out = [], re = /href=["']([^"']+\.(?:mkv|mp4|m3u8))["']/gi, m;
  while ((m = re.exec(html))) out.push(fix(base, m[1]));
  return out;
}

function getStreams(tmdbId, mediaType) {
  if (mediaType === 'tv') return Promise.resolve([]);

  var settings = (typeof globalThis !== 'undefined' && globalThis.SCRAPER_SETTINGS) || {};
  var BASE = String(settings.dflixBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  var TMDB_KEY = settings.tmdbApiKey || DEFAULT_TMDB_KEY;

  return getMeta(tmdbId, TMDB_KEY).then(function (t) {
    var title = t.title, year = t.year, short = title.split(':')[0];
    return search(BASE, title)
      .then(function (res) {
        var h = pick(res, title, year);
        if (h || short === title) return h;
        return search(BASE, short).then(function (r2) { return pick(r2, title, year) || pick(r2, short, year); });
      })
      .then(function (hit) {
        if (!hit) return [];
        var page = BASE + '/m/view/' + hit.id;
        return fetch(page).then(function (r) { return r.text(); }).then(function (html) {
          var top = html.split('Cast And Crew')[0];
          var links = files(BASE, top);
          var others = [], seen = {}, re = /href=["']\/m\/view\/(\d+)["']/g, m;
          while ((m = re.exec(top))) {
            if (m[1] !== hit.id && !seen[m[1]]) { seen[m[1]] = 1; others.push(m[1]); }
          }
          return Promise.all(others.slice(0, 3).map(function (id) {
            return fetch(BASE + '/m/view/' + id)
              .then(function (r) { return r.text(); })
              .then(function (h2) { return files(BASE, h2.split('Cast And Crew')[0]); })
              .catch(function () { return []; });
          })).then(function (more) {
            more.forEach(function (a) { links = links.concat(a); });
            var done = {};
            return links.filter(function (u) { return !done[u] && (done[u] = 1); }).map(function (u) {
              var q = (decodeURIComponent(u).match(/(2160|1080|720|480)p/i) || [])[0] || 'Unknown';
              return {
                name: 'DFLIX',
                title: title + ' ' + q,
                url: u,
                quality: q,
                headers: { Referer: page },
                provider: 'dflix'
              };
            });
          });
        });
      });
  }).catch(function () { return []; });
}

function onSettings() {
  return Promise.resolve([
    { type: 'header', label: 'DFLIX Configuration' },
    {
      type: 'text',
      key: 'dflixBaseUrl',
      label: 'DFLIX Base URL',
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
