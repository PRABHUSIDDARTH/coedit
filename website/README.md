# Coedit website

A static page. There is no build step on Vercel.

## Preview locally

```bash
python3 -m http.server -d website 8080
```

Open it through a server, not as a file, or the 3D logo will not load.

## Deploy on Vercel

Import this repository, set **Root Directory** to `website`, and set the framework preset to **Other**.
Leave the build command empty.

## The glass logo

`src/hero.js` draws the symbol from `frontend/public/brand/coedit-symbol.svg` as glass with three.js.
`assets/hero.js` is the bundled copy the page loads. After editing the source, rebuild it:

```bash
cd website
npm i --no-save three@0.187.0 esbuild
npx esbuild src/hero.js --bundle --format=esm --minify --outfile=assets/hero.js
```

If WebGL is unavailable the page shows the flat mark.
