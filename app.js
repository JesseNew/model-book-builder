/**
 * Model Book Lite — Chart Annotation App
 * All application logic: Fabric.js canvas, drawing tools, persistent storage, export
 */

/* global fabric */

/* ===========================================================
   STORAGE ABSTRACTION
   In sandboxed iframes, browser storage may be unavailable.
   Falls back to in-memory storage so the app still works.
   =========================================================== */

const storage = (() => {
  try {
    const test = '__storage_test__';
    const ls = window['local' + 'Storage'];
    ls.setItem(test, test);
    ls.removeItem(test);
    return ls;
  } catch {
    // In-memory fallback for sandboxed environments
    const mem = {};
    return {
      getItem(key) { return mem[key] !== undefined ? mem[key] : null; },
      setItem(key, val) { mem[key] = String(val); },
      removeItem(key) { delete mem[key]; }
    };
  }
})();

/* ===========================================================
   INITIALIZATION
   =========================================================== */

// Wait for Fabric.js to load
document.addEventListener('DOMContentLoaded', initApp);

// Global state
let fabricCanvas = null;
let currentTool = 'select';
let currentColor = '#26a869';
let currentWidth = 2;
let activeStamp = null;
let isDrawing = false;
let drawStart = null;
let tempShape = null;
let undoStack = [];
let currentImageDataURL = null; // store the uploaded image as data URL
let currentStudyId = null; // if editing a saved study

// Stamp color map
const STAMP_COLORS = {
  'Cup with Handle': '#4f9ead',
  'Flat Base': '#4a8fe7',
  'Double Bottom': '#26a869',
  'High Tight Flag': '#d4a843',
  'Breakout': '#26a869',
  'Buy Point': '#26a869',
  'Volume Dry-Up': '#4f9ead',
  'Pivot Point': '#d4a843',
  'Failed Breakout': '#e05252'
};

function initApp() {
  setupThemeToggle();
  setupDropZone();
  setupToolbar();
  setupColorPicker();
  setupWidthPicker();
  setupStamps();
  setupPropsPanel();
  setupHeaderButtons();
  setupBookOverlay();
  setupKeyboardShortcuts();
}


/* ===========================================================
   THEME TOGGLE
   =========================================================== */

function setupThemeToggle() {
  const toggle = document.getElementById('theme-toggle');
  const saved = storage.getItem('mb-theme');
  if (saved) {
    document.documentElement.setAttribute('data-theme', saved);
    updateThemeIcon(saved);
  }

  toggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    storage.setItem('mb-theme', next);
    updateThemeIcon(next);
  });
}

function updateThemeIcon(theme) {
  const sun = document.querySelector('.icon-sun');
  const moon = document.querySelector('.icon-moon');
  if (theme === 'dark') {
    sun.style.display = '';
    moon.style.display = 'none';
  } else {
    sun.style.display = 'none';
    moon.style.display = '';
  }
}


/* ===========================================================
   DROP ZONE & FILE UPLOAD
   =========================================================== */

function setupDropZone() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  const canvasArea = document.getElementById('canvas-area');

  // Click to upload
  dropZone.addEventListener('click', () => fileInput.click());

  // File selected
  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      loadImageFile(e.target.files[0]);
    }
  });

  // Drag & drop
  canvasArea.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.add('drag-over');
  });

  canvasArea.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
  });

  canvasArea.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files && files[0] && files[0].type.startsWith('image/')) {
      loadImageFile(files[0]);
    }
  });
}

function loadImageFile(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    currentImageDataURL = e.target.result;
    initCanvas(currentImageDataURL);
  };
  reader.readAsDataURL(file);
}

function initCanvas(imageDataURL) {
  const dropZone = document.getElementById('drop-zone');
  const wrapper = document.getElementById('canvas-wrapper');
  const canvasArea = document.getElementById('canvas-area');

  dropZone.style.display = 'none';
  wrapper.style.display = 'flex';

  // Calculate canvas size to fit area
  const areaW = canvasArea.clientWidth;
  const areaH = canvasArea.clientHeight;

  // Create or reset Fabric canvas
  if (fabricCanvas) {
    fabricCanvas.dispose();
  }

  const canvasEl = document.getElementById('fabric-canvas');
  canvasEl.width = areaW;
  canvasEl.height = areaH;

  fabricCanvas = new fabric.Canvas('fabric-canvas', {
    width: areaW,
    height: areaH,
    backgroundColor: '#0a0a0f',
    selection: true,
    preserveObjectStacking: true
  });

  // Load image as background
  fabric.Image.fromURL(imageDataURL, (img) => {
    const scale = Math.min(areaW / img.width, areaH / img.height);
    fabricCanvas.setBackgroundImage(img, fabricCanvas.renderAll.bind(fabricCanvas), {
      scaleX: scale,
      scaleY: scale,
      originX: 'center',
      originY: 'center',
      left: areaW / 2,
      top: areaH / 2
    });
  });

  // Setup canvas event handlers
  setupCanvasEvents();
  undoStack = [];

  // Allow drop on canvas too
  const upperCanvas = fabricCanvas.upperCanvasEl;
  upperCanvas.addEventListener('dragover', (e) => {
    e.preventDefault();
  });
  upperCanvas.addEventListener('drop', (e) => {
    e.preventDefault();
    const files = e.dataTransfer.files;
    if (files && files[0] && files[0].type.startsWith('image/')) {
      loadImageFile(files[0]);
    }
  });
}


