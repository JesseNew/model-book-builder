# Model Book — Chart Study & Annotation Tool

A stock chart study and annotation tool for building model books in the style of Bill O'Neil's *How to Make Money in Stocks*.

## Quick Start

### 1. Install Python dependencies (one time)
```
pip install fastapi uvicorn httpx
```

### 2. Start the backend server
```
python api_server.py
```
This starts a local server on port 8000 that fetches stock data from Yahoo Finance.

### 3. Open the app
Open `index.html` in your browser (just double-click the file).

### 4. Use it
- Type a ticker (AAPL, NVDA, TSLA, etc.) and click **Load Chart**
- Select a drawing tool from the left toolbar and annotate the chart
- Or switch to **Image** mode and upload a chart screenshot from TC2000
- Save studies, tag them, and build your model book

## Keyboard Shortcuts
| Key | Tool |
|-----|------|
| V | Select / Move |
| L | Trendline |
| H | Horizontal Line |
| R | Rectangle |
| E | Ellipse |
| F | Freehand |
| A | Arrow |
| T | Text |
| Del | Delete selected |
| Ctrl+Z | Undo |
| Esc | Deselect |

## Firebase (Optional)
Click the ⚙️ Settings icon and enter your Firebase credentials to persist studies across sessions. Without Firebase, studies are stored in memory for the current session only.

## Files
- `index.html` — Main app page
- `app.js` — Application logic (~1,200 lines)
- `style.css` — Design tokens and theme
- `app.css` — Layout and component styles
- `base.css` — CSS reset and foundation
- `api_server.py` — FastAPI backend (Yahoo Finance proxy)
