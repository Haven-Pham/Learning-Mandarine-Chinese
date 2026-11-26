# Rebuild css/tw.css

The page loads the prebuilt `css/tw.css` from the repository.
Rebuild after adding Tailwind classes:

```
npx tailwindcss@3.4.17 -c tools/tailwind.config.js -i tools/tw-input.css -o css/tw.css --minify
```

Run from the repo root. Then bump `VERSION` in sw.js and `?v=` in index.html.