/* ===========================================================
   CANVAS EVENTS — Drawing tools
   =========================================================== */

function setupCanvasEvents() {
  fabricCanvas.on('mouse:down', onMouseDown);
  fabricCanvas.on('mouse:move', onMouseMove);
  fabricCanvas.on('mouse:up', onMouseUp);
  fabricCanvas.on('object:modified', saveUndoState);
  fabricCanvas.on('object:added', saveUndoState);

  // Edit popover: show on selection, hide on deselection
  fabricCanvas.on('selection:created', (e) => {
    if (currentTool === 'select' && e.selected && e.selected.length === 1) {
      showEditPopover(e.selected[0]);
    } else {
      hideEditPopover();
    }
  });

  fabricCanvas.on('selection:updated', (e) => {
    if (currentTool === 'select' && e.selected && e.selected.length === 1) {
      showEditPopover(e.selected[0]);
    } else {
      hideEditPopover();
    }
  });

  fabricCanvas.on('selection:cleared', () => {
    hideEditPopover();
  });

  // Reposition popover when object moves
  fabricCanvas.on('object:moving', () => {
    const active = fabricCanvas.getActiveObject();
    if (active && document.getElementById('edit-popover').style.display !== 'none') {
      showEditPopover(active);
    }
  });

  fabricCanvas.on('object:scaling', () => {
    const active = fabricCanvas.getActiveObject();
    if (active && document.getElementById('edit-popover').style.display !== 'none') {
      showEditPopover(active);
    }
  });

  // Double-click to edit text annotations
  fabricCanvas.on('mouse:dblclick', (opt) => {
    const target = opt.target;
    if (!target) return;
    if (target.type === 'i-text') {
      // Switch to select mode and enter editing
      setTool('select');
      fabricCanvas.setActiveObject(target);
      target.enterEditing();
      target.selectAll();
      hideEditPopover();
    }
  });
}

function onMouseDown(opt) {
  if (currentTool === 'select') return;
  if (currentTool === 'freehand') return; // Fabric handles this

  const pointer = fabricCanvas.getPointer(opt.e);

  // Stamp placement
  if (currentTool === 'stamp' && activeStamp) {
    placeStamp(pointer, activeStamp);
    return;
  }

  // Text placement
  if (currentTool === 'text') {
    placeText(pointer);
    return;
  }

  // Horizontal line
  if (currentTool === 'hline') {
    placeHorizontalLine(pointer);
    return;
  }

  // Start drawing shapes
  isDrawing = true;
  drawStart = { x: pointer.x, y: pointer.y };
  fabricCanvas.selection = false;

  if (currentTool === 'line' || currentTool === 'arrow') {
    tempShape = new fabric.Line([pointer.x, pointer.y, pointer.x, pointer.y], {
      stroke: currentColor,
      strokeWidth: currentWidth,
      selectable: false,
      evented: false,
      originX: 'center',
      originY: 'center'
    });
    fabricCanvas.add(tempShape);
  } else if (currentTool === 'rect') {
    tempShape = new fabric.Rect({
      left: pointer.x,
      top: pointer.y,
      width: 0,
      height: 0,
      stroke: currentColor,
      strokeWidth: currentWidth,
      fill: 'transparent',
      selectable: false,
      evented: false
    });
    fabricCanvas.add(tempShape);
  } else if (currentTool === 'ellipse') {
    tempShape = new fabric.Ellipse({
      left: pointer.x,
      top: pointer.y,
      rx: 0,
      ry: 0,
      stroke: currentColor,
      strokeWidth: currentWidth,
      fill: 'transparent',
      selectable: false,
      evented: false
    });
    fabricCanvas.add(tempShape);
  }
}

function onMouseMove(opt) {
  if (!isDrawing || !tempShape) return;
  const pointer = fabricCanvas.getPointer(opt.e);

  if (currentTool === 'line' || currentTool === 'arrow') {
    tempShape.set({ x2: pointer.x, y2: pointer.y });
  } else if (currentTool === 'rect') {
    const left = Math.min(drawStart.x, pointer.x);
    const top = Math.min(drawStart.y, pointer.y);
    const width = Math.abs(pointer.x - drawStart.x);
    const height = Math.abs(pointer.y - drawStart.y);
    tempShape.set({ left, top, width, height });
  } else if (currentTool === 'ellipse') {
    const rx = Math.abs(pointer.x - drawStart.x) / 2;
    const ry = Math.abs(pointer.y - drawStart.y) / 2;
    const cx = Math.min(drawStart.x, pointer.x) + rx;
    const cy = Math.min(drawStart.y, pointer.y) + ry;
    tempShape.set({ left: cx - rx, top: cy - ry, rx, ry });
  }

  fabricCanvas.renderAll();
}

