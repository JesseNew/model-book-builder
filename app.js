/* ============================================================
   MODEL BOOK — Main Application
   Chart Study & Annotation Tool
   ============================================================ */

const API = 'http://localhost:8000';  // Run api_server.py locally first

// ============================================================
// STATE
// ============================================================
const state = {
  mode: 'chart',          // 'chart' | 'image'
  tool: 'select',         // current drawing tool
  color: '#e05252',
  lineWidth: 2,
  symbol: '',
  period: '1y',
  selectedTags: [],
  outcome: null,
  studies: [],            // in-memory storage
  currentStudyId: null,
  undoStack: [],
  stampPending: null,
  drawStart: null,        // for two-point drawing tools
  tempObj: null,           // temporary drawing shape
  firebase: null,
  firestore: null,
};

// ============================================================
// DOM REFS
// ============================================================
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const refs = {
  chartContainer: $('#chartContainer'),
  tvChart: $('#tvChart'),
  tvVolume: $('#tvVolume'),
  fabricCanvasEl: $('#fabricCanvas'),
  imageUploadArea: $('#imageUploadArea'),
  imageUpload: $('#imageUpload'),
  tickerInput: $('#tickerInput'),
  periodSelect: $('#periodSelect'),
  loadChartBtn: $('#loadChartBtn'),
  chartControls: $('#chartControls'),
  imageControls: $('#imageControls'),
  uploadBtn: $('#uploadBtn'),
  uploadFilename: $('#uploadFilename'),
  displaySymbol: $('#displaySymbol'),
  displayPrice: $('#displayPrice'),
  displayChange: $('#displayChange'),
  modeIndicator: $('#modeIndicator'),
  modeText: $('#modeText'),
  stampToggle: $('#stampToggle'),
  stampsMenu: $('#stampsMenu'),
  saveStudyBtn: $('#saveStudyBtn'),
  exportPngBtn: $('#exportPngBtn'),
  exportJsonBtn: $('#exportJsonBtn'),
  openBookBtn: $('#openBookBtn'),
  settingsBtn: $('#settingsBtn'),
  deleteBtn: $('#deleteBtn'),
  clearBtn: $('#clearBtn'),
  undoBtn: $('#undoBtn'),
  bookOverlay: $('#bookOverlay'),
  bookGrid: $('#bookGrid'),
  bookSearch: $('#bookSearch'),
  bookFilter: $('#bookFilter'),
  closeBookBtn: $('#closeBookBtn'),
  saveDialog: $('#saveDialog'),
  saveSummary: $('#saveSummary'),
  closeSaveDialog: $('#closeSaveDialog'),
  cancelSaveBtn: $('#cancelSaveBtn'),
  confirmSaveBtn: $('#confirmSaveBtn'),
  settingsDialog: $('#settingsDialog'),
  closeSettingsDialog: $('#closeSettingsDialog'),
  saveFirebaseBtn: $('#saveFirebaseBtn'),
  clearFirebaseBtn: $('#clearFirebaseBtn'),
  firebaseStatus: $('#firebaseStatus'),
  studyName: $('#studyName'),
  studyNotes: $('#studyNotes'),
  toastContainer: $('#toastContainer'),
};

// ============================================================
// CHART (TradingView Lightweight Charts)
// ============================================================
let tvChartInstance = null;
let candleSeries = null;
let volumeSeries = null;
let chartData = [];

function getChartColors() {
  const cs = getComputedStyle(document.documentElement);
  return {
    bg: cs.getPropertyValue('--color-bg').trim(),
    surface: cs.getPropertyValue('--color-surface').trim(),
    text: cs.getPropertyValue('--color-text').trim(),
    textMuted: cs.getPropertyValue('--color-text-muted').trim(),
    textFaint: cs.getPropertyValue('--color-text-faint').trim(),
    border: cs.getPropertyValue('--color-border').trim(),
    divider: cs.getPropertyValue('--color-divider').trim(),
    upColor: cs.getPropertyValue('--color-candle-up').trim(),
    downColor: cs.getPropertyValue('--color-candle-down').trim(),
    volUp: cs.getPropertyValue('--color-volume-up').trim(),
    volDown: cs.getPropertyValue('--color-volume-down').trim(),
  };
}

