var DEFAULT_BASE_URL = 'http://10.20.30.40';
var DEFAULT_TMDB_KEY = 'b5ce7bb7d827e838685ef4b98ff4941f';
var VID = '(?:mkv|mp4|m3u8)';

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

function absUrl(base, src) {
  src = src.replace(/&amp;/g, '&');
  if (src.indexOf('//') === 0) src = 'http:' + src;
  else if (/^https?:/i.test(src)) src = src;
  else if (src.charAt(0) === '/') src = base + src;
  else src = base + '/' + src;
  return src.replace(/ /g, '%20');
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

// find a playable source in a player/episode page
function sourceFrom(html) {
  var m = html.match(/<source[^>]+src=["']([^"']+)["']/i)
       || html.match(new RegExp('["\']([^"\']*/Data/[^"\']+\\.' + VID + '[^"\']*)["\']', 'i'))
       || html.match(new RegExp('["\'](https?:[^"\']+\\.' + VID + '[^"\']*)["\']', 'i'));
  return m ? m[1] : null;
}

// TV: find the episode on the view page (links / text), else try player params
function findEpisode(base, id, season, episode) {
  var viewUrl = base + '/view.php?id=' + id;
  return fetch(viewUrl).then(function (r) { return r.text(); }).then(function (html) {
    // 1) direct video links on the page that match the episode
    var vre = new RegExp('href=["\']([^"\']+\\.' + VID + '[^"\']*)["\']', 'gi'), m;
    while ((m = vre.exec(html))) {
      if (epMatch(m[1], season, episode)) return { src: m[1], ref: viewUrl };
    }
    // 2) anchors (href or text) that match the episode -> follow
    var cand = [];
    var are = /<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
    while ((m = are.exec(html))) {
      var href = m[1], text = m[2].replace(/<[^>]+>/g, ' ');
      if (/^(#|javascript:)/i.test(href)) continue;
      if (epMatch(href + ' ' + text, season, episode)) cand.push(href.replace(/&amp;/g, '&'));
    }
    return cand.slice(0, 3).reduce(function (p, href) {
      return p.then(function (found) {
        if (found) return found;
        var u = absUrl(base, href);
        if (new RegExp('\\.' + VID + '(\\?|$)', 'i').test(u)) return { src: u, ref: viewUrl };
        return fetch(u).then(function (r) { return r.text(); }).then(function (h2) {
          var s2 = sourceFrom(h2);
          return s2 ? { src: s2, ref: u } : null;
        }).catch(function () { return null; });
      });
    }, Promise.resolve(null)).then(function (found) {
      if (found) return found;
      // 3) player.php with episode params (guess)
      var tries = [
        base + '/player.php?id=' + id + '&season=' + season + '&episode=' + episode,
        base + '/player.php?id=' + id + '&s=' + season + '&e=' + episode
      ];
      return tries.reduce(function (p, u) {
        return p.then(function (f) {
          if (f) return f;
          return fetch(u).then(function (r) { return r.text(); }).then(function (h3) {
            var s3 = sourceFrom(h3);
            return s3 && epMatch(s3, season, episode) ? { src: s3, ref: u } : null;
          }).catch(function () { return null; });
        });
      }, Promise.resolve(null));
    });
  });
}

function getStreams(tmdbId, mediaType, season, episode) {
  var isTv = mediaType === 'tv';
  if (isTv && (!season || !episode)) return Promise.resolve([]);

  var settings = (typeof globalThis !== 'undefined' && globalThis.SCRAPER_SETTINGS) || {};
  var BASE = String(settings.basplayBaseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  var TMDB_KEY = settings.tmdbApiKey || DEFAULT_TMDB_KEY;

  return fetch('https://api.themoviedb.org/3/' + (isTv ? 'tv' : 'movie') + '/' + tmdbId + '?api_key=' + TMDB_KEY)
    .then(function (r) { return r.json(); })
    .then(function (t) {
      var title = t.title || t.name || '';
      var year = (t.release_date || t.first_air_date || '').slice(0, 4);
      var short = title.split(':')[0];

      return search(BASE, title).then(function (res) {
        if (!res.length && short !== title) return search(BASE, short);
        return res;
      }).then(function (res) {
        var nt = norm(title);
        var hit = res.filter(function (r) { return norm(r.title) === nt && r.year === year; })[0]
               || res.filter(function (r) { return norm(r.title) === nt; })[0]
               || res.filter(function (r) { return r.year === year && norm(r.title).indexOf(norm(short)) === 0; })[0]
               || (isTv ? res.filter(function (r) { return norm(r.title).indexOf(nt) === 0; })[0] : null);
        if (!hit) return [];

        var found;
        if (isTv) {
          found = findEpisode(BASE, hit.id, season, episode);
        } else {
          var url = BASE + '/player.php?id=' + hit.id;
          found = fetch(url).then(function (r) { return r.text(); }).then(function (html) {
            var s = sourceFrom(html);
            return s ? { src: s, ref: url } : null;
          });
        }
        return found.then(function (f) {
          if (!f) return [];
          var src = absUrl(BASE, f.src);
          var q = (dec(src).match(/(2160|1080|720|480)p/i) || [])[0] || 'Unknown';
          var label = isTv
            ? title + ' S' + ('0' + season).slice(-2) + 'E' + ('0' + episode).slice(-2) + ' ' + q
            : title + ' ' + q;
          return [{
            name: 'BAS PLAY',
            title: label,
            url: src,
            quality: q,
            headers: { Referer: f.ref },
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
