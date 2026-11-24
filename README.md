# The Fart Machine 2.0

A dark, high-contrast Home Screen soundboard for the 16 original Wavhounds *The Fart Machine! v2.0* deluxe clips (1999). It is a static site: open `index.html` from the repository root. There is no build step.

The page uses large white type on a near-black background, a sticky STOP / Random / Overlap bar, and a service worker that caches the page and every clip on the first visit. Overlap starts off, so a new pad replaces whatever is playing. Turn Overlap on to stack clips.

## Add to your Home Screen

### iPhone

1. Open the site in Safari.
2. Tap Share, then **Add to Home Screen**.
3. Open **Fart Machine**. Leave it online once until the **Offline Ready** badge appears. After that, the soundboard plays with no connection.

The layout clears the Dynamic Island and the Home indicator when launched from the Home Screen.

### Android

1. Open the site in Chrome.
2. Use the browser menu and choose **Install app** or **Add to Home screen**.
3. Open **Fart Machine** and wait for **Offline Ready**.

## GitHub Pages

Serve this repository from the `main` branch, root (`/`), so the app is available at `https://joshua-wopr99.github.io/fart-machine-2/`. Paths are relative, so the same files also work at the root of a local server.