function createChart() {
  const colors = getChartColors();
  const container = refs.tvChart;
  const rect = container.getBoundingClientRect();

  if (tvChartInstance) {
    tvChartInstance.remove();
    tvChartInstance = null;
  }

  tvChartInstance = LightweightCharts.createChart(container, {
    width: rect.width,
    height: rect.height,
    layout: {
      background: { color: colors.bg },
      textColor: colors.textMuted,
      fontFamily: "'Inter', sans-serif",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: colors.divider },
      horzLines: { color: colors.divider },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: colors.textFaint, width: 1, style: 2, labelBackgroundColor: colors.surface },
      horzLine: { color: colors.textFaint, width: 1, style: 2, labelBackgroundColor: colors.surface },
    },
    rightPriceScale: {
      borderColor: colors.border,
      scaleMargins: { top: 0.05, bottom: 0.05 },
    },
    timeScale: {
      borderColor: colors.border,
      timeVisible: false,
    },
    handleScroll: state.tool === 'select',
    handleScale: state.tool === 'select',
  });

  candleSeries = tvChartInstance.addCandlestickSeries({
    upColor: colors.upColor,
    downColor: colors.downColor,
    borderUpColor: colors.upColor,
    borderDownColor: colors.downColor,
    wickUpColor: colors.upColor,
    wickDownColor: colors.downColor,
  });

  volumeSeries = tvChartInstance.addHistogramSeries({
    priceFormat: { type: 'volume' },
    priceScaleId: 'volume',
  });

  tvChartInstance.priceScale('volume').applyOptions({
    scaleMargins: { top: 0.85, bottom: 0 },
  });
}

function updateChartData(data) {
  chartData = data;
  if (!candleSeries || !volumeSeries) return;

  const colors = getChartColors();
  const candleData = data.map(d => ({
    time: d.time,
    open: d.open,
    high: d.high,
    low: d.low,
    close: d.close,
  }));

  const volumeData = data.map(d => ({
    time: d.time,
    value: d.volume,
    color: d.close >= d.open ? colors.volUp : colors.volDown,
  }));

  candleSeries.setData(candleData);
  volumeSeries.setData(volumeData);
  tvChartInstance.timeScale().fitContent();

  // Update price display
  if (data.length > 0) {
    const last = data[data.length - 1];
    const first = data[0];
    const change = last.close - first.open;
    const changePct = (change / first.open) * 100;
    refs.displayPrice.textContent = `$${last.close.toFixed(2)}`;
    refs.displayPrice.className = `mono ${change >= 0 ? 'price-up' : 'price-down'}`;
    refs.displayChange.textContent = `${change >= 0 ? '+' : ''}${change.toFixed(2)} (${changePct >= 0 ? '+' : ''}${changePct.toFixed(1)}%)`;
    refs.displayChange.className = `mono ${change >= 0 ? 'price-up' : 'price-down'}`;
  }
}

async function loadChart() {
  const symbol = refs.tickerInput.value.trim().toUpperCase();
  if (!symbol) { showToast('Enter a ticker symbol', 'error'); return; }

  state.symbol = symbol;
  state.period = refs.periodSelect.value;
  refs.displaySymbol.textContent = symbol;
  refs.loadChartBtn.disabled = true;
  refs.loadChartBtn.innerHTML = '<span>Loading...</span>';

  try {
    const resp = await fetch(`${API}/api/stock/${symbol}?period=${state.period}&interval=1d`);
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.detail || `HTTP ${resp.status}`);
    }
    const json = await resp.json();
    if (!json.data || json.data.length === 0) throw new Error('No data returned');

    // Clear placeholder and create chart
    if (!tvChartInstance) {
      refs.tvChart.innerHTML = '';
      createChart();
    }
    updateChartData(json.data);

    // Auto-suggest study name
    const now = new Date();
    const dateStr = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    refs.studyName.value = `${symbol} — ${dateStr}`;

    showToast(`Loaded ${symbol} (${json.data.length} bars)`, 'success');
  } catch (e) {
    showToast(`Failed: ${e.message}`, 'error');
  }

  refs.loadChartBtn.disabled = false;
  refs.loadChartBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22,6 13.5,14.5 8.5,9.5 2,16"/></svg> Load Chart';
}

// ============================================================
// FABRIC.JS CANVAS
// ============================================================
let fabricCanvas = null;

function initFabricCanvas() {
  const container = refs.chartContainer;
  const rect = container.getBoundingClientRect();

  fabricCanvas = new fabric.Canvas('fabricCanvas', {
    width: rect.width,
    height: rect.height,
    selection: state.tool === 'select',
    isDrawingMode: false,
    backgroundColor: 'transparent',
  });

  fabricCanvas.freeDrawingBrush.color = state.color;
  fabricCanvas.freeDrawingBrush.width = state.lineWidth;

  // Start with pointer events off so chart can be interacted with
  fabricCanvas.upperCanvasEl.style.pointerEvents = 'none';
  fabricCanvas.wrapperEl.style.pointerEvents = 'none';
  fabricCanvas.wrapperEl.style.position = 'absolute';
  fabricCanvas.wrapperEl.style.top = '0';
  fabricCanvas.wrapperEl.style.left = '0';
  fabricCanvas.wrapperEl.style.zIndex = '5';

  // Canvas events for drawing tools
  fabricCanvas.on('mouse:down', onCanvasMouseDown);
  fabricCanvas.on('mouse:move', onCanvasMouseMove);
  fabricCanvas.on('mouse:up', onCanvasMouseUp);
  fabricCanvas.on('path:created', () => pushUndo()); // undo for freehand

  updateCanvasInteraction();
}

