<!--
The title of this pull request becomes the commit message on main (squash merge), so it must follow
Conventional Commits: <type>(<scope>): <summary>, for example "fix(pi): keep maps off after an update".
See CONTRIBUTING.md.
-->

## What and why

<!-- What changes for someone using the hub, and why. Link the issue: "Closes #123". -->

## How it was tested

- [ ] `npm run typecheck`, `npm run build`, `npm run smoke` and `npx playwright test` in `hub/`
- [ ] `python3 -m unittest discover -s pi/tests` (for changes in `pi/`)
- [ ] Tried on a real Raspberry Pi (describe below), or not needed for this change

## Checklist

- [ ] New or changed interface text is in every dictionary of `hub/lib/messages/`
- [ ] Changes to files, paths or settings on the Raspberry Pi are migrated by `pi/hub-migrate.py`
- [ ] README and screenshots are updated if something visible changed (CHANGELOG is written by release-please)
- [ ] Breaking changes are marked with `!` in the title and explained in `docs/upgrading.md`
