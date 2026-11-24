(function () {
  "use strict";

  var CACHE_NAME = "fart-machine-2-v1";
  var CORE_SUFFIXES = [
    "index.html",
    "styles.css",
    "app.js",
    "manifest.webmanifest",
    "clips.json",
    "icons/favicon.svg",
    "icons/apple-touch-icon.png",
    "icons/icon-192.png",
    "icons/icon-512.png"
  ];

  var board = document.getElementById("board");
  var stopBtn = document.getElementById("stop");
  var randomBtn = document.getElementById("random");
  var overlapBtn = document.getElementById("overlap");
  var overlapPill = document.getElementById("overlap-pill");
  var badge = document.getElementById("offline-badge");
  var statusEl = document.getElementById("status");

  var clips = [];
  var rafId = 0;
  var engine = createEngine();

  function assetUrl(file) {
    return "./" + String(file).replace(/^\.\//, "");
  }

  function formatDuration(seconds) {
    var n = Number(seconds);
    if (!isFinite(n)) return "";
    var text = (Math.round(n * 100) / 100).toString();
    if (text.indexOf(".") === -1) text += ".0";
    return text + "s";
  }

  function setStatus(text, playing) {
    statusEl.textContent = text;
    statusEl.classList.toggle("is-playing", !!playing);
  }

  function paintOverlap() {
    overlapBtn.setAttribute("aria-pressed", engine.overlap ? "true" : "false");
    overlapBtn.classList.toggle("is-on", engine.overlap);
    overlapPill.textContent = engine.overlap ? "ON" : "OFF";
  }

  function loadOverlap() {
    var stored = null;
    try {
      stored = localStorage.getItem("fm2-overlap");
    } catch (err) {
      stored = null;
    }
    engine.overlap = stored === "on";
    paintOverlap();
  }

  function showBadge() {
    badge.hidden = false;
  }

  function cacheLooksReady(requests) {
    if (!clips.length) return false;
    var urls = requests.map(function (req) { return req.url; });
    var needed = CORE_SUFFIXES.concat(clips.map(function (clip) { return clip.file; }));
    return needed.every(function (suffix) {
      return urls.some(function (url) { return url.indexOf(suffix) !== -1; });
    });
  }

  function confirmOffline() {
    if (!("caches" in window)) return Promise.resolve();
    return caches.open(CACHE_NAME).then(function (cache) {
      return cache.keys();
    }).then(function (keys) {
      if (cacheLooksReady(keys)) showBadge();
    }).catch(function () {});
  }

  function watchOffline() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.addEventListener("message", function (event) {
      if (event.data && event.data.type === "offline-ready") confirmOffline();
    });
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).then(function () {
      return navigator.serviceWorker.ready;
    }).then(function () {
      return confirmOffline();
    }).catch(function () {});
  }

  function renderBoard() {
    var frag = document.createDocumentFragment();
    clips.forEach(function (clip) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pad";
      btn.dataset.id = clip.id;
      btn.setAttribute("aria-pressed", "false");
      var spoken = formatDuration(clip.duration).replace("s", " seconds");
      btn.setAttribute("aria-label", clip.label + ", " + spoken);

      var label = document.createElement("span");
      label.className = "pad-label";
      label.textContent = clip.label;

      var time = document.createElement("span");
      time.className = "pad-time";
      time.textContent = formatDuration(clip.duration);

      var track = document.createElement("span");
      track.className = "pad-track";
      track.setAttribute("aria-hidden", "true");

      var bar = document.createElement("span");
      bar.className = "pad-progress";
      track.appendChild(bar);

      btn.appendChild(label);
      btn.appendChild(time);
      btn.appendChild(track);
      btn.addEventListener("click", function () {
        engine.play(clip);
      });
      frag.appendChild(btn);
    });
    board.textContent = "";
    board.appendChild(frag);
  }

  function paint() {
    var active = Object.create(null);
    engine.voices.forEach(function (voice) {
      active[voice.id] = true;
    });

    var pads = board.querySelectorAll(".pad");
    for (var i = 0; i < pads.length; i++) {
      var pad = pads[i];
      var on = !!active[pad.dataset.id];
      pad.classList.toggle("is-playing", on);
      pad.setAttribute("aria-pressed", on ? "true" : "false");
      if (!on) {
        var bar = pad.querySelector(".pad-progress");
        if (bar) bar.style.transform = "scaleX(0)";
      }
    }

    var playing = engine.voices.size > 0;
    stopBtn.classList.toggle("is-hot", playing);
    stopBtn.setAttribute("aria-pressed", playing ? "true" : "false");

    if (playing) {
      if (!rafId) rafId = requestAnimationFrame(tick);
    } else if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
  }

  function tick() {
    rafId = 0;
    if (engine.voices.size === 0) return;

    var latest = Object.create(null);
    engine.voices.forEach(function (voice) {
      var prev = latest[voice.id];
      if (!prev || voice.token > prev.token) latest[voice.id] = voice;
    });

    Object.keys(latest).forEach(function (id) {
      var voice = latest[id];
      var elapsed = voice.kind === "webaudio"
        ? engine.currentTime() - voice.startedAt
        : (voice.audio ? voice.audio.currentTime : 0);
      var dur = voice.duration || 0.01;
      var amount = Math.max(0, Math.min(1, elapsed / dur));
      var pad = board.querySelector('.pad[data-id="' + id + '"] .pad-progress');
      if (pad) pad.style.transform = "scaleX(" + amount + ")";
    });

    rafId = requestAnimationFrame(tick);
  }

  function createEngine() {
    var api = {
      ctx: null,
      unlocked: false,
      overlap: false,
      voices: new Set(),
      raw: new Map(),
      buffers: new Map(),
      failed: new Set(),
      inflight: new Map(),
      playToken: 0,
      epoch: 0,
      seq: 0,
      onVoices: function () {}
    };

    api.currentTime = function () {
      return api.ctx ? api.ctx.currentTime : 0;
    };

    api.unlock = function () {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      try {
        if (!api.ctx) api.ctx = new AC();
      } catch (err) {
        return false;
      }
      if (api.ctx.state === "suspended") {
        var resumed = api.ctx.resume();
        if (resumed && typeof resumed.catch === "function") resumed.catch(function () {});
      }
      if (!api.unlocked) {
        try {
          var silence = api.ctx.createBuffer(1, 1, 22050);
          var node = api.ctx.createBufferSource();
          node.buffer = silence;
          node.connect(api.ctx.destination);
          node.start(0);
          api.unlocked = true;
        } catch (err) {
          api.unlocked = true;
        }
      }
      api.raw.forEach(function (_buf, id) {
        if (!api.buffers.has(id) && !api.failed.has(id)) api.decode(id);
      });
      return true;
    };

    api.decode = function (id) {
      if (api.buffers.has(id)) return Promise.resolve(api.buffers.get(id));
      if (api.failed.has(id) || !api.ctx || !api.raw.has(id)) return Promise.resolve(null);
      if (api.inflight.has(id)) return api.inflight.get(id);

      var copy = api.raw.get(id).slice(0);
      var pending = new Promise(function (resolve) {
        var settled = false;
        function ok(buffer) {
          if (settled) return;
          settled = true;
          if (!buffer) {
            api.failed.add(id);
            resolve(null);
            return;
          }
          api.buffers.set(id, buffer);
          resolve(buffer);
        }
        function bad() {
          if (settled) return;
          settled = true;
          api.failed.add(id);
          resolve(null);
        }
        try {
          var result = api.ctx.decodeAudioData(copy, ok, bad);
          if (result && typeof result.then === "function") result.then(ok, bad);
        } catch (err) {
          bad();
        }
      }).then(function (buffer) {
        api.inflight.delete(id);
        return buffer;
      });

      api.inflight.set(id, pending);
      return pending;
    };

    api.preload = function (clip) {
      if (api.raw.has(clip.id) || api.buffers.has(clip.id) || api.failed.has(clip.id)) {
        return Promise.resolve();
      }
      return fetch(assetUrl(clip.file)).then(function (res) {
        if (!res.ok) throw new Error("bad status");
        return res.arrayBuffer();
      }).then(function (arr) {
        api.raw.set(clip.id, arr);
        if (api.ctx) return api.decode(clip.id);
      }).catch(function () {
        api.failed.add(clip.id);
      });
    };

    api.play = function (clip) {
      var hasWebAudio = !!(window.AudioContext || window.webkitAudioContext);
      api.unlock();
      if (!api.overlap) api.stopAll();

      var epoch = api.epoch;
      var token = ++api.playToken;

      function stillCurrent() {
        if (epoch !== api.epoch) return false;
        if (!api.overlap && token !== api.playToken) return false;
        return true;
      }

      if (!hasWebAudio || api.failed.has(clip.id)) {
        if (stillCurrent()) api.playElement(clip);
        return;
      }

      var ready = api.buffers.get(clip.id);
      if (ready && api.ctx) {
        if (stillCurrent()) api.playBuffer(clip, ready);
        return;
      }

      var prep = api.raw.has(clip.id)
        ? api.decode(clip.id)
        : api.preload(clip).then(function () { return api.decode(clip.id); });

      Promise.resolve(prep).then(function (buffer) {
        if (!stillCurrent()) return;
        if (buffer && api.ctx) api.playBuffer(clip, buffer);
        else api.playElement(clip);
      }).catch(function () {
        if (stillCurrent()) api.playElement(clip);
      });
    };

    api.playBuffer = function (clip, buffer) {
      var ctx = api.ctx;
      var source = ctx.createBufferSource();
      var gain = ctx.createGain();
      source.buffer = buffer;
      source.connect(gain);
      gain.connect(ctx.destination);
      var voice = {
        id: clip.id,
        kind: "webaudio",
        source: source,
        gain: gain,
        startedAt: ctx.currentTime,
        duration: buffer.duration || Number(clip.duration) || 0.01,
        token: ++api.seq
      };
      source.onended = function () {
        api.removeVoice(voice);
      };
      try {
        source.start(0);
      } catch (err) {
        api.failed.add(clip.id);
        api.playElement(clip);
        return;
      }
      api.voices.add(voice);
      setStatus("Playing " + clip.label, true);
      api.onVoices();
    };

    api.playElement = function (clip) {
      var audio = new Audio(assetUrl(clip.file));
      audio.playsInline = true;
      audio.setAttribute("playsinline", "");
      audio.preload = "auto";
      var voice = {
        id: clip.id,
        kind: "element",
        audio: audio,
        startedAt: 0,
        duration: Number(clip.duration) || 0.01,
        token: ++api.seq
      };
      audio.onended = function () {
        api.removeVoice(voice);
      };
      api.voices.add(voice);
      setStatus("Playing " + clip.label, true);
      api.onVoices();
      var started = audio.play();
      if (started && typeof started.catch === "function") {
        started.catch(function () {
          api.removeVoice(voice);
          setStatus("Could not play " + clip.label, false);
        });
      }
    };

    api.removeVoice = function (voice) {
      if (!api.voices.has(voice)) return;
      api.voices.delete(voice);
      if (api.voices.size === 0) setStatus("Stopped", false);
      api.onVoices();
    };

    api.stopAll = function () {
      api.epoch += 1;
      var list = Array.from(api.voices);
      api.voices.clear();
      list.forEach(function (voice) {
        try {
          if (voice.kind === "webaudio") {
            voice.source.onended = null;
            var now = api.ctx ? api.ctx.currentTime : 0;
            try {
              voice.gain.gain.cancelScheduledValues(now);
              voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
              voice.gain.gain.linearRampToValueAtTime(0, now + 0.02);
            } catch (err) {}
            voice.source.stop(now + 0.03);
          } else if (voice.audio) {
            voice.audio.onended = null;
            voice.audio.pause();
            voice.audio.removeAttribute("src");
            voice.audio.load();
          }
        } catch (err) {}
      });
      setStatus("Stopped", false);
      api.onVoices();
    };

    return api;
  }

  engine.onVoices = paint;

  stopBtn.addEventListener("click", function () {
    engine.unlock();
    engine.stopAll();
  });

  randomBtn.addEventListener("click", function () {
    if (!clips.length) return;
    var index = Math.floor(Math.random() * clips.length);
    engine.play(clips[index]);
  });

  overlapBtn.addEventListener("click", function () {
    engine.overlap = !engine.overlap;
    try {
      localStorage.setItem("fm2-overlap", engine.overlap ? "on" : "off");
    } catch (err) {}
    paintOverlap();
    setStatus(engine.overlap ? "Overlap on" : "Overlap off", false);
  });

  loadOverlap();
  watchOffline();

  fetch("./clips.json").then(function (res) {
    if (!res.ok) throw new Error("clips");
    return res.json();
  }).then(function (data) {
    if (!Array.isArray(data) || !data.length) throw new Error("clips");
    clips = data;
    renderBoard();
    confirmOffline();
    var cursor = 0;
    function worker() {
      if (cursor >= clips.length) return Promise.resolve();
      var clip = clips[cursor++];
      return engine.preload(clip).then(worker, worker);
    }
    var jobs = [];
    for (var n = 0; n < 4; n++) jobs.push(worker());
    return Promise.all(jobs);
  }).catch(function () {
    var note = document.createElement("p");
    note.className = "load-error";
    note.textContent = "The clip list could not be loaded.";
    board.textContent = "";
    board.appendChild(note);
  });
})();
