/* The Fart Machine 2.0 — precache every static asset and clip. */
var CACHE = "fart-machine-2-v1";

var PRECACHE = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./manifest.webmanifest",
  "./clips.json",
  "./icons/favicon.svg",
  "./icons/apple-touch-icon.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./audio/01-captain-kirk.mp3",
  "./audio/02-german-fart.mp3",
  "./audio/03-homer-fart.mp3",
  "./audio/04-low-rider.mp3",
  "./audio/05-mumble-fart.mp3",
  "./audio/06-quick-fart.mp3",
  "./audio/07-ripper-fart.mp3",
  "./audio/08-wet-fart.mp3",
  "./audio/09-salsa-fart.mp3",
  "./audio/10-the-ripper.mp3",
  "./audio/11-yummy-fart.mp3",
  "./audio/12-tuba-fart.mp3",
  "./audio/13-oops.mp3",
  "./audio/14-oh-yea-fart.mp3",
  "./audio/15-bonus.mp3",
  "./audio/16-squeaky.mp3"
];

self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(PRECACHE);
    }).then(function () {
      return self.skipWaiting();
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key !== CACHE;
      }).map(function (key) {
        return caches.delete(key);
      }));
    }).then(function () {
      return self.clients.claim();
    }).then(function () {
      return self.clients.matchAll({ includeUncontrolled: true });
    }).then(function (clients) {
      clients.forEach(function (client) {
        client.postMessage({ type: "offline-ready" });
      });
    })
  );
});

self.addEventListener("message", function (event) {
  if (!event.data || event.data.type !== "cache-check" || !event.source) return;
  event.source.postMessage({ type: "offline-ready" });
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.method !== "GET") return;

  var url;
  try {
    url = new URL(request.url);
  } catch (err) {
    return;
  }

  if (url.origin !== self.location.origin) return;
  /* Never cache-first the worker itself, or updates can stick forever. */
  if (url.pathname.endsWith("/sw.js")) return;

  var range = request.headers.get("range");
  if (range) {
    event.respondWith(ranged(request, range));
    return;
  }

  event.respondWith(cacheFirst(request));
});

function cacheFirst(request) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request).then(function (cached) {
      if (cached) return cached;
      return fetch(request).then(function (response) {
        if (response && response.status === 200 && response.type === "basic") {
          cache.put(request, response.clone());
        }
        return response;
      }).catch(function () {
        if (request.mode === "navigate") {
          return cache.match("./index.html").then(function (index) {
            return index || cache.match("./") || offlineResponse();
          });
        }
        return offlineResponse();
      });
    });
  });
}

function ranged(request, rangeHeader) {
  return caches.open(CACHE).then(function (cache) {
    return cache.match(request.url).then(function (cached) {
      if (cached) return sliceRange(cached, rangeHeader);
      return fetch(request.url).then(function (response) {
        if (response && response.status === 200) {
          return cache.put(request.url, response.clone()).then(function () {
            return sliceRange(response, rangeHeader);
          });
        }
        return response;
      }).catch(function () {
        return offlineResponse();
      });
    });
  });
}

function sliceRange(response, rangeHeader) {
  return response.arrayBuffer().then(function (buffer) {
    var size = buffer.byteLength;
    var match = /^bytes=(\d*)-(\d*)$/i.exec(String(rangeHeader).trim());
    if (!match) {
      return new Response(buffer, {
        status: 200,
        statusText: "OK",
        headers: baseHeaders(response, size)
      });
    }

    var start = match[1] === "" ? null : Number(match[1]);
    var end = match[2] === "" ? null : Number(match[2]);

    if (start === null && end !== null) {
      start = Math.max(0, size - end);
      end = size - 1;
    } else {
      if (start === null) start = 0;
      if (end === null || end >= size) end = size - 1;
    }

    if (!isFinite(start) || !isFinite(end) || start < 0 || start >= size || end < start) {
      return new Response(null, {
        status: 416,
        statusText: "Range Not Satisfiable",
        headers: { "Content-Range": "bytes */" + size }
      });
    }

    var chunk = buffer.slice(start, end + 1);
    var headers = baseHeaders(response, chunk.byteLength);
    headers.set("Content-Range", "bytes " + start + "-" + end + "/" + size);
    return new Response(chunk, {
      status: 206,
      statusText: "Partial Content",
      headers: headers
    });
  });
}

function baseHeaders(response, length) {
  var headers = new Headers();
  var type = response.headers.get("Content-Type");
  if (type) headers.set("Content-Type", type);
  headers.set("Content-Length", String(length));
  headers.set("Accept-Ranges", "bytes");
  return headers;
}

function offlineResponse() {
  return new Response("Offline", {
    status: 503,
    statusText: "Offline",
    headers: { "Content-Type": "text/plain; charset=utf-8" }
  });
}
