var DEFAULT_BASE_URL = 'https://movies.discoveryftp.net';
var DEFAULT_TMDB_KEY = 'b5ce7bb7d827e838685ef4b98ff4941f';

function norm(s) {
  return (s || '').toLowerCase().replace(/&amp;/g, 'and').replace(/[^a-z0-9]+/g, '');
}

function dec(s) {
  try { return decodeURIComponent(s); } catch (e) { return s; }
}

function epMatch(str, s, e) {
  str = dec(str || '');
  var S = String(parseInt(s, 10)), E = String(parseInt(e, 10));
  return new RegExp('s0*' + S + '[ ._-]*e0*' + E + '(?!\\d)', 'i').test(str)
      || new RegExp('(^|[^0-9])0*' + S + 'x0*' + E + '(?!\\d)', 'i').test(str)
      || new RegExp('season[ ._-]*0*' + S + '[^]*?episode[ ._-]*0*' + E + '(?!\\d)', 'i').test(str)
      || (new RegExp('season[ ._-]*0*' + S + '(?!\\d)', 'i').test(str)
          && new RegExp('(^|[^a-z0-9])e(?:p|pisode)?[ ._-]*0*' + E + '(?!\\d)', 'i').test(str));
}

function getMeta(kind, id, key) {
  return fetch('https://api.themoviedb.org/3/' + kind + '/' + id + '?api_key=' + key)
    .then(function (r) { return r.json(); })
    .then(function (t) {
      return {
        title: t.title || t.name || '',
        year: (t.release_date || t.first_air_date || '').slice(0, 4)
      };
    });
}

// kind: 'm' (movies) or 's' (series)
function search(base, kind, q) {
  var viewRe = new RegExp('href=["\']/' + kind + '/view/(\\d+)["\']');
  return fetch(base + '/' + kind + '/find/' + encodeURIComponent(q))
    .then(function (r) { return r.text(); })
    .then(function (html) {
      var out = [];
      html.split('<div class="card"').slice(1).forEach(function (p) {
        var id = (p.match(viewRe) || [])[1];
        if (!id) return;
        var d = p.slice(Math.max(0, p.indexOf('class="details"')));
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

function uniq(arr) {
  var done = {};
  return arr.filter(function (u) { return !done[u] && (done[u] = 1); });
}

function movieLinks(base, hit, page) {
  return fetch(page).then(function (r) { return r.text(); }).then(function (html) {
    var top = html.split('Cast And Crew')[0];
    var links = files(base, top);
    var others = [], seen = {}, re = /href=["']\/m\/view\/(\d+)["']/g, m;
    while ((m = re.exec(top))) {
      if (m[1] !== hit.id && !seen[m[1]]) { seen[m[1]] = 1; others.push(m[1]); }
    }
    return Promise.all(others.slice(0, 3).map(function (id) {
      return fetch(base + '/m/view/' + id)
        .then(function (r) { return r.text(); })
        .then(function (h2) { return files(base, h2.split('Cast And Crew')[0]); })
        .catch(function () { return []; });
    })).then(function (more) {
      more.forEach(function (a) { links = links.concat(a); });
      return uniq(links);
    });
  });
}

// series: collect file links from the series page + its season/episode sub-pages
function tvLinks(base, hit, page, season, episode) {
  return fetch(page).then(function (r) { return r.text(); }).then(function (html) {
    var links = files(base, html);
    var subs = [], seen = {}, re = /href=["'](\/s\/[^"']+)["']/g, m;
    while ((m = re.exec(html))) {
      var h = m[1].replace(/&amp;/g, '&');
      if (/\/s\/find\//.test(h) || h === '/s/view/' + hit.id || seen[h]) continue;
      // only follow links tied to this show or to season/episode pages
      if (h.indexOf(hit.id) === -1 && !/season|episode|ep|[?&]s=|[?&]e=/i.test(h)) continue;
      seen[h] = 1; subs.push(h);
    }
    return Promise.all(subs.slice(0, 8).map(function (h) {
      return fetch(base + h)
        .then(function (r) { return r.text(); })
        .then(function (h2) { return files(base, h2); })
        .catch(function () { return []; });
    })).then(function (more) {
      more.forEach(function (a) { links = links.concat(a); });
      links = uniq(links);
      var exact = links.filter(function (u) { return epMatch(u, season, episode); });
      return exact;
    });
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var isTv = mediaType === 'tv';
  if (isTv && (!season || !episode)) return Promise.resolve([]);

  var settings = (typeof globalThis !== 'undefined' && globalThis.SCRAPER_SETTINGS) || {};
  var BASE = String(settings.dflixBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  var TMDB_KEY = settings.tmdbApiKey || DEFAULT_TMDB_KEY;
  var kind = isTv ? 's' : 'm';

  return getMeta(isTv ? 'tv' : 'movie', tmdbId, TMDB_KEY).then(function (t) {
    var title = t.title, year = t.year, short = title.split(':')[0];
    return search(BASE, kind, title)
      .then(function (res) {
        var h = pick(res, title, year);
        if (h || short === title) return h;
        return search(BASE, kind, short).then(function (r2) { return pick(r2, title, year) || pick(r2, short, year); });
      })
      .then(function (hit) {
        if (!hit) return [];
        var page = BASE + '/' + kind + '/view/' + hit.id;
        var linksP = isTv ? tvLinks(BASE, hit, page, season, episode) : movieLinks(BASE, hit, page);
        return linksP.then(function (links) {
          var ep = isTv ? ' S' + ('0' + season).slice(-2) + 'E' + ('0' + episode).slice(-2) : '';
          return links.map(function (u) {
            var q = (dec(u).match(/(2160|1080|720|480)p/i) || [])[0] || 'Unknown';
            return {
              name: 'Discovery Flix',
              title: title + ep + ' ' + q,
              url: u,
              quality: q,
              headers: { Referer: page },
              provider: 'dflix'
            };
          });
        });
      });
  }).catch(function () { return []; });
}

function onSettings() {
  return Promise.resolve([
    { type: 'header', label: 'Discovery Flix Configuration' },
    {
      type: 'text',
      key: 'dflixBaseUrl',
      label: 'Discovery Flix Base URL',
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