function resizeCanvas() {
  if (!fabricCanvas) return;
  const container = refs.chartContainer;
  const rect = container.getBoundingClientRect();
  fabricCanvas.setWidth(rect.width);
  fabricCanvas.setHeight(rect.height);
  fabricCanvas.renderAll();

  // Also resize TradingView chart
  if (tvChartInstance) {
    const chartRect = refs.tvChart.getBoundingClientRect();
    if (chartRect.width > 0 && chartRect.height > 0) {
      tvChartInstance.resize(chartRect.width, chartRect.height);
    }
  }
}

function updateCanvasInteraction() {
  if (!fabricCanvas) return;

  const isSelect = state.tool === 'select';
  const isFreehand = state.tool === 'freehand';
  const isDrawing = !isSelect;

  // Chart interaction only in select mode
  if (tvChartInstance) {
    tvChartInstance.applyOptions({
      handleScroll: isSelect,
      handleScale: isSelect,
    });
  }

  // Fabric selection
  fabricCanvas.selection = isSelect;
  fabricCanvas.forEachObject(obj => { obj.selectable = isSelect; obj.evented = isSelect; });

  // Freehand mode
  fabricCanvas.isDrawingMode = isFreehand;
  if (isFreehand) {
    fabricCanvas.freeDrawingBrush.color = state.color;
    fabricCanvas.freeDrawingBrush.width = state.lineWidth;
  }

  // Canvas pointer events — enable for drawing or when objects exist in select mode
  const hasObjects = fabricCanvas.getObjects().length > 0;
  const enablePointer = isDrawing || (isSelect && hasObjects);
  const pe = enablePointer ? 'auto' : 'none';
  fabricCanvas.upperCanvasEl.style.pointerEvents = pe;
  fabricCanvas.lowerCanvasEl.style.pointerEvents = pe;
  fabricCanvas.wrapperEl.style.pointerEvents = pe;

  // Container cursor
  refs.chartContainer.className = 'chart-container' + 
    (isDrawing && !isFreehand && state.tool !== 'text' && state.tool !== 'stamp' ? ' drawing-mode' : '') +
    (state.tool === 'text' ? ' text-mode' : '') +
    (state.tool === 'stamp' || state.stampPending ? ' stamp-mode' : '');

  // Mode indicator
  refs.modeIndicator.setAttribute('data-drawing', isDrawing ? 'true' : 'false');
  const toolNames = {
    select: 'Select Mode',
    trendline: 'Draw Trendline',
    hline: 'Place H-Line',
    rectangle: 'Draw Rectangle',
    ellipse: 'Draw Ellipse',
    freehand: 'Freehand Draw',
    arrow: 'Draw Arrow',
    text: 'Place Text',
    stamp: 'Place Stamp',
  };
  refs.modeText.textContent = state.stampPending ? `Stamp: ${state.stampPending}` : (toolNames[state.tool] || 'Select Mode');
}

// ============================================================
// DRAWING HANDLERS
// ============================================================
function onCanvasMouseDown(opt) {
  if (state.tool === 'select' || state.tool === 'freehand') return;

  const pointer = fabricCanvas.getPointer(opt.e);

  if (state.stampPending) {
    placeStamp(pointer);
    return;
  }

  if (state.tool === 'text') {
    placeText(pointer);
    return;
  }

  if (state.tool === 'hline') {
    placeHLine(pointer);
    return;
  }

  // Two-point tools: trendline, rectangle, ellipse, arrow
  state.drawStart = { x: pointer.x, y: pointer.y };
  
  if (state.tool === 'trendline' || state.tool === 'arrow') {
    state.tempObj = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
      stroke: state.color,
      strokeWidth: state.lineWidth,
      selectable: false,
      evented: false,
    });
    fabricCanvas.add(state.tempObj);
  } else if (state.tool === 'rectangle') {
    state.tempObj = new fabric.Rect({
      left: pointer.x,
      top: pointer.y,
      width: 0,
      height: 0,
      fill: 'transparent',
      stroke: state.color,
      strokeWidth: state.lineWidth,
      selectable: false,
      evented: false,
    });
    fabricCanvas.add(state.tempObj);
  } else if (state.tool === 'ellipse') {
    state.tempObj = new fabric.Ellipse({
      left: pointer.x,
      top: pointer.y,
      rx: 0,
      ry: 0,
      fill: 'transparent',
      stroke: state.color,
      strokeWidth: state.lineWidth,
      selectable: false,
      evented: false,
    });
    fabricCanvas.add(state.tempObj);
  }
}