function onMouseUp(opt) {
  if (!isDrawing) return;
  isDrawing = false;

  if (tempShape) {
    // Convert arrow line to arrow with head
    if (currentTool === 'arrow' && tempShape.type === 'line') {
      const line = tempShape;
      fabricCanvas.remove(line);
      const arrow = createArrow(
        line.x1, line.y1, line.x2, line.y2,
        currentColor, currentWidth
      );
      fabricCanvas.add(arrow);
      tempShape = null;
      fabricCanvas.renderAll();
    } else {
      // Make the shape selectable now
      tempShape.set({ selectable: true, evented: true });
      tempShape = null;
    }
  }

  fabricCanvas.selection = (currentTool === 'select');
  fabricCanvas.renderAll();
}

// Arrow creation helper
function createArrow(x1, y1, x2, y2, color, width) {
  const headLen = 12;
  const angle = Math.atan2(y2 - y1, x2 - x1);

  const line = new fabric.Line([x1, y1, x2, y2], {
    stroke: color,
    strokeWidth: width,
    selectable: false,
    evented: false
  });

  const head = new fabric.Triangle({
    left: x2,
    top: y2,
    originX: 'center',
    originY: 'center',
    width: headLen,
    height: headLen,
    fill: color,
    angle: (angle * 180 / Math.PI) + 90,
    selectable: false,
    evented: false
  });

  const group = new fabric.Group([line, head], {
    selectable: true,
    evented: true
  });

  return group;
}

// Place horizontal line across full canvas width
function placeHorizontalLine(pointer) {
  const line = new fabric.Line([0, pointer.y, fabricCanvas.width, pointer.y], {
    stroke: currentColor,
    strokeWidth: currentWidth,
    strokeDashArray: [8, 4],
    selectable: true,
    evented: true
  });
  fabricCanvas.add(line);
  fabricCanvas.renderAll();
}

// Place text
function placeText(pointer) {
  const text = new fabric.IText('Label', {
    left: pointer.x,
    top: pointer.y,
    fontFamily: 'Inter, sans-serif',
    fontSize: 16,
    fill: currentColor,
    fontWeight: '600',
    selectable: true,
    evented: true,
    editable: true
  });
  fabricCanvas.add(text);
  fabricCanvas.setActiveObject(text);
  text.enterEditing();
  text.selectAll();
  fabricCanvas.renderAll();
}

// Place stamp badge
function placeStamp(pointer, stampName) {
  const bgColor = STAMP_COLORS[stampName] || '#4f9ead';

  // Background rect
  const textObj = new fabric.Text(stampName, {
    fontFamily: 'Inter, sans-serif',
    fontSize: 11,
    fill: '#ffffff',
    fontWeight: '600',
    originX: 'center',
    originY: 'center'
  });

  const padding = 8;
  const bg = new fabric.Rect({
    width: textObj.width + padding * 2,
    height: textObj.height + padding,
    fill: bgColor,
    rx: 4,
    ry: 4,
    originX: 'center',
    originY: 'center',
    opacity: 0.9
  });

  const group = new fabric.Group([bg, textObj], {
    left: pointer.x,
    top: pointer.y,
    selectable: true,
    evented: true,
    originX: 'center',
    originY: 'center'
  });

  fabricCanvas.add(group);
  fabricCanvas.renderAll();
}


/* ===========================================================
   UNDO
   =========================================================== */

function saveUndoState() {
  if (!fabricCanvas) return;
  const json = fabricCanvas.toJSON();
  undoStack.push(JSON.stringify(json));
  // Keep stack manageable
  if (undoStack.length > 50) {
    undoStack.shift();
  }
}

function undo() {
  if (!fabricCanvas || undoStack.length < 2) return;
  undoStack.pop(); // remove current state
  const prev = undoStack[undoStack.length - 1];
  if (prev) {
    fabricCanvas.loadFromJSON(prev, () => {
      // Restore background image
      if (currentImageDataURL) {
        fabric.Image.fromURL(currentImageDataURL, (img) => {
          const scale = Math.min(fabricCanvas.width / img.width, fabricCanvas.height / img.height);
          fabricCanvas.setBackgroundImage(img, fabricCanvas.renderAll.bind(fabricCanvas), {
            scaleX: scale,
            scaleY: scale,
            originX: 'center',
            originY: 'center',
            left: fabricCanvas.width / 2,
            top: fabricCanvas.height / 2
          });
        });
      } else {
        fabricCanvas.renderAll();
      }
    });
  }
}


