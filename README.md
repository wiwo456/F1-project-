# Racewall

A personal Formula 1 timing dashboard built with the OpenF1 API.

## Run it

From this folder, run:

```bash
python3 -m http.server 5173
```

Then open `http://localhost:5173` in a browser.

## Current data mode

The dashboard uses free historical OpenF1 data. Its API calls are kept together in `app.js`, so a future live-data source can be swapped in without changing the interface.
