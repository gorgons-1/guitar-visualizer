# Guitar Visualizer

A desktop app for exploring the guitar fretboard.

- **Scales**: major, minor, pentatonics, blues, harmonic/melodic minor and all the modes.
- **Chords**: chord voicings worked out for the current tuning. Step through them with ◀ ▶.
- **Arpeggios**: chord tones shown across the whole neck.
- **Tunings**: standard, drop D/C, Eb, D standard, DADGAD, open G/D/E, 7-string and 4-string bass, with a left-handed view.
- **Sound**: click any fret to hear it, or press **Play** (or Space) to hear the scale, arpeggio or chord.
- **Live input**: choose a microphone or USB guitar interface and the input channel. A tuner shows the note you play and whether it is in key.
- **Chord check**: in Chord mode, tick *Check my chord when I strum* and the app tells you if the chord is right, or what's wrong (missing note, extra note, which string to fix).
- **Tab player**: paste a text tab or open a `.txt` tab file. Each step is shown on the neck with the next few numbered, and the tuning is set from the string names. Play it back at any speed, loop it, step with ← →, or tick *Wait for me* so the app listens and moves on when you play each note or chord. **Play along** gives a count-in, then runs the tab at your speed and scores every step as hit or missed, with your best score. Understands 2-digit frets, chords, hammer-ons, pull-offs, slides and bends.
- **Practice & lessons**: *Find the note* (random targets) or a *Scale lesson* that walks you up and down each scale position note by note, showing only that position's notes and the next notes to play, then moves up the neck to the next position (or pick one position to drill); tracks score, streak and time.
- **String detection (experimental)**: calibrate once by plucking each open string; the app then measures each note's overtones (string stiffness / inharmonicity) to work out which string you played.
- **Copy diagnostics**: copies the last 4 seconds of what the app heard, for troubleshooting.

## Development

```bash
npm install
npm start        # run the app
npm test         # unit tests (theory + pitch detection)
npm run dist     # build an installer locally into dist/ (no upload)
```

## Releases and update notifications

| You do | What happens | Do users see it? |
|---|---|---|
| `git push` to `main` | The CI workflow runs the tests | No |
| `npm run release:patch` (or `:minor` / `:major`) | The version is bumped, a `vX.Y.Z` tag is pushed, and the Release workflow builds installers for Windows, Mac and Linux and attaches them to a **draft** release | No |
| Open **GitHub → Releases → the draft → Publish release** | The release goes live | **Yes.** Running apps show an "Update available" banner (checked at startup and every 4 hours) |

So nothing reaches users until you've downloaded the draft's installers, tested them, and clicked **Publish**.
To give testers a build first, tick **Set as a pre-release** instead. The app ignores pre-releases.

### When an update is found

- **Windows / Linux (AppImage):** **Download update** → **Restart & update**. If the user doesn't restart, the update installs the next time they quit.
- **macOS:** the banner opens the release page so the user can download it. Automatic installs on Mac need an Apple Developer ID certificate. Once you have one, add the signing secrets and remove `CSC_IDENTITY_AUTO_DISCOVERY: false`.

### One-time GitHub setup

1. Create an empty repository on GitHub, e.g. `guitar-visualizer`.
2. Push this project:
   ```bash
   git add -A && git commit -m "Initial commit"
   git remote add origin https://github.com/<you>/guitar-visualizer.git
   git push -u origin main
   ```
3. In the repo, go to **Settings → Actions → General → Workflow permissions** and make sure **Read and write** is allowed.
4. Users' first install comes from the **Releases** page. After that, the app updates itself.

> The repo must be **public** for the in-app update check to work without a token.

### Notes

- The installers are unsigned, so Windows SmartScreen shows "More info → Run anyway". On macOS, right-click the app → Open. If macOS says the app is "damaged", run `xattr -cr "/Applications/Guitar Visualizer.app"`.
- **Linux (64-bit PC):** use the `.deb` (`sudo apt install ./guitar-visualizer_<version>_amd64.deb`) or the AppImage. The AppImage needs `libfuse2` (`sudo apt install libfuse2`).