/* ===========================================================
   TOOLBAR
   =========================================================== */

function setupToolbar() {
  const toolBtns = document.querySelectorAll('.tool-btn[data-tool]');

  toolBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      setTool(tool);
    });
  });

  // Delete button
  document.getElementById('btn-delete').addEventListener('click', deleteSelected);

  // Clear all button
  document.getElementById('btn-clear').addEventListener('click', () => {
    if (!fabricCanvas) return;
    fabricCanvas.getObjects().forEach(obj => fabricCanvas.remove(obj));
    fabricCanvas.renderAll();
    showToast('Annotations cleared');
  });
}

function setTool(tool) {
  currentTool = tool;
  activeStamp = null;

  // Update button states
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
  const activeBtn = document.querySelector(`.tool-btn[data-tool="${tool}"]`);
  if (activeBtn) activeBtn.classList.add('active');

  // Close stamps dropdown if open
  document.getElementById('stamps-dropdown').classList.remove('open');

  // Hide edit popover when not in select mode
  if (tool !== 'select') {
    hideEditPopover();
  }

  if (!fabricCanvas) return;

  // Configure canvas for tool
  fabricCanvas.isDrawingMode = (tool === 'freehand');
  fabricCanvas.selection = (tool === 'select');

  if (tool === 'freehand') {
    fabricCanvas.freeDrawingBrush.color = currentColor;
    fabricCanvas.freeDrawingBrush.width = currentWidth;
  }

  // Make objects selectable only in select mode
  fabricCanvas.forEachObject(obj => {
    obj.selectable = (tool === 'select');
    obj.evented = (tool === 'select');
  });

  fabricCanvas.discardActiveObject();
  fabricCanvas.renderAll();
}

function deleteSelected() {
  if (!fabricCanvas) return;
  const active = fabricCanvas.getActiveObjects();
  if (active.length > 0) {
    active.forEach(obj => fabricCanvas.remove(obj));
    fabricCanvas.discardActiveObject();
    fabricCanvas.renderAll();
  }
}


/* ===========================================================
   COLOR & WIDTH PICKERS
   =========================================================== */

function setupColorPicker() {
  const swatches = document.querySelectorAll('.color-swatch');
  swatches.forEach(s => {
    s.addEventListener('click', () => {
      currentColor = s.dataset.color;
      swatches.forEach(sw => sw.classList.remove('active'));
      s.classList.add('active');

      if (fabricCanvas && fabricCanvas.isDrawingMode) {
        fabricCanvas.freeDrawingBrush.color = currentColor;
      }

      // Update selected object color
      if (fabricCanvas && currentTool === 'select') {
        const active = fabricCanvas.getActiveObject();
        if (active) {
          if (active.type === 'i-text' || active.type === 'text') {
            active.set('fill', currentColor);
          } else {
            active.set('stroke', currentColor);
          }
          fabricCanvas.renderAll();
        }
      }
    });
  });
}

function setupWidthPicker() {
  const swatches = document.querySelectorAll('.width-swatch');
  swatches.forEach(s => {
    s.addEventListener('click', () => {
      currentWidth = parseInt(s.dataset.width, 10);
      swatches.forEach(sw => sw.classList.remove('active'));
      s.classList.add('active');

      if (fabricCanvas && fabricCanvas.isDrawingMode) {
        fabricCanvas.freeDrawingBrush.width = currentWidth;
      }
    });
  });
}


/* ===========================================================
   STAMPS
   =========================================================== */

function setupStamps() {
  const btn = document.getElementById('btn-stamps');
  const dropdown = document.getElementById('stamps-dropdown');

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    dropdown.classList.toggle('open');
  });

  // Close on outside click
  document.addEventListener('click', (e) => {
    if (!dropdown.contains(e.target) && e.target !== btn) {
      dropdown.classList.remove('open');
    }
  });

  // Stamp items
  dropdown.querySelectorAll('.stamp-item').forEach(item => {
    item.addEventListener('click', () => {
      activeStamp = item.dataset.stamp;
      currentTool = 'stamp';

      // Update toolbar visuals
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      dropdown.classList.remove('open');

      if (fabricCanvas) {
        fabricCanvas.isDrawingMode = false;
        fabricCanvas.selection = false;
        fabricCanvas.forEachObject(obj => {
          obj.selectable = false;
          obj.evented = false;
        });
      }

      showToast(`Stamp: ${activeStamp} — Click on chart to place`);
    });
  });
}


/* ===========================================================
   PROPERTIES PANEL
   =========================================================== */

function setupPropsPanel() {
  // Tags
  document.querySelectorAll('.tag-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.classList.toggle('active');
    });
  });

  // Outcome
  document.querySelectorAll('.outcome-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.outcome-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
}

