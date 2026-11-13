# Rebuild css/tw.css

The page loads `css/tw.css` (prebuilt, works offline) and the Tailwind CDN (adds classes newer than the build, online only).
After adding new Tailwind classes, rebuild so they also work offline:

```
npx tailwindcss@3.4.17 -c tools/tailwind.config.js -i tools/tw-input.css -o css/tw.css --minify
```

Run from the repo root. Then bump `VERSION` in sw.js and `?v=` in index.html.
