#!/usr/bin/env python3
"""api_server.py — FastAPI backend for Model Book.
Proxies Yahoo Finance data to avoid CORS issues.
Runs on port 8000.
"""
import httpx
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Model Book API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

YAHOO_BASE = "https://query1.finance.yahoo.com/v8/finance/chart"

@app.get("/api/health")
def health():
    return {"status": "ok", "service": "model-book-api"}

@app.get("/api/stock/{symbol}")
async def get_stock(symbol: str, period: str = "1y", interval: str = "1d"):
    """Proxy Yahoo Finance historical OHLCV data."""
    symbol = symbol.upper().strip()
    if not symbol or len(symbol) > 10:
        raise HTTPException(status_code=400, detail="Invalid symbol")

    valid_periods = ["1mo", "3mo", "6mo", "1y", "2y", "5y", "10y", "max"]
    valid_intervals = ["1d", "1wk", "1mo"]
    if period not in valid_periods:
        raise HTTPException(status_code=400, detail=f"Invalid period. Use: {valid_periods}")
    if interval not in valid_intervals:
        raise HTTPException(status_code=400, detail=f"Invalid interval. Use: {valid_intervals}")

    url = f"{YAHOO_BASE}/{symbol}"
    params = {"range": period, "interval": interval, "includePrePost": "false"}
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
    }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(url, params=params, headers=headers)
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Failed to reach Yahoo Finance: {str(e)}")

    if resp.status_code != 200:
        raise HTTPException(
            status_code=resp.status_code if resp.status_code < 500 else 422,
            detail=f"Yahoo Finance returned {resp.status_code}"
        )

    try:
        data = resp.json()
        result = data["chart"]["result"][0]
        timestamps = result["timestamp"]
        quote = result["indicators"]["quote"][0]

        ohlcv = []
        for i in range(len(timestamps)):
            o = quote["open"][i]
            h = quote["high"][i]
            l = quote["low"][i]
            c = quote["close"][i]
            v = quote["volume"][i]
            if o is not None and h is not None and l is not None and c is not None:
                ohlcv.append({
                    "time": timestamps[i],
                    "open": round(o, 4),
                    "high": round(h, 4),
                    "low": round(l, 4),
                    "close": round(c, 4),
                    "volume": v or 0,
                })

        return {"symbol": symbol, "data": ohlcv}

    except (KeyError, IndexError, TypeError) as e:
        raise HTTPException(status_code=422, detail=f"Failed to parse Yahoo Finance response: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