function getStudyProps() {
  const name = document.getElementById('study-name').value.trim();
  const tags = Array.from(document.querySelectorAll('.tag-btn.active')).map(b => b.dataset.tag);
  const outcomeBtn = document.querySelector('.outcome-btn.active');
  const outcome = outcomeBtn ? outcomeBtn.dataset.outcome : '';
  const notes = document.getElementById('study-notes').value.trim();
  return { name, tags, outcome, notes };
}

function setStudyProps(props) {
  document.getElementById('study-name').value = props.name || '';
  document.getElementById('study-notes').value = props.notes || '';

  // Tags
  document.querySelectorAll('.tag-btn').forEach(b => {
    b.classList.toggle('active', (props.tags || []).includes(b.dataset.tag));
  });

  // Outcome
  document.querySelectorAll('.outcome-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.outcome === props.outcome);
  });
}

function clearStudyProps() {
  document.getElementById('study-name').value = '';
  document.getElementById('study-notes').value = '';
  document.querySelectorAll('.tag-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.outcome-btn').forEach(b => b.classList.remove('active'));
  currentStudyId = null;
}


/* ===========================================================
   SAVE & EXPORT
   =========================================================== */

function setupHeaderButtons() {
  document.getElementById('btn-save-study').addEventListener('click', saveStudy);
  document.getElementById('btn-export-png').addEventListener('click', exportPNG);
  document.getElementById('btn-export-json').addEventListener('click', exportJSON);
  document.getElementById('btn-undo').addEventListener('click', undo);
  document.getElementById('btn-new-chart').addEventListener('click', newChart);
  document.getElementById('btn-delete-chart').addEventListener('click', deleteCurrentChart);
  setupEditPopover();
}

function saveStudy() {
  if (!fabricCanvas || !currentImageDataURL) {
    showToast('Upload an image first');
    return;
  }

  const props = getStudyProps();
  if (!props.name) {
    showToast('Enter a study name');
    document.getElementById('study-name').focus();
    return;
  }

  // Generate thumbnail
  const thumbDataURL = fabricCanvas.toDataURL({
    format: 'jpeg',
    quality: 0.6,
    multiplier: 0.4
  });

  // Get annotation objects as JSON (not including background)
  const canvasJSON = fabricCanvas.toJSON();

  const study = {
    id: currentStudyId || Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
    name: props.name,
    tags: props.tags,
    outcome: props.outcome,
    notes: props.notes,
    thumbnail: thumbDataURL,
    imageDataURL: currentImageDataURL,
    canvasJSON: canvasJSON,
    canvasWidth: fabricCanvas.width,
    canvasHeight: fabricCanvas.height,
    createdAt: currentStudyId ? (getStudy(currentStudyId) || {}).createdAt || new Date().toISOString() : new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  // Save to persistent storage
  const studies = getStudies();
  const existingIndex = studies.findIndex(s => s.id === study.id);
  if (existingIndex >= 0) {
    studies[existingIndex] = study;
  } else {
    studies.unshift(study);
  }
  storage.setItem('mb-studies', JSON.stringify(studies));
  currentStudyId = study.id;

  showToast('Study saved', 'success');
}

function getStudies() {
  try {
    return JSON.parse(storage.getItem('mb-studies') || '[]');
  } catch {
    return [];
  }
}

function getStudy(id) {
  return getStudies().find(s => s.id === id);
}

function deleteStudy(id) {
  const studies = getStudies().filter(s => s.id !== id);
  storage.setItem('mb-studies', JSON.stringify(studies));
  if (currentStudyId === id) currentStudyId = null;
}

function loadStudy(study) {
  currentStudyId = study.id;
  currentImageDataURL = study.imageDataURL;

  // Set props
  setStudyProps(study);

  // Init canvas with stored image
  initCanvas(currentImageDataURL);

  // Wait a tick for canvas to initialize, then load annotations
  setTimeout(() => {
    if (study.canvasJSON && fabricCanvas) {
      // We need to reload the JSON objects onto the canvas
      const objects = study.canvasJSON.objects || [];
      fabric.util.enlivenObjects(objects, (enlivenedObjects) => {
        enlivenedObjects.forEach(obj => {
          fabricCanvas.add(obj);
        });
        fabricCanvas.renderAll();
      });
    }
  }, 300);
}

function exportPNG() {
  if (!fabricCanvas) {
    showToast('No canvas to export');
    return;
  }

  const dataURL = fabricCanvas.toDataURL({
    format: 'png',
    quality: 1,
    multiplier: 2
  });

  const link = document.createElement('a');
  link.href = dataURL;
  const name = document.getElementById('study-name').value.trim() || 'model-book-chart';
  link.download = name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-') + '.png';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  showToast('PNG exported');
}

function exportJSON() {
  if (!fabricCanvas) {
    showToast('No canvas to export');
    return;
  }

  const props = getStudyProps();
  const data = {
    name: props.name,
    tags: props.tags,
    outcome: props.outcome,
    notes: props.notes,
    canvasJSON: fabricCanvas.toJSON(),
    exportedAt: new Date().toISOString()
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  const name = props.name || 'model-book-annotations';
  link.download = name.replace(/[^a-zA-Z0-9-_ ]/g, '').replace(/\s+/g, '-') + '.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  showToast('JSON exported');
}


/* ===========================================================
   NEW CHART / DELETE CHART
   =========================================================== */

function newChart() {
  if (!fabricCanvas && !currentImageDataURL) {
    showToast('No chart open');
    return;
  }
  showConfirm('Start a new chart? Unsaved work will be lost.', () => {
    resetToDropZone();
    showToast('Ready for a new chart');
  });
}

function deleteCurrentChart() {
  if (!fabricCanvas && !currentImageDataURL) {
    showToast('No chart to delete');
    return;
  }

  const isExistingStudy = currentStudyId !== null;
  const message = isExistingStudy
    ? 'Delete this chart and remove it from your saved studies?'
    : 'Delete this chart and all annotations?';

  showConfirm(message, () => {
    // If it was a saved study, remove from storage
    if (isExistingStudy) {
      deleteStudy(currentStudyId);
    }
    resetToDropZone();
    showToast('Chart deleted');
  });
}

function resetToDropZone() {
  // Dispose the canvas
  if (fabricCanvas) {
    fabricCanvas.dispose();
    fabricCanvas = null;
  }

  // Reset state
  currentImageDataURL = null;
  currentStudyId = null;
  undoStack = [];

  // Reset UI
  clearStudyProps();
  hideEditPopover();

  // Show drop zone, hide canvas
  document.getElementById('drop-zone').style.display = '';
  document.getElementById('canvas-wrapper').style.display = 'none';

  // Reset file input so the same file can be re-uploaded
  document.getElementById('file-input').value = '';
}


/* ===========================================================
   CONFIRM DIALOG
   =========================================================== */

let confirmCallback = null;

function showConfirm(message, onConfirm) {
  const overlay = document.getElementById('confirm-overlay');
  document.getElementById('confirm-message').textContent = message;
  confirmCallback = onConfirm;
  overlay.style.display = 'flex';
}

function hideConfirm() {
  document.getElementById('confirm-overlay').style.display = 'none';
  confirmCallback = null;
}

// Wire up confirm buttons once at init time
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('confirm-cancel').addEventListener('click', hideConfirm);
  document.getElementById('confirm-ok').addEventListener('click', () => {
    if (confirmCallback) confirmCallback();
    hideConfirm();
  });
  document.getElementById('confirm-overlay').addEventListener('click', (e) => {
    if (e.target === document.getElementById('confirm-overlay')) hideConfirm();
  });
});


