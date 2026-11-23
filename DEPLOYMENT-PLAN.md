# phyloBirds deployment progress

Updated: November 23, 2026.

This checklist tracks the remaining work to publish phyloBirds on GitHub Pages and make it part of a growing personal website. It supplements the original [implementation plan](plan.md).

| Item | Current state |
| --- | --- |
| Repository | [Reese-Martin/bird-phylogeny](https://github.com/Reese-Martin/bird-phylogeny) |
| Branch | `main` |
| Initial project upload | Complete: [`8f6820cb`](https://github.com/Reese-Martin/bird-phylogeny/commit/8f6820cb46f7064b5dd6c22830eeb3217191508d) |
| Launch address | To be selected |
| GitHub Pages | Not enabled; no deployment workflow yet |
| Live website | Not deployed |

Mark an item complete only after its result has been verified. Record deployment URLs, workflow runs, and remaining issues in the progress log below.

## Completed preparation

- [x] Review the files intended for publication; keep personal exports, raw evidence, credentials, local tools, dependencies, build output, and private verification results out of Git.
- [x] Include the prepared public datasets, all artwork tiers and sheets, fonts, and generated delivery settings.
- [x] Preserve exact bytes with `.gitattributes` so Git line-ending conversion does not invalidate SHA-256 provenance.
- [x] Make documentation links portable and document setup on another computer in the [README](README.md#git-and-a-second-computer).
- [x] Separate self-contained application/artifact tests from the optional original-source audit (`npm run test:provenance`).
- [x] Verify 371 application tests and a production build using a clean source copy without personal files or raw evidence. Verify 13 original-source audit tests separately.
- [x] Create the initial commit, push `main`, and confirm GitHub's branch matches the local commit.

## 1. Verify the laptop checkout

This can be done independently of hosting.

- [ ] Install Git and Node 24 or newer on the laptop.
- [ ] Clone `https://github.com/Reese-Martin/bird-phylogeny.git`.
- [ ] Run `npm ci`, `npm test`, `npm run build`, and `npm start` from the cloned directory.
- [ ] Confirm the demo, artwork, import, save/reload, backup/restore, and exports work. Normal startup needs no R, Python, API key, or raw-source downloads.
- [ ] Use pull / commit / push to move code changes between computers. Transfer personal collections separately by CSV reimport or collection backup; browser storage does not sync through Git.

## 2. Choose the launch address

- [ ] Select and record the launch URL here: **TBD**.

| Option | Preparation needed |
| --- | --- |
| `https://reese-martin.github.io/bird-phylogeny/` | Free project URL; make all runtime asset references work beneath `/bird-phylogeny/`. |
| A custom subdomain, such as `https://birds.yourname.com/` | Own and configure a domain; the app can remain at the domain root. |

For a growing personal site, the proposed arrangement is a homepage at `yourname.com`, a project description at `yourname.com/projects/birds/`, and this interactive app at `birds.yourname.com`. Keep their repositories and deployments independent.

## 3. Prepare paths for the selected address

- [ ] Configure Vite's build base for the selected root or subpath.
- [ ] Make runtime data requests, fonts, favicon, demo download links, artwork, sheet catalogs, and sheet image URLs respect that base. Audit paths embedded in prepared metadata as well as source code; changing Vite's `base` alone is insufficient.
- [ ] Use consistent URL resolution for canonical dataset paths. Preserve hash-pinned data bytes wherever possible rather than rewriting datasets solely to change their hosting address.
- [ ] Update artwork/sheet path validation consistently, retain same-origin loading, and confirm canvas exports remain usable.
- [ ] Verify workers, assets, refreshes, imports, and exports under the actual deployment prefix. Keep normal localhost development working.

Acceptance: the production build opens at the chosen root or subpath without missing assets, failed workers, or broken public-data links.

## 4. Add the deployment workflow

- [ ] Add a GitHub Actions workflow for pushes to `main` and manual runs.
- [ ] Check out the repository, set up Node 24, and install the locked dependencies with `npm ci`.
- [ ] Run `npm test`, then `npm run build`; stop deployment if either fails.
- [ ] Build from the committed prepared assets; keep dataset fetching/regeneration and artwork generation out of the deployment workflow.
- [ ] Keep `test:provenance` separate unless the workflow deliberately restores its pinned raw evidence. Do not upload private local evidence to make CI pass.
- [ ] Upload only `dist/` as the Pages artifact and deploy that artifact.
- [ ] Configure the required `contents: read`, `pages: write`, and `id-token: write` permissions, the `github-pages` deployment environment, and deployment concurrency. Make deployment depend on the successful build.
- [ ] Confirm the artifact contains the required public files and remains within GitHub Pages' current limits.

The hosted app needs static files; the local `npm start` server is not part of the Pages deployment.

## 5. Enable Pages and publish

- [ ] In the repository's **Settings > Pages > Build and deployment**, select **GitHub Actions** as the source.
- [ ] Run the workflow and inspect its build and deployment results.
- [ ] Open the returned HTTPS address and verify the expected release is served.
- [ ] Record the live URL, deployed commit, and successful workflow run below.

## 6. Verify the hosted app

- [ ] Check the demo, search, taxonomy/country/year filters, Tree, Bird map, Arboretum, and growth playback.
- [ ] Select or drag in a supported full eBird CSV; check progress, cancellation, replacement, and reconciliation. Extract ZIP exports before selecting the CSV.
- [ ] Verify imported CSV contents are processed locally, with no observation-upload endpoint. Ordinary hosting requests still include page/data/artwork requests.
- [ ] Check save-on-device, reload/restore, backup download/restore, and the unavailable-storage fallback. A new domain starts with separate browser storage.
- [ ] Check PNG and animation exports, including format fallback where browser video support differs.
- [ ] Test actual iPhone Safari and Android browsers for cold loading, import, generation, pan/pinch, controls, export, and background/resume. Desktop phone-sized viewports do not replace device testing.
- [ ] Inspect network errors, console errors, loading time, and the host's compression/cache behavior. Pages does not run the custom local server's header logic.
- [ ] Confirm source credits, synthetic-demo labels, and privacy wording remain visible and accurate.

Acceptance: a new visitor can open the demo, import their own supported data, explore it, and export results without a backend or account.

## 7. Optional domain and personal-site integration

- [ ] Register a stable personal domain if desired; review renewal costs and enable auto-renewal.
- [ ] Verify the domain with GitHub, add the custom subdomain in Pages settings, then configure the DNS records required by GitHub.
- [ ] Confirm HTTPS and redirects, repeat hosted checks, and update this plan with the final address.
- [ ] Create the personal homepage and project index in their own repository/deployment.
- [ ] Add a project description with screenshots, methods, credits, and a launch link; add a return link from the app to the personal site.

## 8. Ongoing updates

- [ ] Document how to recover a known-good deployment by reverting the relevant change and deploying again.
- [ ] Establish a pull / test / commit / push routine, with deployment results checked after releases.
- [ ] Monitor published size, bandwidth, and mobile performance as the artwork library and audience grow.
- [ ] Review and update this checklist after each milestone. Accounts, cloud sync, and publicly shared collections are separate future features, not requirements for the first launch.

## Progress log

| Date | Progress | Evidence / next step |
| --- | --- | --- |
| 2026-11-22 | Repository preparation and clean-source validation completed. | 371 application tests, 13 source audits, and production build passed. |
| 2026-11-23 | Initial project uploaded to GitHub. | `main` at `8f6820cb`; next hosting decision is the launch address. |
| 2026-11-23 | Deployment tracking checklist added. | Hosting remains pending; this document tracks the remaining work. |

## References

- [Vite: GitHub Pages deployment](https://vite.dev/guide/static-deploy.html#github-pages)
- [GitHub: configure the publishing source](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
- [GitHub: manage a custom domain](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site)
- [GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)
- [Project source and attribution notes](README-DATA.md)
