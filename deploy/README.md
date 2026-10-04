# Publishing at https://nebosolutions.co.uk/solar/

## Build the upload package

```bash
npm run package
```

This creates `dist/iraq-solar-model.zip`, which contains one folder, `solar/`:

| File | Purpose |
|---|---|
| `index.html` | The page. Browsers always re-check it for updates (set in `.htaccess`). |
| `a-<hash>/` | All scripts, styles and libraries, in a folder named after their contents. |
| `.htaccess` | Security headers, caching and correct file types (Apache). |
| `version.txt` | The git commit and asset folder this package was built from. |

**Why the `a-<hash>` folder:** the host serves scripts and stylesheets with a one-year cache and ignores `.htaccess` for them. Each release gets a new folder name, so returning visitors always load matching, up-to-date files.

## Upload or update (hosting control panel → File Manager)

1. Go to `public_html/`.
2. **For an update, delete the old `solar` folder first.** This removes old `a-…` folders, which would otherwise just take up space.
3. Upload `iraq-solar-model.zip` to `public_html/` and choose **Extract**. This creates `public_html/solar/`.
4. Delete the uploaded zip.
5. Open https://nebosolutions.co.uk/solar/. `/solar/version.txt` shows which version is live.

If the old page still appears, flush the host's cache (SiteGround: *Speed → Caching → Flush cache*). If the site uses a WordPress caching plugin, exclude `/solar/` from it.

## Check after upload

```bash
BASE_URL=https://nebosolutions.co.uk/solar/ npm run test:smoke
```

The host blocks plain command-line requests (`curl`, scripts) with a 403 error, which is normal bot protection. Browsers, and the Playwright tests above, work fine.