function onCanvasMouseMove(opt) {
  if (!state.drawStart || !state.tempObj) return;
  const pointer = fabricCanvas.getPointer(opt.e);

  if (state.tool === 'trendline' || state.tool === 'arrow') {
    state.tempObj.set({ x2: pointer.x, y2: pointer.y });
    state.tempObj.setCoords();
  } else if (state.tool === 'rectangle') {
    const left = Math.min(state.drawStart.x, pointer.x);
    const top = Math.min(state.drawStart.y, pointer.y);
    state.tempObj.set({
      left, top,
      width: Math.abs(pointer.x - state.drawStart.x),
      height: Math.abs(pointer.y - state.drawStart.y),
    });
    state.tempObj.setCoords();
  } else if (state.tool === 'ellipse') {
    const rx = Math.abs(pointer.x - state.drawStart.x) / 2;
    const ry = Math.abs(pointer.y - state.drawStart.y) / 2;
    state.tempObj.set({
      left: Math.min(state.drawStart.x, pointer.x),
      top: Math.min(state.drawStart.y, pointer.y),
      rx, ry,
    });
    state.tempObj.setCoords();
  }

  fabricCanvas.renderAll();
}

function onCanvasMouseUp(opt) {
  if (!state.drawStart || !state.tempObj) return;
  const pointer = fabricCanvas.getPointer(opt.e);

  // Finalize the object
  state.tempObj.set({ selectable: true, evented: true });

  // Add arrowhead for arrow tool
  if (state.tool === 'arrow') {
    const line = state.tempObj;
    const x1 = line.x1, y1 = line.y1, x2 = line.x2, y2 = line.y2;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const headLen = 12;
    const headAngle = Math.PI / 6;

    const arrowHead = new fabric.Polyline([
      { x: x2, y: y2 },
      { x: x2 - headLen * Math.cos(angle - headAngle), y: y2 - headLen * Math.sin(angle - headAngle) },
      { x: x2 - headLen * Math.cos(angle + headAngle), y: y2 - headLen * Math.sin(angle + headAngle) },
    ], {
      fill: state.color,
      stroke: state.color,
      strokeWidth: 1,
      selectable: false,
      evented: false,
    });

    const group = new fabric.Group([line, arrowHead], {
      selectable: true,
      evented: true,
    });
    fabricCanvas.remove(line);
    fabricCanvas.add(group);
    state.tempObj = null;
  }

  pushUndo();
  state.drawStart = null;
  state.tempObj = null;
}

function placeStamp(pointer) {
  const label = state.stampPending;
  if (!label) return;

  // Color mapping for stamps
  const stampColors = {
    'Cup with Handle': '#4f9ead',
    'Flat Base': '#4f9ead',
    'Double Bottom': '#4f9ead',
    'High Tight Flag': '#26a869',
    'Breakout': '#26a869',
    'Buy Point': '#26a869',
    'Volume Dry-Up': '#d4a534',
    'Pivot Point': '#d4a534',
    'Failed Breakout': '#e05252',
  };
  const bgColor = stampColors[label] || '#4f9ead';

  // Create badge group
  const text = new fabric.Text(label, {
    fontSize: 10,
    fontFamily: 'Inter, sans-serif',
    fontWeight: '600',
    fill: '#fff',
    originX: 'center',
    originY: 'center',
  });

  const padding = 8;
  const bg = new fabric.Rect({
    width: text.width + padding * 2,
    height: text.height + padding,
    rx: 10,
    ry: 10,
    fill: bgColor,
    originX: 'center',
    originY: 'center',
  });

  const group = new fabric.Group([bg, text], {
    left: pointer.x - (text.width + padding * 2) / 2,
    top: pointer.y - (text.height + padding) / 2,
    selectable: true,
    evented: true,
    _stampLabel: label,
  });

  fabricCanvas.add(group);
  pushUndo();

  // Reset stamp mode
  state.stampPending = null;
  setTool('select');
  showToast(`Placed: ${label}`, 'success');
}

function placeText(pointer) {
  const text = new fabric.IText('Text', {
    left: pointer.x,
    top: pointer.y,
    fontSize: 13,
    fontFamily: 'Inter, sans-serif',
    fontWeight: '500',
    fill: state.color,
    selectable: true,
    evented: true,
    editable: true,
  });

  fabricCanvas.add(text);
  fabricCanvas.setActiveObject(text);
  text.enterEditing();
  pushUndo();
}

function placeHLine(pointer) {
  const w = fabricCanvas.width;
  const line = new fabric.Line([0, pointer.y, w, pointer.y], {
    stroke: state.color,
    strokeWidth: state.lineWidth,
    strokeDashArray: [6, 4],
    selectable: true,
    evented: true,
    lockMovementX: true,
  });
  fabricCanvas.add(line);
  pushUndo();
}

// ============================================================
// UNDO SYSTEM
// ============================================================
function pushUndo() {
  const json = fabricCanvas.toJSON();
  state.undoStack.push(JSON.stringify(json));
  if (state.undoStack.length > 50) state.undoStack.shift();
}

