# Contributing to JustRigIt

Thanks for wanting to help! JustRigIt is free software made so that anyone, beginners included, can get a
character moving in their game without paying for mocap or subscriptions. Every bug report, idea, test and line of
code helps.

## Ways to help (no coding needed)
- **Report a bug.** Something broke, looked wrong in your engine, or confused you?
  [Open a bug report](https://github.com/SuddleMercury/justrigit/issues/new?template=bug_report.yml).
  Confusing wording counts as a bug: JustRigIt is meant for beginners.
- **Suggest a feature** [here](https://github.com/SuddleMercury/justrigit/issues/new?template=feature_request.yml).
- **Test with your characters and engines.** Tell us what worked and what didn't (engine and version, character
  source, what you expected).
- **Share captures.** Short clips of results, good or bad, help us tune the clean-up and foot locking.
- **Improve the docs**: the README, the import guides, the glossary. Typos and unclear steps are worth fixing.

## Ways to help with code
Look for issues labelled **good first issue** or **help wanted**, or pick something from the
[roadmap](README.md#roadmap--help-wanted). For anything big, open an issue first so we can agree on the approach
before you spend time on it.

### Set up (about 5 minutes, no GPU needed)
You need [Node.js 20+](https://nodejs.org), [Python 3.10+](https://www.python.org) with `numpy`, and `ffmpeg`
(only for some tests).

    git clone https://github.com/<you>/justrigit.git
    cd justrigit
    npm install
    npm run build                 # -> dist/justrigit.html (the whole app in one file)
    pip install numpy pytest

Run the app: open `dist/justrigit.html` in a browser. For the video-capture flow without a GPU, start the engine in
**demo mode** (it returns a sample walk instead of running the AI model):

    cd capture && python -m jrcapture serve --demo --open

### Run the tests
    python -m pytest capture/tests          # capture engine maths, clean-up, GLB/BVH writers
    node scripts/namingtest.mjs             # Unreal / Godot / Mixamo bone naming
    node scripts/fingertest.mjs             # finger bones: mannequin, auto-rig, retargeting
    node scripts/packfingertest.mjs         # library packs + exports
    node scripts/mcplocaltest.mjs           # MCP on a local computer (run with the capture engine STOPPED)
    # with `python -m jrcapture serve --demo` running (from capture/):
    node scripts/capturetest.mjs            # video → retarget → export
    node scripts/mcpcapturetest.mjs         # capture tools over MCP

The same checks run automatically on every pull request (see `.github/workflows/test.yml`).
Some older tests (`m2test`, `rigtest`, `smoke`…) need Mixamo characters in `testassets/`. Those are Adobe assets
and must never be committed.

### How the code is organised
- `src/core/` is the engine (no UI; runs in the browser and in Node). **Every feature is a command** in
  `forge.js` with a JSON schema. The buttons, the browser API (`window.justrigit`) and the MCP server all call the same
  commands, so a new feature added as a command works for people *and* AI assistants.
- `src/ui/`: the wizard (`wizard.js`), the advanced editor (`app.js`), and the 3D viewport.
- `src/node/`: the MCP server, local-computer helpers (`local.js`) and the software renderer (`render.js`).
- `capture/jrcapture/`: the Python capture engine (NVIDIA GEM-X → clean SOMA animation) and its local server.
- `scripts/`: build scripts and tests.

More detail in the README's [Layout](README.md#layout) section.

### Making a change
1. **Fork** the repository (button at the top right on GitHub) and create a branch: `git checkout -b fix-foot-sliding`.
2. Make your change. Keep it focused: one fix or feature per pull request.
3. If you changed anything under `src/`, run `npm run build` and commit the updated `dist/justrigit.html` too.
4. Run the tests above, and add a test when you fix a bug or add a feature.
5. **Open a pull request** and fill in the template: what it changes, why, and how you tested it.
   Screenshots or a short clip help a lot for anything visual.

### Style
- Plain JavaScript (ES modules), no framework. Python 3.10+, standard library + numpy in the engine.
- User-facing text is **plain language for beginners**: say what to do and why, and explain any term the first time
  (add it to `src/core/glossary.js`).
- Keep everything local: no telemetry, no accounts, no required cloud services.
- No non-commercial assets or models (for example SMPL/SMPL-X or Mixamo files). Everything shipped must be usable
  in commercial games.

## Licence of contributions
JustRigIt is licensed under the [GNU AGPL-3.0-or-later](LICENSE). By submitting a contribution, you agree that it
is licensed under the same terms, so JustRigIt and every improvement stay free for everyone. Only contribute work you
have the right to share.

## Be kind
Be welcoming and patient, especially with beginners. Assume good intent, critique ideas rather than people, and
keep discussions on topic. Harassment, insults and discrimination aren't tolerated; the maintainer may remove
comments or block accounts that break this. To report a problem privately, contact
[@SuddleMercury](https://github.com/SuddleMercury) on GitHub.
