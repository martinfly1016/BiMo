# BiMo

BiMo is an early browser prototype for testing a real-time brush contact patch model for Chinese calligraphy on iPad.

The current prototype focuses on one question: can Apple Pencil input be mapped into a plausible virtual brush-paper contact area in real time?

## Prototype

Open `index.html` in a browser, or serve the directory locally:

```bash
python3 -m http.server 8765
```

Then open the local URL from iPad Safari on the same network.

## What It Tests

- Pressure-driven contact area expansion
- Movement and tilt-driven wedge/contact patch direction
- Brush deformation lag
- Live contact patch overlay
- Basic ink deposition, dry cuts, rough edges, and soft/firm brush presets

## Input Notes

The prototype uses Web Pointer Events. On supported iPad/Safari combinations, Apple Pencil should provide pressure and tilt data through pointer event properties such as `pressure`, `tiltX`, and `tiltY`.

Non-pen input uses a simulated pressure slider so the model can still be tested on desktop.

## Current Scope

This is not yet a full calligraphy app. It is a small test bench for validating the contact patch model before moving to a native iPad/Metal implementation.