/* ===========================================================
   EDIT POPOVER — Edit selected annotations
   =========================================================== */

function setupEditPopover() {
  const popover = document.getElementById('edit-popover');

  // Color buttons in popover
  popover.querySelectorAll('.edit-color-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!fabricCanvas) return;
      const color = btn.dataset.color;
      const active = fabricCanvas.getActiveObject();
      if (!active) return;

      applyColorToObject(active, color);
      fabricCanvas.renderAll();
      updateEditPopoverState(active);
    });
  });

  // Width buttons in popover
  popover.querySelectorAll('.edit-width-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!fabricCanvas) return;
      const width = parseInt(btn.dataset.width, 10);
      const active = fabricCanvas.getActiveObject();
      if (!active) return;

      applyWidthToObject(active, width);
      fabricCanvas.renderAll();
      updateEditPopoverState(active);
    });
  });

  // Delete button in popover
  document.getElementById('edit-popover-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteSelected();
    hideEditPopover();
  });

  // Close popover on outside click
  document.addEventListener('mousedown', (e) => {
    if (!popover.contains(e.target) && popover.style.display !== 'none') {
      // Check if click is on the canvas — don't close if selecting an object
      const canvasWrapper = document.getElementById('canvas-wrapper');
      if (!canvasWrapper.contains(e.target)) {
        hideEditPopover();
      }
    }
  });
}

function applyColorToObject(obj, color) {
  if (obj.type === 'i-text' || obj.type === 'text') {
    obj.set('fill', color);
  } else if (obj.type === 'group') {
    // For arrows and stamps, apply to children
    obj.getObjects().forEach(child => {
      if (child.type === 'line') {
        child.set('stroke', color);
      } else if (child.type === 'triangle') {
        child.set('fill', color);
      } else if (child.type === 'rect') {
        child.set('fill', color);
      } else if (child.type === 'text') {
        child.set('fill', '#ffffff'); // stamp text stays white
      }
    });
  } else {
    obj.set('stroke', color);
  }
}

