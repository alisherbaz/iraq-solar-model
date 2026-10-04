# Publishing at https://nebosolutions.co.uk/iraq/

## Build the upload package

```bash
npm run package
```

This creates `dist/iraq-solar-model.zip`, which contains one folder, `iraq/`:

- the app (everything in `public/`)
- `.htaccess`: security headers, caching and correct file types (Apache)
- `vendor/.htaccess`: one-week caching for Chart.js and Leaflet
- `version.txt`: the git commit the package was built from

## Upload (hosting control panel → File Manager)

1. Open **File Manager** and go to the site's web root, usually `public_html/`.
2. Upload `iraq-solar-model.zip` there and choose **Extract**. This creates `public_html/iraq/`.
3. Delete the uploaded zip.
4. Open https://nebosolutions.co.uk/iraq/ and check that it works.

To update the site, repeat the steps and overwrite the existing files. If the old version still shows, clear the host's cache (for example SiteGround's "Dynamic Cache flush", or your caching plugin's equivalent).

**WordPress caching plugins** (WP Rocket, LiteSpeed Cache, SiteGround's optimiser plugin): add `/iraq/` to their exclusions so they don't cache or minify the app.

## Check after upload

```bash
BASE_URL=https://nebosolutions.co.uk/iraq/ npm run test:smoke
```

Optional header check (should show `content-security-policy`):

```bash
curl -sI https://nebosolutions.co.uk/iraq/ | grep -i -E "content-security|x-frame|cache-control"
```

Some hosts serve static files straight from nginx and ignore `.htaccess` headers. The app works the same either way; the headers are only extra hardening.
