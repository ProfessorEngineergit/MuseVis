# MuseVis

MuseVis turns a local audio file into a real-time Three.js particle visualization. The selected file is analyzed entirely in the browser and is never uploaded.

## Local development

```sh
npm install
npm run dev
```

## Production build

```sh
npm ci
npm run build
npm run preview
```

The output in `dist/` is fully static. `vite.config.js` uses relative asset URLs so the same build works on a GitHub user page, a custom domain, or a repository project page.

## GitHub Pages

1. Push the repository to a `main` branch on GitHub.
2. In **Settings → Pages**, set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/deploy-pages.yml` builds and deploys the site on every push to `main`.

The sample media is intentionally included under `public/` and copied into the Pages artifact during the build.