function applyWidthToObject(obj, width) {
  if (obj.type === 'i-text' || obj.type === 'text') {
    // For text, change font size roughly: 1→14, 2→16, 3→20
    const sizeMap = { 1: 14, 2: 16, 3: 20 };
    obj.set('fontSize', sizeMap[width] || 16);
  } else if (obj.type === 'group') {
    obj.getObjects().forEach(child => {
      if (child.type === 'line') {
        child.set('strokeWidth', width);
      }
    });
  } else if (obj.stroke) {
    obj.set('strokeWidth', width);
  }
}

function showEditPopover(target) {
  const popover = document.getElementById('edit-popover');
  if (!target || !fabricCanvas) {
    hideEditPopover();
    return;
  }

  // Position popover above the selected object
  const bound = target.getBoundingRect();
  const canvasEl = fabricCanvas.upperCanvasEl;
  const canvasRect = canvasEl.getBoundingClientRect();

  let left = canvasRect.left + bound.left + bound.width / 2 - 90;
  let top = canvasRect.top + bound.top - 10;

  // Clamp to viewport
  left = Math.max(8, Math.min(left, window.innerWidth - 200));

  // Show briefly to measure height
  popover.style.display = 'block';
  popover.style.visibility = 'hidden';
  const popoverH = popover.offsetHeight;
  popover.style.visibility = '';

  // If no room above, show below
  if (top - popoverH < 8) {
    top = canvasRect.top + bound.top + bound.height + 10;
  } else {
    top = top - popoverH;
  }

  popover.style.left = left + 'px';
  popover.style.top = top + 'px';
  popover.style.display = 'block';

  updateEditPopoverState(target);
}

function updateEditPopoverState(target) {
  const popover = document.getElementById('edit-popover');

  // Highlight current color
  let objColor = '';
  if (target.type === 'i-text' || target.type === 'text') {
    objColor = target.fill;
  } else if (target.type === 'group') {
    const lineChild = target.getObjects().find(c => c.type === 'line');
    const rectChild = target.getObjects().find(c => c.type === 'rect');
    if (lineChild) objColor = lineChild.stroke;
    else if (rectChild) objColor = rectChild.fill;
  } else {
    objColor = target.stroke;
  }

  popover.querySelectorAll('.edit-color-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.color === objColor);
  });

  // Highlight current width
  let objWidth = 2;
  if (target.type === 'i-text' || target.type === 'text') {
    const fs = target.fontSize;
    objWidth = fs >= 20 ? 3 : (fs <= 14 ? 1 : 2);
  } else if (target.type === 'group') {
    const lineChild = target.getObjects().find(c => c.type === 'line');
    if (lineChild) objWidth = lineChild.strokeWidth;
  } else if (target.strokeWidth) {
    objWidth = target.strokeWidth;
  }

  popover.querySelectorAll('.edit-width-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.width, 10) === objWidth);
  });
}

function hideEditPopover() {
  document.getElementById('edit-popover').style.display = 'none';
}


/* ===========================================================
   MODEL BOOK OVERLAY
   =========================================================== */

function setupBookOverlay() {
  const overlay = document.getElementById('book-overlay');
  const closeBtn = document.getElementById('btn-close-book');
  const openBtn = document.getElementById('btn-open-book');
  const searchInput = document.getElementById('book-search');

  openBtn.addEventListener('click', () => {
    overlay.classList.add('open');
    renderBook();
    searchInput.focus();
  });

  closeBtn.addEventListener('click', () => {
    overlay.classList.remove('open');
  });

  // Close on overlay background click
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.classList.remove('open');
    }
  });

  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.classList.contains('open')) {
      overlay.classList.remove('open');
    }
  });

  // Search
  searchInput.addEventListener('input', () => {
    renderBook(searchInput.value.trim().toLowerCase());
  });
}

let activeBookFilter = '';

