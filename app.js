/**
 * MathNotes Editor - Core Application Logic
 */

window.addEventListener('load', () => {
    console.log('MathNotes: Application Starting');

    // --- State Management ---
    let currentTool = 'tool-select';
    let elements = []; 
    let selectedElements = new Set();
    const GRID_SIZE = 20;

    // Mouse Interaction
    let isMouseDown = false;
    let startPos = { x: 0, y: 0 };
    let currentPreview = null; 
    let lastMousePos = { x: 0, y: 0 };
    let isDragging = false;
    let activeMathField = null;

    // --- DOM Elements ---
    const grid = document.getElementById('canvas-grid');
    const mathLayer = document.getElementById('math-layer');
    const drawingLayer = document.getElementById('drawing-layer');
    const marquee = document.getElementById('selection-marquee');
    const toolBtns = document.querySelectorAll('.tool-btn');
    const shapeBtns = document.querySelectorAll('.shape-btn');

    // Initialize Icons
    lucide.createIcons();

    // --- Helper Functions ---

    function getPos(e) {
        const rect = grid.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        };
    }

    function setActiveTool(id) {
        console.log(`Setting active tool: ${id}`);
        currentTool = id;
        document.body.setAttribute('data-tool', id);
        
        
        // Update UI
        toolBtns.forEach(btn => btn.classList.toggle('active', btn.id === id));
        shapeBtns.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-shape') === id));
        
        if (id !== 'tool-select') clearSelectionLayer();
    }

    function initMarkers() {
        drawingLayer.querySelectorAll('defs').forEach(d => d.remove());
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        
        // Normal Arrowhead
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        marker.setAttribute("id", "arrowhead");
        marker.setAttribute("markerWidth", "10");
        marker.setAttribute("markerHeight", "7");
        marker.setAttribute("refX", "9");
        marker.setAttribute("refY", "3.5");
        marker.setAttribute("orient", "auto");
        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        poly.setAttribute("points", "0 0, 10 3.5, 0 7");
        poly.setAttribute("fill", "var(--primary-color)");
        marker.appendChild(poly);
        defs.appendChild(marker);

        // Double Arrowhead
        const markerStart = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        markerStart.setAttribute("id", "arrowhead-start");
        markerStart.setAttribute("markerWidth", "10");
        markerStart.setAttribute("markerHeight", "7");
        markerStart.setAttribute("refX", "1");
        markerStart.setAttribute("refY", "3.5");
        markerStart.setAttribute("orient", "auto-start-reverse");
        const polyStart = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        polyStart.setAttribute("points", "0 0, 10 3.5, 0 7");
        polyStart.setAttribute("fill", "var(--primary-color)");
        markerStart.appendChild(polyStart);
        defs.appendChild(markerStart);

        drawingLayer.appendChild(defs);
    }
    initMarkers();

    const MATH_SHORTCUTS = { "/": "\\frac{#0}{#0}", "*": "\\times", "inf": "\\infty", "oo": "\\infty", "->": "\\to", "<-": "\\gets", "<->": "\\leftrightarrow", "<=": "\\le", ">=": "\\ge", "!=": "\\ne", "+-": "\\pm", "alpha": "\\alpha", "beta": "\\beta", "gamma": "\\gamma", "delta": "\\delta", "epsilon": "\\epsilon", "theta": "\\theta", "lambda": "\\lambda", "mu": "\\mu", "pi": "\\pi", "sigma": "\\sigma", "tau": "\\tau", "phi": "\\phi", "psi": "\\psi", "omega": "\\omega", "sin": "\\sin(#0)", "cos": "\\cos(#0)", "tan": "\\tan(#0)", "sqrt": "\\sqrt{#0}", "sq": "\\sqrt{#0}", "sq3": "\\sqrt[3]{#0}", "root": "\\sqrt[#0]{#0}", "sum": "\\sum_{#0}^{#0}", "prod": "\\prod_{#0}^{#0}", "int": "\\int_{#0}^{#0}", "iint": "\\iint_{#0}^{#0}", "iiint": "\\iiint_{#0}^{#0}", "lim": "\\lim_{#0 \\to #0}", "log": "\\log_{#0}(#0)", "ln": "\\ln(#0)", "vec": "\\vec{#0}", "dot": "\\cdot" };

    // --- Element Constructors ---

    function createMath(x, y, content = '') {
        const id = 'math-' + Math.random().toString(36).substr(2, 9);
        const sx = Math.round(x / GRID_SIZE) * GRID_SIZE;
        const sy = Math.round(y / GRID_SIZE) * GRID_SIZE;
        
        console.log(`Creating MathBlock: ${id} at (${sx}, ${sy})`);
        
        const block = document.createElement('div');
        block.className = 'math-block erasable';
        block.id = id;
        block.style.left = `${sx}px`;
        block.style.top = `${sy}px`;
        
        const mf = document.createElement('math-field');
        mf.value = content;
        
        // Use setOptions correctly for MathLive 0.109+
        mf.setOptions({ 
            smartFence: true, 
            virtualKeyboardMode: 'manual',
            inlineShortcuts: { ...mf.getOption('inlineShortcuts'), ...MATH_SHORTCUTS }
        });
        
        block.appendChild(mf);
        mathLayer.appendChild(block);

        block.addEventListener('mousedown', (e) => {
            if (currentTool === 'tool-eraser') {
                removeEl(id);
                e.stopPropagation();
            } else if (currentTool === 'tool-select') {
                if (!e.shiftKey && !selectedElements.has(id)) clearSelectionLayer();
                selectEl(id);
                isMouseDown = true; isDragging = true;
                lastMousePos = getPos(e);
                e.stopPropagation();
            }
        });

        mf.addEventListener('focusin', () => { 
            activeMathField = mf; 
        });

        elements.push({ id, type: 'math', x: sx, y: sy, content });
        
        // Ensure immediate focus to prevent hotkeys intercepting typing
        setTimeout(() => {
            mf.focus();
            activeMathField = mf;
        }, 50);
        
        return block;
    }

    function createShape(type, x1, y1, x2, y2) {
        const id = 'shape-' + Math.random().toString(36).substr(2, 9);
        let shape;
        const sx1 = Math.round(x1 / GRID_SIZE) * GRID_SIZE;
        const sy1 = Math.round(y1 / GRID_SIZE) * GRID_SIZE;
        const sx2 = Math.round(x2 / GRID_SIZE) * GRID_SIZE;
        const sy2 = Math.round(y2 / GRID_SIZE) * GRID_SIZE;

        console.log(`Creating Shape: ${id} (${type}) from (${sx1}, ${sy1}) to (${sx2}, ${sy2})`);

        switch (type) {
            case 'rect': case 'square': 
                shape = document.createElementNS("http://www.w3.org/2000/svg", "rect"); 
                updateRect(shape, sx1, sy1, sx2, sy2, type === 'square'); 
                break;
            case 'circle': case 'ellipse': 
                shape = document.createElementNS("http://www.w3.org/2000/svg", "ellipse"); 
                updateEllipse(shape, sx1, sy1, sx2, sy2, type === 'circle'); 
                break;
            case 'triangle': 
                shape = document.createElementNS("http://www.w3.org/2000/svg", "polygon"); 
                updateTri(shape, sx1, sy1, sx2, sy2); 
                break;
            default: 
                shape = document.createElementNS("http://www.w3.org/2000/svg", "line"); 
                shape.setAttribute('x1', sx1); shape.setAttribute('y1', sy1); 
                shape.setAttribute('x2', sx2); shape.setAttribute('y2', sy2);
                if (['arrow', 'right-arrow-heavy', 'connector'].includes(type)) {
                    shape.setAttribute("marker-end", "url(#arrowhead)");
                    if (type === 'right-arrow-heavy') shape.setAttribute("stroke-width", "4");
                }
                if (type === 'double-arrow') { 
                    shape.setAttribute("marker-end", "url(#arrowhead)"); 
                    shape.setAttribute("marker-start", "url(#arrowhead-start)"); 
                }
                if (type === 'dash-line') shape.setAttribute("stroke-dasharray", "5,5");
        }

        if (shape) {
            shape.id = id;
            shape.setAttribute('class', 'selectable-shape erasable');
            shape.setAttribute('stroke', 'var(--primary-color)');
            shape.setAttribute('stroke-width', shape.getAttribute('stroke-width') || '2');
            shape.setAttribute('fill', 'transparent'); 
            drawingLayer.appendChild(shape);
            
            shape.addEventListener('mousedown', (e) => {
                if (currentTool === 'tool-eraser') { 
                    removeEl(id); 
                    e.stopPropagation(); 
                } else if (currentTool === 'tool-select') {
                    if (!e.shiftKey && !selectedElements.has(id)) clearSelectionLayer();
                    selectEl(id);
                    isMouseDown = true; isDragging = true;
                    lastMousePos = getPos(e);
                    e.stopPropagation();
                }
            });

            elements.push({ id, type: 'shape', kind: type, x1: sx1, y1: sy1, x2: sx2, y2: sy2 });
        }
    }

    function updateRect(r, x1, y1, x2, y2, isSq = false) {
        let w = x2 - x1; let h = y2 - y1;
        if (isSq) { const s = Math.max(Math.abs(w), Math.abs(h)); w = w >= 0 ? s : -s; h = h >= 0 ? s : -s; }
        r.setAttribute('x', w >= 0 ? x1 : x1 + w); r.setAttribute('y', h >= 0 ? y1 : y1 + h);
        r.setAttribute('width', Math.max(1, Math.abs(w))); r.setAttribute('height', Math.max(1, Math.abs(h)));
    }

    function updateEllipse(e, x1, y1, x2, y2, isCr = false) {
        let rx = Math.abs(x2 - x1) / 2; let ry = Math.abs(y2 - y1) / 2; if (isCr) rx = ry = Math.max(rx, ry);
        e.setAttribute('cx', x1 + (x2 - x1) / 2); e.setAttribute('cy', y1 + (y2 - y1) / 2);
        e.setAttribute('rx', Math.max(1, rx)); e.setAttribute('ry', Math.max(1, ry));
    }

    function updateTri(t, x1, y1, x2, y2) { 
        t.setAttribute('points', `${x1 + (x2 - x1)/2},${y1} ${x1},${y2} ${x2},${y2}`); 
    }

    function selectEl(id) {
        const el = document.getElementById(id); 
        if (!el) return;
        selectedElements.add(id); 
        el.classList.add('selected');
        if (el.tagName !== 'DIV') el.setAttribute('stroke', '#ff00ff');
    }

    function clearSelectionLayer() { 
        selectedElements.forEach(id => { 
            const el = document.getElementById(id); 
            if(el) {
                el.classList.remove('selected');
                if (el.tagName !== 'DIV') el.setAttribute('stroke', 'var(--primary-color)');
            }
        });
        selectedElements.clear(); 
    }

    function removeEl(id) {
        const el = document.getElementById(id); 
        if (el) el.remove();
        elements = elements.filter(e => e.id !== id);
        selectedElements.delete(id);
    }

    // --- Core Interaction Model ---

    grid.addEventListener('mousedown', (e) => {
        const p = getPos(e);
        console.log(`Grid mousedown: p=(${p.x},${p.y}), tool=${currentTool}, target=${e.target.id}`);
        
        isMouseDown = true;
        startPos = p; 
        lastMousePos = p;

        if (currentTool === 'tool-math') {
            createMath(p.x, p.y);
        } else if (currentTool === 'tool-select') {
            if (e.target === grid || e.target.id === 'workspace-content' || e.target.parentElement?.id === 'workspace-content') {
                clearSelectionLayer();
                marquee.classList.remove('hidden');
                marquee.style.width = '0';
                marquee.style.height = '0';
            }
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!isMouseDown) return;
        const p = getPos(e);

        if (currentTool === 'tool-select') {
            if (isDragging) {
                const dx = Math.round((p.x - lastMousePos.x) / GRID_SIZE) * GRID_SIZE;
                const dy = Math.round((p.y - lastMousePos.y) / GRID_SIZE) * GRID_SIZE;
                if (dx !== 0 || dy !== 0) {
                    selectedElements.forEach(id => {
                        const el = document.getElementById(id); 
                        const data = elements.find(ev => ev.id === id); 
                        if(!data) return;
                        if (data.type === 'math') { 
                            data.x += dx; data.y += dy; 
                            el.style.left = `${data.x}px`; el.style.top = `${data.y}px`; 
                        } else {
                            data.x1 += dx; data.y1 += dy; data.x2 += dx; data.y2 += dy;
                            if (el.tagName === 'line') { 
                                el.setAttribute('x1', data.x1); el.setAttribute('y1', data.y1); 
                                el.setAttribute('x2', data.x2); el.setAttribute('y2', data.y2); 
                            } else if (el.tagName === 'rect') {
                                updateRect(el, data.x1, data.y1, data.x2, data.y2, data.kind === 'square');
                            } else if (el.tagName === 'ellipse') {
                                updateEllipse(el, data.x1, data.y1, data.x2, data.y2, data.kind === 'circle');
                            } else if (el.tagName === 'polygon') {
                                updateTri(el, data.x1, data.y1, data.x2, data.y2);
                            }
                        }
                    });
                    lastMousePos.x += dx; lastMousePos.y += dy;
                }
            } else if (!marquee.classList.contains('hidden')) {
                const x = Math.min(startPos.x, p.x); 
                const y = Math.min(startPos.y, p.y);
                const w = Math.abs(p.x - startPos.x); 
                const h = Math.abs(p.y - startPos.y);
                marquee.style.left = `${x}px`; marquee.style.top = `${y}px`; 
                marquee.style.width = `${w}px`; marquee.style.height = `${h}px`;
            }
        } else if (!['tool-math', 'tool-eraser'].includes(currentTool)) {
            // Shape Preview
            const shapeType = currentTool.startsWith('tool-') ? currentTool.substring(5) : currentTool;
            if (!currentPreview) {
                const tag = ['circle', 'ellipse'].includes(shapeType) ? 'ellipse' : (shapeType === 'triangle' ? 'polygon' : (['rect', 'square'].includes(shapeType) ? 'rect' : 'line'));
                currentPreview = document.createElementNS("http://www.w3.org/2000/svg", tag);
                currentPreview.setAttribute('stroke', 'var(--primary-color)'); 
                currentPreview.setAttribute('stroke-dasharray', '4'); 
                currentPreview.setAttribute('fill', 'none');
                drawingLayer.appendChild(currentPreview);
            }
            if (currentPreview.tagName === 'line') { 
                currentPreview.setAttribute('x1', startPos.x); currentPreview.setAttribute('y1', startPos.y); 
                currentPreview.setAttribute('x2', p.x); currentPreview.setAttribute('y2', p.y); 
            } else if (currentPreview.tagName === 'rect') {
                updateRect(currentPreview, startPos.x, startPos.y, p.x, p.y, shapeType === 'square');
            } else if (currentPreview.tagName === 'ellipse') {
                updateEllipse(currentPreview, startPos.x, startPos.y, p.x, p.y, shapeType === 'circle');
            } else if (currentPreview.tagName === 'polygon') {
                updateTri(currentPreview, startPos.x, startPos.y, p.x, p.y);
            }
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (!isMouseDown) return;
        const p = getPos(e);
        
        console.log(`Global mouseup at (${p.x}, ${p.y}) tool=${currentTool}`);

        if (!['tool-select', 'tool-math', 'tool-eraser'].includes(currentTool)) {
            if (currentPreview) { 
                currentPreview.remove(); 
                currentPreview = null; 
            }
            if (Math.abs(p.x - startPos.x) > 5 || Math.abs(p.y - startPos.y) > 5) {
                const shapeType = currentTool.startsWith('tool-') ? currentTool.substring(5) : currentTool;
                createShape(shapeType, startPos.x, startPos.y, p.x, p.y);
            }
        }
        
        isMouseDown = false; 
        isDragging = false; 
        marquee.classList.add('hidden');
    });

    // Control Wiring
    toolBtns.forEach(btn => btn.addEventListener('click', () => setActiveTool(btn.id)));
    shapeBtns.forEach(btn => btn.addEventListener('click', () => setActiveTool(btn.getAttribute('data-shape'))));

    // Menu Wiring - USE CUSTOM MODALS OR NON-BLOCKING ALERTS
    document.getElementById('menu-new').onclick = () => { elements = []; mathLayer.innerHTML = ''; drawingLayer.innerHTML = ''; selectedElements.clear(); initMarkers(); };
    document.getElementById('menu-save').onclick = () => {
        elements.forEach(el => {
            if (el.type === 'math') {
                const div = document.getElementById(el.id);
                if (div) {
                    const mf = div.querySelector('math-field');
                    if (mf) el.content = mf.value;
                }
            }
        });
        const blob = new Blob([JSON.stringify({ elements }, null, 2)], {type: 'application/json'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'notes.mnf'; a.click();
    };
    document.getElementById('menu-export').onclick = () => window.print();

    // Hotkeys
    window.addEventListener('keydown', (e) => {
        // Fix: Do not trigger tool hotkeys if typing in ANY input or math field
        if (e.target.tagName === 'MATH-FIELD' || e.target.tagName === 'INPUT') return;
        if (e.key === 'Delete' || e.key === 'Backspace') { selectedElements.forEach(id => removeEl(id)); }
        if (e.key === 'v') setActiveTool('tool-select');
        if (e.key === 'm') setActiveTool('tool-math');
        if (e.key === 'e') setActiveTool('tool-eraser');
    });

    // Scanner Integration
    document.addEventListener('insertScanData', (e) => {
        const { x, y, text } = e.detail;
        console.log("Scanner received text:", text);
        createMath(x, y, text);
    });

    console.log('MathNotes: Initialization Complete');
});
