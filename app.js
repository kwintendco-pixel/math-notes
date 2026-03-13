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

    // Pen Settings
    let penColor = 'var(--primary-color)';
    let penSize = 2;
    let currentPenPath = null;

    // Mouse & Touch Interaction
    let isPointerDown = false;
    let startPos = { x: 0, y: 0 };
    let currentPreview = null; 
    let lastPointerPos = { x: 0, y: 0 };
    let isDragging = false;
    let activeMathField = null;

    // --- DOM Elements ---
    const grid = document.getElementById('canvas-grid');
    const mathLayer = document.getElementById('math-layer');
    const drawingLayer = document.getElementById('drawing-layer');
    const marquee = document.getElementById('selection-marquee');
    const toolBtns = document.querySelectorAll('.tool-btn');
    const shapeBtns = document.querySelectorAll('.shape-btn');
    const workspaceContent = document.getElementById('workspace-content');

    // Initialize Icons
    lucide.createIcons();

    // Pen Controls UI Integration
    const shapeSidebar = document.querySelector('.shape-sidebar');
    const penControls = document.createElement('div');
    penControls.className = 'pen-controls';
    penControls.innerHTML = `
        <div class="sidebar-section">Pen Style</div>
        <input type="color" class="pen-color-picker" value="#4361ee" title="Pen Color">
        <input type="range" class="pen-size-slider" min="1" max="10" value="2" title="Pen Size">
    `;
    shapeSidebar.insertBefore(penControls, shapeSidebar.children[0]);
    document.querySelector('.pen-color-picker').addEventListener('input', (e) => penColor = e.target.value);
    document.querySelector('.pen-size-slider').addEventListener('input', (e) => penSize = e.target.value);

    // Image Upload
    const imageUpload = document.getElementById('image-upload');
    imageUpload.addEventListener('change', handleImageUpload);

    // --- Helper Functions ---

    function getPos(e) {
        const rect = grid.getBoundingClientRect();
        let cX = e.clientX, cY = e.clientY;
        if (e.touches && e.touches.length > 0) {
            cX = e.touches[0].clientX; cY = e.touches[0].clientY;
        } else if (e.changedTouches && e.changedTouches.length > 0) {
            cX = e.changedTouches[0].clientX; cY = e.changedTouches[0].clientY;
        }
        return {
            x: cX - rect.left,
            y: cY - rect.top
        };
    }

    function setActiveTool(id) {
        if (id === 'tool-image') {
            imageUpload.click();
            return; // keep current tool active
        }
        
        console.log(`Setting active tool: ${id}`);
        currentTool = id;
        document.body.setAttribute('data-tool', id);
        
        toolBtns.forEach(btn => btn.classList.toggle('active', btn.id === id));
        shapeBtns.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-shape') === id));
        
        if (id !== 'tool-select') clearSelectionLayer();
    }

    function initMarkers() {
        drawingLayer.querySelectorAll('defs').forEach(d => d.remove());
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        
        // Arrowheads
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        marker.setAttribute("id", "arrowhead");
        marker.setAttribute("markerWidth", "10"); marker.setAttribute("markerHeight", "7");
        marker.setAttribute("refX", "9"); marker.setAttribute("refY", "3.5");
        marker.setAttribute("orient", "auto");
        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        poly.setAttribute("points", "0 0, 10 3.5, 0 7");
        poly.setAttribute("fill", "var(--primary-color)");
        marker.appendChild(poly); defs.appendChild(marker);

        const markerStart = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        markerStart.setAttribute("id", "arrowhead-start");
        markerStart.setAttribute("markerWidth", "10"); markerStart.setAttribute("markerHeight", "7");
        markerStart.setAttribute("refX", "1"); markerStart.setAttribute("refY", "3.5");
        markerStart.setAttribute("orient", "auto-start-reverse");
        const polyStart = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        polyStart.setAttribute("points", "0 0, 10 3.5, 0 7");
        polyStart.setAttribute("fill", "var(--primary-color)");
        markerStart.appendChild(polyStart); defs.appendChild(markerStart);

        drawingLayer.appendChild(defs);
    }
    initMarkers();

    const MATH_SHORTCUTS = { "/": "\\frac{#0}{#0}", "*": "\\times", "inf": "\\infty", "->": "\\to", "<-": "\\gets", "<=": "\\le", ">=": "\\ge", "alpha": "\\alpha", "beta": "\\beta", "pi": "\\pi", "sqrt": "\\sqrt{#0}", "sum": "\\sum_{#0}^{#0}", "int": "\\int_{#0}^{#0}" };

    // --- Element Constructors ---

    function createMath(x, y, content = '', idOverride = null) {
        const id = idOverride || 'math-' + Math.random().toString(36).substr(2, 9);
        const sx = Math.round(x / GRID_SIZE) * GRID_SIZE;
        const sy = Math.round(y / GRID_SIZE) * GRID_SIZE;
        
        const block = document.createElement('div');
        block.className = 'math-block erasable';
        block.id = id;
        block.style.left = `${sx}px`;
        block.style.top = `${sy}px`;
        
        const mf = document.createElement('math-field');
        mf.value = content;
        mf.setOptions({ 
            smartFence: true, virtualKeyboardMode: 'manual',
            inlineShortcuts: { ...mf.getOption('inlineShortcuts'), ...MATH_SHORTCUTS }
        });
        
        block.appendChild(mf);
        mathLayer.appendChild(block);

        attachInteractionEvents(block, id);
        mf.addEventListener('focusin', () => activeMathField = mf);

        if (!idOverride) elements.push({ id, type: 'math', x: sx, y: sy, content });
        setTimeout(() => { mf.focus(); activeMathField = mf; }, 50);
        return block;
    }

    function createText(x, y, content = '', idOverride = null) {
        const id = idOverride || 'text-' + Math.random().toString(36).substr(2, 9);
        const sx = Math.round(x / GRID_SIZE) * GRID_SIZE;
        const sy = Math.round(y / GRID_SIZE) * GRID_SIZE;

        const block = document.createElement('div');
        block.className = 'text-block erasable';
        block.id = id;
        block.style.left = `${sx}px`;
        block.style.top = `${sy}px`;
        block.contentEditable = "true";
        block.dataset.placeholder = "Type text or type $$ for math...";
        
        if (content) block.innerHTML = content;

        mathLayer.appendChild(block);
        
        // Remove on blur if empty
        block.addEventListener('blur', () => {
            if (!block.textContent.trim() && !block.querySelector('math-field') && !block.querySelector('img')) {
                removeEl(id);
            }
            updateElementData(id); // Save current HTML
        });

        // Intercept $$ for inline math
        block.addEventListener('input', (e) => {
            const html = block.innerHTML;
            if (html.includes('$$')) {
                block.innerHTML = html.replace('$$', '<math-field></math-field>&nbsp;');
                const mfs = block.querySelectorAll('math-field');
                mfs.forEach(mf => {
                    mf.setOptions({ smartFence: true, inlineShortcuts: MATH_SHORTCUTS });
                });
                // Put focus in new math field
                if(mfs.length > 0) {
                    mfs[mfs.length-1].focus();
                }
            }
        });

        attachInteractionEvents(block, id, true);

        if (!idOverride) elements.push({ id, type: 'text', x: sx, y: sy, content });
        setTimeout(() => block.focus(), 50);
        return block;
    }

    function createImage(x, y, src, width = 200, height = null, idOverride = null) {
        const id = idOverride || 'img-' + Math.random().toString(36).substr(2, 9);
        
        const block = document.createElement('div');
        block.className = 'image-block erasable';
        block.id = id;
        block.style.left = `${x}px`;
        block.style.top = `${y}px`;
        block.style.width = `${width}px`;
        if (height) block.style.height = `${height}px`;
        
        const img = document.createElement('img');
        img.src = src;
        block.appendChild(img);

        const handle = document.createElement('div');
        handle.className = 'image-resize-handle br';
        block.appendChild(handle);

        mathLayer.appendChild(block);

        // Interaction
        attachInteractionEvents(block, id);

        // Resize interaction
        handle.addEventListener('mousedown', (e) => startResize(e, block, id));
        handle.addEventListener('touchstart', (e) => startResize(e, block, id), {passive: false});

        if (!idOverride) elements.push({ id, type: 'image', x, y, src, width, height });
        return block;
    }

    function startResize(e, block, id) {
        e.stopPropagation(); e.preventDefault();
        const startX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
        const startY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
        const startW = block.offsetWidth;
        const startH = block.offsetHeight;

        function moveFn(ev) {
            const evX = ev.clientX || (ev.touches ? ev.touches[0].clientX : 0);
            const evY = ev.clientY || (ev.touches ? ev.touches[0].clientY : 0);
            block.style.width = Math.max(50, startW + (evX - startX)) + 'px';
            block.style.height = Math.max(50, startH + (evY - startY)) + 'px';
        }

        function stopFn() {
            window.removeEventListener('mousemove', moveFn);
            window.removeEventListener('touchmove', moveFn);
            window.removeEventListener('mouseup', stopFn);
            window.removeEventListener('touchend', stopFn);
            
            const data = elements.find(ev => ev.id === id);
            if(data) {
                data.width = block.offsetWidth;
                data.height = block.offsetHeight;
            }
        }

        window.addEventListener('mousemove', moveFn);
        window.addEventListener('touchmove', moveFn, {passive: false});
        window.addEventListener('mouseup', stopFn);
        window.addEventListener('touchend', stopFn);
    }

    function createShape(type, x1, y1, x2, y2, idOverride = null) {
        const id = idOverride || 'shape-' + Math.random().toString(36).substr(2, 9);
        let shape;
        const sx1 = Math.round(x1 / GRID_SIZE) * GRID_SIZE;
        const sy1 = Math.round(y1 / GRID_SIZE) * GRID_SIZE;
        const sx2 = Math.round(x2 / GRID_SIZE) * GRID_SIZE;
        const sy2 = Math.round(y2 / GRID_SIZE) * GRID_SIZE;

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
                    shape.setAttribute("marker-end", "url(#arrowhead)"); shape.setAttribute("marker-start", "url(#arrowhead-start)"); 
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
            
            attachInteractionEvents(shape, id);
            if (!idOverride) elements.push({ id, type: 'shape', kind: type, x1: sx1, y1: sy1, x2: sx2, y2: sy2 });
        }
    }

    function createPenPath(pathData, color, width, idOverride = null) {
        const id = idOverride || 'pen-' + Math.random().toString(36).substr(2, 9);
        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.id = id;
        path.setAttribute('class', 'pen-path erasable');
        path.setAttribute('d', pathData);
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', width);
        drawingLayer.appendChild(path);
        
        attachInteractionEvents(path, id);
        if (!idOverride) elements.push({ id, type: 'pen', pathData, color, width });
        return { id, path };
    }

    // --- Interaction Attachments ---

    function attachInteractionEvents(el, id, isText = false) {
        const evHandler = (e) => {
            if (currentTool === 'tool-eraser') { 
                removeEl(id); 
                e.stopPropagation(); 
            } else if (currentTool === 'tool-select') {
                if (!e.shiftKey && !selectedElements.has(id)) clearSelectionLayer();
                selectEl(id);
                isPointerDown = true; isDragging = true;
                lastPointerPos = getPos(e);
                if (!isText) e.stopPropagation();
            }
        };
        el.addEventListener('mousedown', evHandler);
        el.addEventListener('touchstart', evHandler, {passive: false});
    }

    // --- Data Management ---

    function updateElementData(id) {
        const el = document.getElementById(id);
        const data = elements.find(ev => ev.id === id);
        if(!el || !data) return;
        
        if (data.type === 'math') {
            const mf = el.querySelector('math-field');
            if (mf) data.content = mf.value;
        } else if (data.type === 'text') {
            data.content = el.innerHTML;
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
        const el = document.getElementById(id); if (!el) return;
        selectedElements.add(id); 
        el.classList.add('selected');
        if (['path', 'rect', 'ellipse', 'polygon', 'line'].includes(el.tagName)) el.setAttribute('stroke', '#ff00ff');
    }

    function clearSelectionLayer() { 
        selectedElements.forEach(id => { 
            const el = document.getElementById(id); 
            if(el) {
                el.classList.remove('selected');
                if (['path', 'rect', 'ellipse', 'polygon', 'line'].includes(el.tagName)) {
                    const data = elements.find(ev => ev.id === id);
                    el.setAttribute('stroke', data && data.type === 'pen' ? data.color : 'var(--primary-color)');
                }
            }
        });
        selectedElements.clear(); 
    }

    function removeEl(id) {
        const el = document.getElementById(id); if (el) el.remove();
        elements = elements.filter(e => e.id !== id);
        selectedElements.delete(id);
    }

    // --- Core Mouse/Touch Dispatchers ---

    function handlePointerDown(e) {
        if (e.target.closest('.toolbar') || e.target.closest('.shape-sidebar') || e.target.closest('.menu-bar')) return;
        
        const p = getPos(e);
        isPointerDown = true;
        startPos = p; 
        lastPointerPos = p;

        if (currentTool === 'tool-math') {
            createMath(p.x, p.y);
            e.preventDefault();
        } else if (currentTool === 'tool-text') {
            createText(p.x, p.y);
            e.preventDefault();
        } else if (currentTool === 'tool-pen') {
            const res = createPenPath(`M ${p.x} ${p.y}`, penColor, penSize);
            currentPenPath = res.path;
            const data = elements.find(ev => ev.id === res.id);
            data.pathData = `M ${p.x} ${p.y}`; // start path trace
            e.preventDefault();
        } else if (currentTool === 'tool-select') {
            if (e.target === grid || e.target.id === 'workspace-content' || e.target.parentElement?.id === 'workspace-content') {
                clearSelectionLayer();
                marquee.classList.remove('hidden');
                marquee.style.width = '0'; marquee.style.height = '0';
            }
        }
    }

    function handlePointerMove(e) {
        if (!isPointerDown) return;
        const p = getPos(e);

        if (currentTool === 'tool-select') {
            if (isDragging) {
                const dx = Math.round((p.x - lastPointerPos.x) / GRID_SIZE) * GRID_SIZE;
                const dy = Math.round((p.y - lastPointerPos.y) / GRID_SIZE) * GRID_SIZE;
                
                // Allow free-drag for images and text for smoother experience
                const anySmooth = Array.from(selectedElements).some(id => {
                    const d = elements.find(ev => ev.id === id); return d && (d.type==='image' || d.type==='text' || d.type==='pen');
                });
                
                const stepX = anySmooth ? (p.x - lastPointerPos.x) : dx;
                const stepY = anySmooth ? (p.y - lastPointerPos.y) : dy;

                if (stepX !== 0 || stepY !== 0) {
                    selectedElements.forEach(id => {
                        const el = document.getElementById(id); 
                        const data = elements.find(ev => ev.id === id); 
                        if(!data) return;
                        
                        if (data.type === 'math' || data.type === 'text' || data.type === 'image') { 
                            data.x += stepX; data.y += stepY; 
                            el.style.left = `${data.x}px`; el.style.top = `${data.y}px`; 
                        } else if (data.type === 'pen') {
                            // Translate SVG Path manually
                            // Naive translate: parse points and shift (Complex). Simpler to use CSS transform, but we save path.
                            // Better solution for SVG Paths without complex math:
                            let raw = data.pathData;
                            data.pathData = shiftSVGPath(raw, stepX, stepY);
                            el.setAttribute('d', data.pathData);
                        } else {
                            data.x1 += stepX; data.y1 += stepY; data.x2 += stepX; data.y2 += stepY;
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
                    lastPointerPos.x += stepX; lastPointerPos.y += stepY;
                }
            } else if (!marquee.classList.contains('hidden')) {
                const x = Math.min(startPos.x, p.x); const y = Math.min(startPos.y, p.y);
                const w = Math.abs(p.x - startPos.x); const h = Math.abs(p.y - startPos.y);
                marquee.style.left = `${x}px`; marquee.style.top = `${y}px`; 
                marquee.style.width = `${w}px`; marquee.style.height = `${h}px`;
            }
        } else if (currentTool === 'tool-pen' && currentPenPath) {
            const data = elements.find(ev => ev.id === currentPenPath.id);
            if (data) {
                data.pathData += ` L ${p.x} ${p.y}`;
                currentPenPath.setAttribute('d', data.pathData);
            }
        } else if (!['tool-math', 'tool-text', 'tool-eraser', 'tool-image'].includes(currentTool)) {
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
    }

    function handlePointerUp(e) {
        if (!isPointerDown) return;
        const p = getPos(e);
        
        if (currentTool === 'tool-pen') {
            currentPenPath = null;
        } else if (!['tool-select', 'tool-math', 'tool-text', 'tool-eraser', 'tool-image'].includes(currentTool)) {
            if (currentPreview) { currentPreview.remove(); currentPreview = null; }
            if (Math.abs(p.x - startPos.x) > 5 || Math.abs(p.y - startPos.y) > 5) {
                const shapeType = currentTool.startsWith('tool-') ? currentTool.substring(5) : currentTool;
                createShape(shapeType, startPos.x, startPos.y, p.x, p.y);
            }
        }
        
        isPointerDown = false; 
        isDragging = false; 
        marquee.classList.add('hidden');
    }

    grid.addEventListener('mousedown', handlePointerDown);
    grid.addEventListener('touchstart', handlePointerDown, {passive: false});
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('touchmove', handlePointerMove, {passive: false});
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchend', handlePointerUp);

    // Path Shifter Helper
    function shiftSVGPath(d, dx, dy) {
        return d.replace(/([ML])\s*([\d.-]+)\s*([\d.-]+)/g, (match, cmd, x, y) => {
            return `${cmd} ${parseFloat(x) + dx} ${parseFloat(y) + dy}`;
        });
    }

    // --- Media & File Handling ---

    function handleImageUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            // Default center placement
            const rect = grid.getBoundingClientRect();
            const centerX = (window.innerWidth / 2) - rect.left - 100;
            const centerY = (window.innerHeight / 2) - rect.top - 100;
            
            createImage(centerX, centerY, event.target.result);
            setActiveTool('tool-select');
        };
        reader.readAsDataURL(file);
    }

    // Paste Images
    window.addEventListener('paste', (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let item of items) {
            if (item.type.indexOf('image') === 0) {
                const blob = item.getAsFile();
                const reader = new FileReader();
                reader.onload = (event) => {
                    createImage(startPos.x || 100, startPos.y || 100, event.target.result);
                };
                reader.readAsDataURL(blob);
            }
        }
    });

    // Control Wiring
    toolBtns.forEach(btn => btn.addEventListener('click', () => setActiveTool(btn.id)));
    shapeBtns.forEach(btn => btn.addEventListener('click', () => setActiveTool(btn.getAttribute('data-shape'))));

    // Menu Wiring
    document.getElementById('menu-new').onclick = () => { elements = []; mathLayer.innerHTML = ''; drawingLayer.innerHTML = ''; selectedElements.clear(); initMarkers(); };
    
    document.getElementById('menu-save').onclick = () => {
        elements.forEach(el => updateElementData(el.id));
        const blob = new Blob([JSON.stringify({ elements }, null, 2)], {type: 'application/json'});
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'notes.mnf'; a.click();
    };

    document.getElementById('menu-open').onclick = () => {
        const input = document.getElementById('mnf-upload');
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (ev) => {
                try {
                    const data = JSON.parse(ev.target.result);
                    document.getElementById('menu-new').click(); // clear
                    data.elements.forEach(d => {
                        if (d.type === 'math') createMath(d.x, d.y, d.content, d.id);
                        else if (d.type === 'text') createText(d.x, d.y, d.content, d.id);
                        else if (d.type === 'image') createImage(d.x, d.y, d.src, d.width, d.height, d.id);
                        else if (d.type === 'pen') createPenPath(d.pathData, d.color, d.width, d.id);
                        else if (d.type === 'shape') createShape(d.kind, d.x1, d.y1, d.x2, d.y2, d.id);
                    });
                } catch(err) { alert("Failed to open MNF file."); }
            };
            reader.readAsText(file);
        };
        input.click();
    };

    document.getElementById('menu-export').onclick = async () => {
        const jsPDF = window.jspdf.jsPDF;
        clearSelectionLayer();
        
        try {
            // Find bounds of all elements to know what to capture
            let maxX = window.innerWidth; let maxY = window.innerHeight;
            elements.forEach(e => {
                if(e.x) maxX = Math.max(maxX, e.x + (e.width || 300));
                if(e.x2) maxX = Math.max(maxX, e.x2);
                if(e.y) maxY = Math.max(maxY, e.y + (e.height || 300));
                if(e.y2) maxY = Math.max(maxY, e.y2);
            });
            maxX += 100; maxY += 100;
            
            alert("Exporting PDF. This might take a few seconds.");
            
            // Limit canvas size for performance
            const cWidth = Math.min(maxX, 3000);
            const cHeight = Math.min(maxY, 3000);
            
            const originalScrollX = window.scrollX;
            const originalScrollY = window.scrollY;
            window.scrollTo(0, 0);

            const canvas = await html2canvas(document.getElementById('editor-container'), {
                width: cWidth, height: cHeight, scale: 2, useCORS: true, logging: false
            });
            
            window.scrollTo(originalScrollX, originalScrollY);

            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            const pdf = new jsPDF({ orientation: cWidth > cHeight ? 'l' : 'p', unit: 'px', format: [cWidth, cHeight] });
            pdf.addImage(imgData, 'JPEG', 0, 0, cWidth, cHeight);
            pdf.save("MathNotes_Export.pdf");
            
        } catch(e) {
            alert("PDF Export failed. Try printing the page instead.");
            console.error(e);
        }
    };

    // Hotkeys
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'MATH-FIELD' || e.target.tagName === 'INPUT' || e.target.isContentEditable) return;
        if (e.key === 'Delete' || e.key === 'Backspace') { selectedElements.forEach(id => removeEl(id)); }
        if (e.key === 'v') setActiveTool('tool-select');
        if (e.key === 'm') setActiveTool('tool-math');
        if (e.key === 't') setActiveTool('tool-text');
        if (e.key === 'p') setActiveTool('tool-pen');
        if (e.key === 'e') setActiveTool('tool-eraser');
    });

    // Scanner Integration
    document.addEventListener('insertScanData', (e) => {
        const { x, y, text } = e.detail;
        console.log("Scanner received text:", text);
        
        // If the scanner thinks it's purely math, put in Math Block, else Text Block
        if (text.includes('\\') || text.includes('=')) {
            createMath(x, y, text);
        } else {
            createText(x, y, text);
        }
    });

    console.log('MathNotes: Initialization Complete');
});