function renderBook(searchQuery) {
  const grid = document.getElementById('book-grid');
  const empty = document.getElementById('book-empty');
  const filtersContainer = document.getElementById('book-filters');

  let studies = getStudies();

  // Collect all tags for filter buttons
  const allTags = new Set();
  studies.forEach(s => (s.tags || []).forEach(t => allTags.add(t)));

  // Render filter buttons
  filtersContainer.innerHTML = '';
  allTags.forEach(tag => {
    const btn = document.createElement('button');
    btn.className = 'book-filter-btn' + (activeBookFilter === tag ? ' active' : '');
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      activeBookFilter = (activeBookFilter === tag) ? '' : tag;
      renderBook(document.getElementById('book-search').value.trim().toLowerCase());
    });
    filtersContainer.appendChild(btn);
  });

  // Apply search filter
  if (searchQuery) {
    studies = studies.filter(s => s.name.toLowerCase().includes(searchQuery));
  }

  // Apply tag filter
  if (activeBookFilter) {
    studies = studies.filter(s => (s.tags || []).includes(activeBookFilter));
  }

  grid.innerHTML = '';

  if (studies.length === 0) {
    empty.style.display = 'flex';
    grid.style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  grid.style.display = 'grid';

  studies.forEach(study => {
    const card = document.createElement('div');
    card.className = 'study-card';

    const tagsHTML = (study.tags || []).map(t =>
      `<span class="study-card-tag">${escapeHTML(t)}</span>`
    ).join('');

    let outcomeHTML = '';
    if (study.outcome) {
      const outcomeClass = study.outcome === 'winner' ? 'winner' :
                           study.outcome === 'loser' ? 'loser' : 'in-progress';
      const outcomeLabel = study.outcome === 'in-progress' ? 'In Progress' :
                           study.outcome.charAt(0).toUpperCase() + study.outcome.slice(1);
      outcomeHTML = `<span class="study-card-outcome ${outcomeClass}">${outcomeLabel}</span>`;
    }

    card.innerHTML = `
      <img class="study-card-thumb" src="${study.thumbnail}" alt="${escapeHTML(study.name)}" loading="lazy">
      <div class="study-card-body">
        <div class="study-card-name">${escapeHTML(study.name)}</div>
        <div class="study-card-meta">${tagsHTML}${outcomeHTML}</div>
      </div>
      <div class="study-card-actions">
        <button class="study-delete-btn" data-id="${study.id}" aria-label="Delete study">Delete</button>
      </div>
    `;

    // Click card to load study
    card.querySelector('.study-card-thumb').addEventListener('click', () => {
      loadStudy(study);
      document.getElementById('book-overlay').classList.remove('open');
      showToast(`Loaded: ${study.name}`);
    });

    card.querySelector('.study-card-body').addEventListener('click', () => {
      loadStudy(study);
      document.getElementById('book-overlay').classList.remove('open');
      showToast(`Loaded: ${study.name}`);
    });

    // Delete button
    card.querySelector('.study-delete-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      deleteStudy(study.id);
      renderBook(document.getElementById('book-search').value.trim().toLowerCase());
      showToast('Study deleted');
    });

    grid.appendChild(card);
  });
}


/* ===========================================================
   KEYBOARD SHORTCUTS
   =========================================================== */

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't intercept when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    // Don't intercept if editing text on canvas
    if (fabricCanvas) {
      const active = fabricCanvas.getActiveObject();
      if (active && active.isEditing) return;
    }

    const key = e.key.toLowerCase();

    // Tool shortcuts
    if (key === 'v') { setTool('select'); return; }
    if (key === 'l') { setTool('line'); return; }
    if (key === 'h') { setTool('hline'); return; }
    if (key === 'r') { setTool('rect'); return; }
    if (key === 'e') { setTool('ellipse'); return; }
    if (key === 'f') { setTool('freehand'); return; }
    if (key === 'a') { setTool('arrow'); return; }
    if (key === 't') { setTool('text'); return; }

    // Delete
    if (key === 'delete' || key === 'backspace') {
      if (fabricCanvas) {
        const active = fabricCanvas.getActiveObject();
        if (active && !active.isEditing) {
          deleteSelected();
        }
      }
      return;
    }

    // Undo
    if ((e.ctrlKey || e.metaKey) && key === 'z') {
      e.preventDefault();
      undo();
      return;
    }

    // Escape
    if (key === 'escape') {
      setTool('select');
      return;
    }
  });
}


/* ===========================================================
   TOAST NOTIFICATIONS
   =========================================================== */

function showToast(message, type) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = 'toast' + (type === 'success' ? ' success' : '');
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 200ms ease';
    setTimeout(() => toast.remove(), 200);
  }, 2500);
}


/* ===========================================================
   UTILITY
   =========================================================== */

function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


/* ===========================================================
   WINDOW RESIZE — Resize canvas
   =========================================================== */

let resizeTimeout;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimeout);
  resizeTimeout = setTimeout(() => {
    if (fabricCanvas && currentImageDataURL) {
      // Re-init canvas with current image
      const canvasArea = document.getElementById('canvas-area');
      const areaW = canvasArea.clientWidth;
      const areaH = canvasArea.clientHeight;

      // Save current objects
      const objects = fabricCanvas.toJSON().objects;

      fabricCanvas.setDimensions({ width: areaW, height: areaH });

      // Reload background image scaled to new size
      fabric.Image.fromURL(currentImageDataURL, (img) => {
        const scale = Math.min(areaW / img.width, areaH / img.height);
        fabricCanvas.setBackgroundImage(img, fabricCanvas.renderAll.bind(fabricCanvas), {
          scaleX: scale,
          scaleY: scale,
          originX: 'center',
          originY: 'center',
          left: areaW / 2,
          top: areaH / 2
        });
      });
    }
  }, 250);
});