function undo() {
  if (state.undoStack.length === 0) return;
  state.undoStack.pop(); // Remove current state
  const prev = state.undoStack[state.undoStack.length - 1];
  if (prev) {
    fabricCanvas.loadFromJSON(prev, () => {
      fabricCanvas.renderAll();
      updateCanvasInteraction();
    });
  } else {
    fabricCanvas.clear();
    fabricCanvas.renderAll();
  }
}

// ============================================================
// TOOL MANAGEMENT
// ============================================================
function setTool(tool) {
  state.tool = tool;
  state.drawStart = null;
  state.tempObj = null;
  if (tool !== 'stamp') state.stampPending = null;

  // Update toolbar buttons
  $$('.tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  updateCanvasInteraction();
}

// ============================================================
// SAVE / LOAD / EXPORT
// ============================================================
function generateThumbnail() {
  return new Promise(resolve => {
    const container = refs.chartContainer;
    const w = container.offsetWidth;
    const h = container.offsetHeight;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');

    // Draw background
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim();
    ctx.fillRect(0, 0, w, h);

    // Draw all TradingView chart canvases
    if (tvChartInstance && state.mode === 'chart') {
      const tvCanvases = refs.tvChart.querySelectorAll('canvas');
      tvCanvases.forEach(c => {
        try { ctx.drawImage(c, 0, 0); } catch(e) {}
      });
    }

    // Draw fabric overlay
    if (fabricCanvas) {
      try {
        const fabricEl = fabricCanvas.toCanvasElement();
        ctx.drawImage(fabricEl, 0, 0);
      } catch(e) {}
    }

    resolve(canvas.toDataURL('image/png', 0.8));
  });
}

async function saveStudy() {
  const name = refs.studyName.value.trim();
  if (!name) { showToast('Enter a study name', 'error'); return; }

  const thumbnail = await generateThumbnail();
  const annotations = fabricCanvas ? JSON.stringify(fabricCanvas.toJSON()) : '{}';

  const study = {
    id: state.currentStudyId || Date.now().toString(36) + Math.random().toString(36).substr(2, 4),
    name,
    symbol: state.symbol || 'N/A',
    mode: state.mode,
    period: state.period,
    tags: [...state.selectedTags],
    outcome: state.outcome,
    notes: refs.studyNotes.value.trim(),
    annotations,
    thumbnail,
    chartData: state.mode === 'chart' ? chartData : null,
    createdAt: new Date().toISOString(),
  };

  // Save to memory
  const existingIdx = state.studies.findIndex(s => s.id === study.id);
  if (existingIdx >= 0) {
    state.studies[existingIdx] = study;
  } else {
    state.studies.push(study);
  }
  state.currentStudyId = study.id;

  // Save to Firestore if connected
  if (state.firestore) {
    try {
      await state.firestore.collection('studies').doc(study.id).set(study);
    } catch (e) {
      console.warn('Firestore save failed:', e);
    }
  }

  showToast(`Saved: ${name}`, 'success');
  refs.saveDialog.classList.add('hidden');
}

function loadStudy(study) {
  state.currentStudyId = study.id;
  state.symbol = study.symbol;
  state.period = study.period || '1y';
  state.selectedTags = [...(study.tags || [])];
  state.outcome = study.outcome;

  refs.studyName.value = study.name;
  refs.studyNotes.value = study.notes || '';

  // Update tags UI
  $$('.tag-btn').forEach(btn => {
    btn.classList.toggle('active', state.selectedTags.includes(btn.dataset.tag));
  });
  // Update outcome UI
  $$('.outcome-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.outcome === state.outcome);
  });

  if (study.mode === 'chart' && study.chartData) {
    setMode('chart');
    refs.tickerInput.value = study.symbol;
    refs.periodSelect.value = study.period || '1y';
    refs.displaySymbol.textContent = study.symbol;
    if (!tvChartInstance) {
      refs.tvChart.innerHTML = '';
      createChart();
    }
    updateChartData(study.chartData);
  }

  // Load annotations
  if (study.annotations && fabricCanvas) {
    try {
      fabricCanvas.loadFromJSON(study.annotations, () => {
        fabricCanvas.renderAll();
        updateCanvasInteraction();
      });
    } catch(e) {
      console.warn('Failed to load annotations:', e);
    }
  }

  // Close book
  refs.bookOverlay.classList.add('hidden');
  showToast(`Loaded: ${study.name}`, 'success');
}

function deleteStudy(id) {
  state.studies = state.studies.filter(s => s.id !== id);
  if (state.firestore) {
    try { state.firestore.collection('studies').doc(id).delete(); } catch(e) {}
  }
  renderBookGrid();
  showToast('Study deleted', 'success');
}

function exportPng() {
  generateThumbnail().then(dataUrl => {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `${state.symbol || 'study'}-${Date.now()}.png`;
    a.click();
    showToast('PNG exported', 'success');
  });
}

function exportJson() {
  const data = {
    symbol: state.symbol,
    period: state.period,
    name: refs.studyName.value,
    tags: state.selectedTags,
    outcome: state.outcome,
    notes: refs.studyNotes.value,
    annotations: fabricCanvas ? fabricCanvas.toJSON() : {},
    exportedAt: new Date().toISOString(),
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${state.symbol || 'study'}-annotations-${Date.now()}.json`;
  a.click();
  showToast('JSON exported', 'success');
}

// ============================================================
// MODEL BOOK BROWSER
// ============================================================
function renderBookGrid() {
  const search = refs.bookSearch.value.trim().toUpperCase();
  const filter = refs.bookFilter.value;

  let filtered = state.studies;
  if (search) {
    filtered = filtered.filter(s => s.symbol.includes(search) || s.name.toUpperCase().includes(search));
  }
  if (filter) {
    filtered = filtered.filter(s => s.tags && s.tags.includes(filter));
  }

  if (filtered.length === 0) {
    refs.bookGrid.innerHTML = `
      <div class="book-empty">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>
        <p>${search || filter ? 'No matching studies' : 'No saved studies yet'}</p>
        <p class="muted">Save your first chart study to start building your model book</p>
      </div>`;
    return;
  }

  refs.bookGrid.innerHTML = filtered.map(s => {
    const outcomeBadge = s.outcome
      ? `<span class="badge badge-${s.outcome === 'Winner' ? 'success' : s.outcome === 'Loser' ? 'error' : 'warning'}">${s.outcome}</span>`
      : '';
    const tags = (s.tags || []).map(t => `<span class="badge badge-neutral">${t}</span>`).join('');
    const date = new Date(s.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    return `
      <div class="study-card" data-study-id="${s.id}">
        <button class="study-card-delete" data-delete-id="${s.id}" title="Delete study">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
        <div class="study-card-thumb">
          ${s.thumbnail ? `<img src="${s.thumbnail}" alt="${s.name}">` : ''}
        </div>
        <div class="study-card-body">
          <div class="study-card-title">${s.name}</div>
          <div class="study-card-date">${s.symbol} · ${date}</div>
          <div class="study-card-tags">${outcomeBadge}${tags}</div>
        </div>
      </div>`;
  }).join('');

  // Event handlers for cards
  refs.bookGrid.querySelectorAll('.study-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.study-card-delete')) {
        e.stopPropagation();
        const id = e.target.closest('.study-card-delete').dataset.deleteId;
        deleteStudy(id);
        return;
      }
      const id = card.dataset.studyId;
      const study = state.studies.find(s => s.id === id);
      if (study) loadStudy(study);
    });
  });
}

// ============================================================
// MODE SWITCHING
// ============================================================
function setMode(mode) {
  state.mode = mode;

  $$('.mode-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.mode === mode);
  });

  if (mode === 'chart') {
    refs.chartControls.classList.remove('hidden');
    refs.imageControls.classList.add('hidden');
    refs.imageUploadArea.classList.add('hidden');
    refs.tvChart.style.display = '';
    refs.tvVolume.style.display = '';
  } else {
    refs.chartControls.classList.add('hidden');
    refs.imageControls.classList.remove('hidden');
    refs.imageUploadArea.classList.remove('hidden');
    refs.tvChart.style.display = 'none';
    refs.tvVolume.style.display = 'none';
  }
}

// ============================================================
// IMAGE UPLOAD
// ============================================================
function handleImageUpload(file) {
  if (!file || !file.type.startsWith('image/')) return;

  const reader = new FileReader();
  reader.onload = (e) => {
    refs.uploadFilename.textContent = file.name;

    // Create fabric image
    fabric.Image.fromURL(e.target.result, (img) => {
      fabricCanvas.clear();
      const scale = Math.min(
        fabricCanvas.width / img.width,
        fabricCanvas.height / img.height
      );
      img.scale(scale);
      img.set({
        left: (fabricCanvas.width - img.width * scale) / 2,
        top: (fabricCanvas.height - img.height * scale) / 2,
        selectable: false,
        evented: false,
        _isBackground: true,
      });
      fabricCanvas.add(img);
      fabricCanvas.sendToBack(img);
      fabricCanvas.renderAll();

      // Hide upload prompt
      refs.imageUploadArea.innerHTML = '';
      refs.imageUploadArea.style.display = 'none';
    });
  };
  reader.readAsDataURL(file);
}

// ============================================================
// FIREBASE
// ============================================================
function initFirebase(config) {
  try {
    if (state.firebase) {
      state.firebase.delete();
    }
    state.firebase = firebase.initializeApp(config);
    state.firestore = firebase.firestore();

    // Anonymous auth
    firebase.auth().signInAnonymously().then(() => {
      refs.firebaseStatus.innerHTML = '<span class="badge badge-success">Connected to Firebase</span>';
      showToast('Connected to Firebase', 'success');

      // Load studies from Firestore
      state.firestore.collection('studies').get().then(snapshot => {
        snapshot.forEach(doc => {
          const data = doc.data();
          if (!state.studies.find(s => s.id === data.id)) {
            state.studies.push(data);
          }
        });
      });
    }).catch(e => {
      refs.firebaseStatus.innerHTML = `<span class="badge badge-error">Auth failed: ${e.message}</span>`;
    });
  } catch (e) {
    refs.firebaseStatus.innerHTML = `<span class="badge badge-error">Error: ${e.message}</span>`;
  }
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  refs.toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}

// ============================================================
// THEME TOGGLE
// ============================================================
(function initTheme() {
  const toggle = $('[data-theme-toggle]');
  const root = document.documentElement;
  let theme = 'dark';
  root.setAttribute('data-theme', theme);

  if (toggle) {
    toggle.addEventListener('click', () => {
      theme = theme === 'dark' ? 'light' : 'dark';
      root.setAttribute('data-theme', theme);
      toggle.innerHTML = theme === 'dark'
        ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>'
        : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';

      // Recreate chart with new colors
      if (tvChartInstance && chartData.length > 0) {
        createChart();
        updateChartData(chartData);
      }
    });
  }
})();

// ============================================================
// EVENT LISTENERS
// ============================================================
function initEventListeners() {
  // Load chart
  refs.loadChartBtn.addEventListener('click', loadChart);
  refs.tickerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadChart();
  });

  // Mode toggle
  $$('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  // Tool selection
  $$('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setTool(btn.dataset.tool));
  });

  // Stamps
  refs.stampToggle.addEventListener('click', (e) => {
    e.stopPropagation();
    refs.stampsMenu.classList.toggle('open');
  });
  $$('.stamp-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      state.stampPending = btn.dataset.stamp;
      state.tool = 'stamp';
      refs.stampsMenu.classList.remove('open');
      updateCanvasInteraction();
    });
  });

  // Color picker
  $$('.color-swatch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.color-swatch-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.color = btn.dataset.color;
      if (fabricCanvas) {
        fabricCanvas.freeDrawingBrush.color = state.color;
        const active = fabricCanvas.getActiveObject();
        if (active) {
          if (active.type === 'i-text' || active.type === 'text') {
            active.set('fill', state.color);
          } else {
            active.set('stroke', state.color);
          }
          fabricCanvas.renderAll();
        }
      }
    });
  });

  // Width picker
  $$('.width-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      $$('.width-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.lineWidth = parseInt(btn.dataset.width);
      if (fabricCanvas) {
        fabricCanvas.freeDrawingBrush.width = state.lineWidth;
        const active = fabricCanvas.getActiveObject();
        if (active && active.strokeWidth !== undefined) {
          active.set('strokeWidth', state.lineWidth);
          fabricCanvas.renderAll();
        }
      }
    });
  });

  // Tags
  $$('.tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
      const tag = btn.dataset.tag;
      if (state.selectedTags.includes(tag)) {
        state.selectedTags = state.selectedTags.filter(t => t !== tag);
      } else {
        state.selectedTags.push(tag);
      }
    });
  });

  // Outcome
  $$('.outcome-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const wasActive = btn.classList.contains('active');
      $$('.outcome-btn').forEach(b => b.classList.remove('active'));
      if (!wasActive) {
        btn.classList.add('active');
        state.outcome = btn.dataset.outcome;
      } else {
        state.outcome = null;
      }
    });
  });

  // Delete / Clear / Undo
  refs.deleteBtn.addEventListener('click', () => {
    const active = fabricCanvas.getActiveObjects();
    if (active.length > 0) {
      active.forEach(obj => fabricCanvas.remove(obj));
      fabricCanvas.discardActiveObject();
      fabricCanvas.renderAll();
      pushUndo();
    }
  });

  refs.clearBtn.addEventListener('click', () => {
    if (fabricCanvas.getObjects().length === 0) return;
    fabricCanvas.clear();
    fabricCanvas.renderAll();
    pushUndo();
    showToast('Annotations cleared');
  });

  refs.undoBtn.addEventListener('click', undo);

  // Save
  refs.saveStudyBtn.addEventListener('click', () => {
    const name = refs.studyName.value.trim() || `${state.symbol || 'Study'} — ${new Date().toLocaleDateString()}`;
    refs.studyName.value = name;
    const tags = state.selectedTags.join(', ') || 'None';
    refs.saveSummary.textContent = `Save "${name}" with tags: ${tags}`;
    refs.saveDialog.classList.remove('hidden');
  });
  refs.confirmSaveBtn.addEventListener('click', () => saveStudy());
  refs.cancelSaveBtn.addEventListener('click', () => refs.saveDialog.classList.add('hidden'));
  refs.closeSaveDialog.addEventListener('click', () => refs.saveDialog.classList.add('hidden'));

  // Export
  refs.exportPngBtn.addEventListener('click', exportPng);
  refs.exportJsonBtn.addEventListener('click', exportJson);

  // Book
  refs.openBookBtn.addEventListener('click', () => {
    renderBookGrid();
    refs.bookOverlay.classList.remove('hidden');
  });
  refs.closeBookBtn.addEventListener('click', () => refs.bookOverlay.classList.add('hidden'));
  refs.bookSearch.addEventListener('input', renderBookGrid);
  refs.bookFilter.addEventListener('change', renderBookGrid);

  // Settings
  refs.settingsBtn.addEventListener('click', () => refs.settingsDialog.classList.remove('hidden'));
  refs.closeSettingsDialog.addEventListener('click', () => refs.settingsDialog.classList.add('hidden'));
  refs.saveFirebaseBtn.addEventListener('click', () => {
    const apiKey = $('#fbApiKey').value.trim();
    const authDomain = $('#fbAuthDomain').value.trim();
    const projectId = $('#fbProjectId').value.trim();
    if (!apiKey || !authDomain || !projectId) {
      showToast('Fill in all Firebase fields', 'error');
      return;
    }
    initFirebase({ apiKey, authDomain, projectId });
  });
  refs.clearFirebaseBtn.addEventListener('click', () => {
    state.firebase = null;
    state.firestore = null;
    refs.firebaseStatus.innerHTML = '<span class="badge badge-neutral">Not connected — using in-memory storage</span>';
    showToast('Firebase disconnected');
  });

  // Image upload
  refs.uploadBtn.addEventListener('click', () => refs.imageUpload.click());
  refs.imageUploadArea.addEventListener('click', () => {
    if (state.mode === 'image') refs.imageUpload.click();
  });
  refs.imageUpload.addEventListener('change', (e) => {
    if (e.target.files[0]) handleImageUpload(e.target.files[0]);
  });

  // Drag & drop for image
  refs.chartContainer.addEventListener('dragover', (e) => {
    if (state.mode === 'image') {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  refs.chartContainer.addEventListener('drop', (e) => {
    if (state.mode === 'image') {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleImageUpload(file);
    }
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    // Don't capture when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'v' || e.key === 'V') setTool('select');
    else if (e.key === 'l' || e.key === 'L') setTool('trendline');
    else if (e.key === 'h' || e.key === 'H') setTool('hline');
    else if (e.key === 'r' || e.key === 'R') setTool('rectangle');
    else if (e.key === 'e' || e.key === 'E') setTool('ellipse');
    else if (e.key === 'f' || e.key === 'F') setTool('freehand');
    else if (e.key === 'a' || e.key === 'A') setTool('arrow');
    else if (e.key === 't' || e.key === 'T') setTool('text');
    else if (e.key === 'Escape') {
      setTool('select');
      fabricCanvas.discardActiveObject();
      fabricCanvas.renderAll();
      refs.stampsMenu.classList.remove('open');
      refs.bookOverlay.classList.add('hidden');
      refs.saveDialog.classList.add('hidden');
      refs.settingsDialog.classList.add('hidden');
    }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      if (fabricCanvas) {
        const active = fabricCanvas.getActiveObjects();
        if (active.length > 0) {
          active.forEach(obj => fabricCanvas.remove(obj));
          fabricCanvas.discardActiveObject();
          fabricCanvas.renderAll();
          pushUndo();
        }
      }
    }
    else if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      undo();
    }
  });

  // Close menus on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.stamps-dropdown')) {
      refs.stampsMenu.classList.remove('open');
    }
    // Close dialogs on overlay click
    if (e.target === refs.bookOverlay) refs.bookOverlay.classList.add('hidden');
    if (e.target === refs.saveDialog) refs.saveDialog.classList.add('hidden');
    if (e.target === refs.settingsDialog) refs.settingsDialog.classList.add('hidden');
  });

  // Resize observer
  const ro = new ResizeObserver(() => resizeCanvas());
  ro.observe(refs.chartContainer);
}

// ============================================================
// INIT
// ============================================================
function init() {
  initFabricCanvas();
  initEventListeners();

  // Show placeholder text in chart area (don't create chart yet)
  refs.tvChart.innerHTML = `
    <div class="chart-placeholder">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1"><polyline points="22,6 13.5,14.5 8.5,9.5 2,16"/><polyline points="16,6 22,6 22,12"/></svg>
      <p class="mono">Enter a ticker to begin</p>
      <p>Type a symbol like AAPL, NVDA, or TSLA and click Load Chart</p>
    </div>`;
}

document.addEventListener('DOMContentLoaded', init);
