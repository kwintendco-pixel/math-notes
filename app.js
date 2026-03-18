/**
 * MathNotes — Smart Student Notebook
 * Dual-mode: Notes (rich text) + Math (canvas workspace)
 */
// Safe Tauri checks for browser compatibility
const tauriApp = window.__TAURI__;
const invoke = tauriApp ? tauriApp.core.invoke : null;
const dialog = tauriApp ? tauriApp.plugin.dialog : null;
const fs = tauriApp ? tauriApp.plugin.fs : null;

import { saveToCloud, loadFromCloud, getUserNotebooks, deleteFromCloud, logOut, signIn, currentUser } from './firebase-auth.js';

window.addEventListener('load', () => {
    console.log('MathNotes: Starting...');
    lucide.createIcons();

    // === STATE ===
    let currentMode = 'notes'; // 'notes' | 'math'
    let currentTool = 'tool-select';
    let elements = [];
    let selectedElements = new Set();
    const GRID_SIZE = 20;
    let penColor = '#4361ee', penSize = 2;
    let currentPenPath = null;
    let isPointerDown = false, startPos = {x:0,y:0}, lastPointerPos = {x:0,y:0};
    let isDragging = false, currentPreview = null, activeMathField = null;

    // === DOM ===
    const notesEditor = document.getElementById('notes-editor');
    const mathWorkspace = document.getElementById('math-workspace');
    const formatBar = document.getElementById('format-bar');
    const mathToolbar = document.getElementById('math-toolbar');
    const editorPage = document.getElementById('editor-page');
    const grid = document.getElementById('canvas-grid');
    const mathLayer = document.getElementById('math-layer');
    const drawingLayer = document.getElementById('drawing-layer');
    const marquee = document.getElementById('selection-marquee');
    const toolBtns = document.querySelectorAll('.tool-btn');
    const shapeBtns = document.querySelectorAll('.shape-btn');

    // === MODE TOGGLE ===
    const modeBtns = document.querySelectorAll('.mode-btn');
    modeBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            if (mode === currentMode) return;
            currentMode = mode;
            document.body.setAttribute('data-mode', mode);
            modeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));

            if (mode === 'notes') {
                notesEditor.classList.remove('hidden');
                mathWorkspace.classList.add('hidden');
                formatBar.classList.remove('hidden');
                mathToolbar.classList.add('hidden');
            } else {
                notesEditor.classList.add('hidden');
                mathWorkspace.classList.remove('hidden');
                formatBar.classList.add('hidden');
                mathToolbar.classList.remove('hidden');
            }
        });
    });

    // === RICH TEXT FORMATTING ===
    document.querySelectorAll('.fmt-btn[data-cmd]').forEach(btn => {
        btn.addEventListener('click', () => {
            document.execCommand(btn.dataset.cmd, false, null);
            editorPage.focus();
        });
    });

    document.getElementById('fmt-heading').addEventListener('change', (e) => {
        document.execCommand('formatBlock', false, e.target.value);
        editorPage.focus();
    });

    document.getElementById('fmt-fontsize').addEventListener('change', (e) => {
        document.execCommand('fontSize', false, e.target.value);
        editorPage.focus();
    });

    document.getElementById('fmt-color').addEventListener('input', (e) => {
        document.execCommand('foreColor', false, e.target.value);
    });

    document.getElementById('fmt-bg-color').addEventListener('input', (e) => {
        document.execCommand('hiliteColor', false, e.target.value);
    });

    document.getElementById('fmt-inline-math').addEventListener('click', () => {
        const sel = window.getSelection();
        if (!sel.rangeCount) return;
        const mf = document.createElement('math-field');
        mf.setOptions({ smartFence: true, virtualKeyboardMode: 'manual' });
        const range = sel.getRangeAt(0);
        range.collapse(false);
        range.insertNode(mf);
        range.setStartAfter(mf);
        sel.removeAllRanges();
        sel.addRange(range);
        setTimeout(() => mf.focus(), 50);
    });

    document.getElementById('fmt-checklist').addEventListener('click', () => {
        document.execCommand('insertHTML', false,
            '<div style="display:flex;align-items:flex-start;gap:8px;margin:4px 0"><input type="checkbox" style="margin-top:5px"><span>Task item</span></div>');
    });

    document.getElementById('fmt-table').addEventListener('click', () => {
        const html = `<table><thead><tr><th>Header 1</th><th>Header 2</th><th>Header 3</th></tr></thead><tbody><tr><td>Cell</td><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td><td>Cell</td></tr></tbody></table><p></p>`;
        document.execCommand('insertHTML', false, html);
    });

    document.getElementById('fmt-blockquote').addEventListener('click', () => {
        document.execCommand('formatBlock', false, 'blockquote');
    });

    document.getElementById('fmt-codeblock').addEventListener('click', () => {
        document.execCommand('insertHTML', false, '<pre>// code here</pre><p></p>');
    });

    document.getElementById('fmt-hr').addEventListener('click', () => {
        document.execCommand('insertHorizontalRule');
    });

    // Lined paper toggle
    document.getElementById('notes-lines-toggle').addEventListener('change', (e) => {
        document.body.setAttribute('data-notes-lines', e.target.checked ? 'on' : 'off');
    });

    // Image insert (inline)
    const notesImageUpload = document.getElementById('notes-image-upload');
    document.getElementById('fmt-image').addEventListener('click', () => notesImageUpload.click());
    notesImageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            document.execCommand('insertImage', false, ev.target.result);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    });

    // Reference image panel
    const refImageUpload = document.getElementById('ref-image-upload');
    let refTargetSide = 'right';
    document.getElementById('fmt-image-ref').addEventListener('click', () => {
        refTargetSide = 'right';
        refImageUpload.click();
    });
    refImageUpload.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            addRefImage(ev.target.result, refTargetSide);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    });

    function addRefImage(src, side) {
        const panel = document.getElementById(`ref-panel-${side}`);
        const container = document.getElementById(`ref-images-${side}`);
        panel.classList.remove('hidden');

        const wrap = document.createElement('div');
        wrap.className = 'ref-img-wrap';
        const img = document.createElement('img');
        img.src = src;
        img.style.width = '100%';
        img.style.display = 'block';

        // Annotation canvas overlay
        const annotCanvas = document.createElement('canvas');
        wrap.appendChild(img);
        wrap.appendChild(annotCanvas);

        img.onload = () => {
            annotCanvas.width = img.naturalWidth;
            annotCanvas.height = img.naturalHeight;
            const ctx = annotCanvas.getContext('2d');
            let drawing = false;
            annotCanvas.addEventListener('mousedown', (e) => {
                drawing = true;
                const rect = annotCanvas.getBoundingClientRect();
                const scaleX = annotCanvas.width / rect.width;
                const scaleY = annotCanvas.height / rect.height;
                ctx.beginPath();
                ctx.moveTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
                ctx.strokeStyle = '#f43f5e';
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
            });
            annotCanvas.addEventListener('mousemove', (e) => {
                if (!drawing) return;
                const rect = annotCanvas.getBoundingClientRect();
                const scaleX = annotCanvas.width / rect.width;
                const scaleY = annotCanvas.height / rect.height;
                ctx.lineTo((e.clientX - rect.left) * scaleX, (e.clientY - rect.top) * scaleY);
                ctx.stroke();
            });
            window.addEventListener('mouseup', () => drawing = false);
        };

        container.appendChild(wrap);
        lucide.createIcons();
    }

    document.getElementById('close-ref-left')?.addEventListener('click', () => document.getElementById('ref-panel-left').classList.add('hidden'));
    document.getElementById('close-ref-right')?.addEventListener('click', () => document.getElementById('ref-panel-right').classList.add('hidden'));

    // Inline $$ math in notes
    editorPage.addEventListener('input', () => {
        updateWordCount();
        const html = editorPage.innerHTML;
        if (html.includes('$$')) {
            // Use selection to replace $$ with a math-field
            const walker = document.createTreeWalker(editorPage, NodeFilter.SHOW_TEXT, null, false);
            let node;
            while (node = walker.nextNode()) {
                const idx = node.textContent.indexOf('$$');
                if (idx !== -1) {
                    const before = node.textContent.substring(0, idx);
                    const after = node.textContent.substring(idx + 2);
                    const mf = document.createElement('math-field');
                    mf.setOptions({ smartFence: true, virtualKeyboardMode: 'manual' });
                    const parent = node.parentNode;
                    if (before) parent.insertBefore(document.createTextNode(before), node);
                    parent.insertBefore(mf, node);
                    if (after) parent.insertBefore(document.createTextNode(after), node);
                    parent.removeChild(node);
                    setTimeout(() => mf.focus(), 50);
                    break;
                }
            }
        }
    });
    // Delete selected inline math fields in notes
    editorPage.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' || e.key === 'Delete') {
            const sel = window.getSelection();
            if (!sel.isCollapsed) return; // let default selection deletion handle it
            
            // If collapsed, check if the cursor is just after a math-field
            const range = sel.getRangeAt(0);
            if (e.key === 'Backspace') {
                if (range.startContainer.nodeType === 3 && range.startOffset === 0) {
                    const prev = range.startContainer.previousSibling;
                    if (prev && prev.nodeName === 'MATH-FIELD') { e.preventDefault(); prev.remove(); return; }
                }
                if (range.startContainer.nodeType === 1 && range.startOffset > 0) {
                    const prevNode = range.startContainer.childNodes[range.startOffset - 1];
                    if (prevNode && prevNode.nodeName === 'MATH-FIELD') { e.preventDefault(); prevNode.remove(); return; }
                }
            } else if (e.key === 'Delete') {
                if (range.startContainer.nodeType === 3 && range.startOffset === range.startContainer.textContent.length) {
                    const next = range.startContainer.nextSibling;
                    if (next && next.nodeName === 'MATH-FIELD') { e.preventDefault(); next.remove(); return; }
                }
                if (range.startContainer.nodeType === 1 && range.startOffset < range.startContainer.childNodes.length) {
                    const nextNode = range.startContainer.childNodes[range.startOffset];
                    if (nextNode && nextNode.nodeName === 'MATH-FIELD') { e.preventDefault(); nextNode.remove(); return; }
                }
            }
            
            // If the focus itself is ON the math-field
            if (e.target && e.target.nodeName === 'MATH-FIELD') {
                if (e.target.value === '') {
                    e.preventDefault();
                    e.target.remove();
                    editorPage.focus();
                }
            }
        }
    });

    // Paste images (screenshots) into notes editor
    editorPage.addEventListener('paste', (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let index in items) {
            const item = items[index];
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                const reader = new FileReader();
                reader.onload = (ev) => {
                    document.execCommand('insertImage', false, ev.target.result);
                };
                reader.readAsDataURL(file);
                break; // Just handle the first image
            }
        }
    });
    // Drag & Drop images into notes editor
    editorPage.addEventListener('dragover', (e) => { e.preventDefault(); });
    editorPage.addEventListener('drop', (e) => {
        e.preventDefault();
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const img = document.createElement('img');
                    img.src = ev.target.result;
                    img.style.maxWidth = '100%';
                    img.style.borderRadius = '8px';
                    const sel = window.getSelection();
                    if (sel.rangeCount) {
                        const range = sel.getRangeAt(0);
                        range.insertNode(img);
                    } else {
                        editorPage.appendChild(img);
                    }
                };
                reader.readAsDataURL(file);
            }
        }
    });

    // Global Paste (Math Mode)
    document.addEventListener('paste', (e) => {
        if (currentMode !== 'math') return;
        if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'MATH-FIELD' || document.activeElement.isContentEditable)) return;
        
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        for (let index in items) {
            const item = items[index];
            if (item.kind === 'file' && item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                const reader = new FileReader();
                reader.onload = (ev) => {
                    const rect = grid.getBoundingClientRect();
                    const cx = (window.innerWidth/2) - rect.left - 100;
                    const cy = (window.innerHeight/2) - rect.top - 100;
                    createImage(cx, cy, ev.target.result);
                };
                reader.readAsDataURL(file);
                break;
            }
        }
    });

    // === WORD COUNT ===
    function updateWordCount() {
        const text = editorPage.innerText || '';
        const words = text.trim() ? text.trim().split(/\s+/).length : 0;
        const chars = text.length;
        document.getElementById('word-count').textContent = `${words} words`;
        document.getElementById('char-count').textContent = `${chars} chars`;
    }
    updateWordCount();

    // === POMODORO TIMER ===
    let pomodoroTime = 25 * 60; // 25 min
    let pomodoroRunning = false;
    let pomodoroInterval = null;
    const pomodoroBtn = document.getElementById('pomodoro-btn');
    const pomodoroDisplay = document.getElementById('pomodoro-display');

    pomodoroBtn.addEventListener('click', () => {
        if (pomodoroRunning) {
            clearInterval(pomodoroInterval);
            pomodoroRunning = false;
            pomodoroBtn.classList.remove('active');
        } else {
            pomodoroRunning = true;
            pomodoroBtn.classList.add('active');
            pomodoroInterval = setInterval(() => {
                pomodoroTime--;
                if (pomodoroTime <= 0) {
                    clearInterval(pomodoroInterval);
                    pomodoroRunning = false;
                    pomodoroBtn.classList.remove('active');
                    pomodoroTime = 25 * 60;
                    alert('⏰ Pomodoro complete! Take a 5-minute break.');
                }
                const m = Math.floor(pomodoroTime / 60);
                const s = pomodoroTime % 60;
                pomodoroDisplay.textContent = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
            }, 1000);
        }
    });

    // === FOCUS MODE ===
    document.getElementById('focus-mode-btn').addEventListener('click', (e) => {
        document.body.classList.toggle('focus-mode');
        e.target.closest('.status-btn').classList.toggle('active');
    });

    // === TEMPLATES SYSTEM ===
    const templatesModal = document.getElementById('templates-modal');
    document.getElementById('btn-templates').addEventListener('click', () => templatesModal.classList.remove('hidden'));
    document.getElementById('close-templates').addEventListener('click', () => templatesModal.classList.add('hidden'));

    const templatesArea = {
        'math': `<h2>Math Problem</h2><p><strong>Problem Statement:</strong></p><p><br></p><p><strong>Solution:</strong></p><p><br></p><hr>`,
        'study': `<h2>Study Summary: [Topic]</h2><ul><li><strong>Key Concept 1:</strong> </li><li><strong>Key Concept 2:</strong> </li><li><strong>Formula to Remember:</strong> </li></ul><hr>`,
        'diagram': `<h2>Diagram Analysis</h2><div style="padding:40px; border:2px dashed var(--border-color); border-radius:8px; text-align:center; margin: 15px 0;"><p class="text-muted"><em>Draw or insert your diagram here</em></p></div><hr>`,
        'exercise': `<h2>Exercise Solutions</h2><h4>Exercise 1</h4><p>Answer: </p><br><h4>Exercise 2</h4><p>Answer: </p><hr>`
    };

    document.querySelectorAll('.template-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const templateKey = btn.getAttribute('data-template');
            if (templatesArea[templateKey]) {
                const html = templatesArea[templateKey] + '<p></p>';
                if (currentMode === 'notes') {
                    // Insert at cursor
                    editorPage.focus();
                    document.execCommand('insertHTML', false, html);
                    templatesModal.classList.add('hidden');
                    saveStateToAutosave();
                } else {
                    alert('Templates can only be inserted in Notes mode.');
                }
            }
        });
    });

    // === FAVORITE FORMULAS ===
    const formulasModal = document.getElementById('formulas-modal');
    const formulasListEl = document.getElementById('formulas-list');
    let favoriteFormulas = JSON.parse(localStorage.getItem('mathNotesFormulas') || '[]');

    function renderFormulas() {
        formulasListEl.innerHTML = '';
        if (favoriteFormulas.length === 0) {
            formulasListEl.innerHTML = '<p class="text-muted" style="text-align:center; padding: 20px 0;">No saved formulas yet.</p>';
            return;
        }
        favoriteFormulas.forEach((form, index) => {
            const item = document.createElement('div');
            item.className = 'formula-item';
            item.innerHTML = `
                <div class="formula-content">
                    <strong>${form.name}</strong>
                    <span class="latex-preview">${form.latex}</span>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button class="icon-btn delete-formula" data-index="${index}" title="Remove"><i data-lucide="trash-2" style="width: 16px; height: 16px; color: #ef4444;"></i></button>
                    <button class="formula-action-btn insert-formula" data-index="${index}">Insert</button>
                </div>
            `;
            formulasListEl.appendChild(item);
        });
        lucide.createIcons();
        
        document.querySelectorAll('.delete-formula').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = e.currentTarget.getAttribute('data-index');
                favoriteFormulas.splice(idx, 1);
                localStorage.setItem('mathNotesFormulas', JSON.stringify(favoriteFormulas));
                renderFormulas();
            });
        });

        document.querySelectorAll('.insert-formula').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const idx = e.currentTarget.getAttribute('data-index');
                const formula = favoriteFormulas[idx];
                insertFormulaIntoNote(formula.latex);
                formulasModal.classList.add('hidden');
            });
        });
    }

    function insertFormulaIntoNote(latex) {
        if (currentMode === 'notes') {
            const mf = document.createElement('math-field');
            mf.setOptions({ smartFence: true, virtualKeyboardMode: 'manual' });
            mf.value = latex;
            const sel = window.getSelection();
            if (sel.rangeCount) {
                const range = sel.getRangeAt(0);
                range.collapse(false);
                range.insertNode(mf);
                range.setStartAfter(mf);
                sel.removeAllRanges();
                sel.addRange(range);
            } else {
                editorPage.appendChild(mf);
            }
        } else {
            createMath(window.innerWidth / 2, window.innerHeight / 2, latex);
        }
    }

    document.getElementById('btn-formulas').addEventListener('click', () => {
        renderFormulas();
        formulasModal.classList.remove('hidden');
    });
    document.getElementById('close-formulas').addEventListener('click', () => formulasModal.classList.add('hidden'));

    document.getElementById('btn-add-formula').addEventListener('click', () => {
        const nameInput = document.getElementById('new-formula-name');
        const latexInput = document.getElementById('new-formula-latex');
        if (nameInput.value.trim() && latexInput.value.trim()) {
            favoriteFormulas.push({ name: nameInput.value.trim(), latex: latexInput.value.trim() });
            localStorage.setItem('mathNotesFormulas', JSON.stringify(favoriteFormulas));
            nameInput.value = '';
            latexInput.value = '';
            renderFormulas();
        }
    });

    // === AUTOSAVE SYSTEM ===
    let autosaveTimer = null;
    const autosaveStatus = document.getElementById('autosave-status');
    
    function saveStateToAutosave() {
        const data = {
            title: document.getElementById('doc-title').value,
            notesHTML: editorPage.innerHTML,
            mathElements: elements,
            theme: document.body.getAttribute('data-theme'),
            grid: document.body.getAttribute('data-grid'),
            timestamp: Date.now()
        };
        localStorage.setItem('mathNotesAutosave', JSON.stringify(data));
        
        autosaveStatus.style.display = 'inline-block';
        clearTimeout(autosaveTimer);
        autosaveTimer = setTimeout(() => {
            autosaveStatus.style.display = 'none';
        }, 3000);
    }

    // Auto-save every 10 seconds if changes occurred
    setInterval(saveStateToAutosave, 10000);
    editorPage.addEventListener('input', () => saveStateToAutosave); // Trigger occasionally on input

    // Check for autosave on load
    window.addEventListener('load', () => {
        const saved = localStorage.getItem('mathNotesAutosave');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                // Optionally prompt user or just load it. We'll just load it silently for seamless experience.
                if (data.title) document.getElementById('doc-title').value = data.title;
                if (data.notesHTML) editorPage.innerHTML = data.notesHTML;
                if (data.theme) { document.body.setAttribute('data-theme', data.theme); document.getElementById('theme-select').value = data.theme; }
                if (data.grid) { document.body.setAttribute('data-grid', data.grid); document.getElementById('grid-select').value = data.grid; }
                if (data.mathElements) {
                    elements = [];
                    if (mathLayer) mathLayer.innerHTML = '';
                    if (drawingLayer) drawingLayer.innerHTML = '';
                    initMarkers();
                    data.mathElements.forEach(d => {
                        if (d.type === 'math') createMath(d.x, d.y, d.content, d.id, d.color);
                        else if (d.type === 'text') createText(d.x, d.y, d.content, d.id, d.color);
                        else if (d.type === 'image') createImage(d.x, d.y, d.src, d.width, d.height, d.id);
                        else if (d.type === 'pen') createPenPath(d.pathData, d.color, d.width, d.id, d.isHighlight);
                        else if (d.type === 'shape') createShape(d.kind, d.x1, d.y1, d.x2, d.y2, d.id, d.color);
                    });
                }
            } catch(e) { console.error("Autosave load failed", e); }
        }
    });

    // === SETTINGS ===
    document.getElementById('btn-settings').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.remove('hidden');
    });
    document.getElementById('close-settings').addEventListener('click', () => {
        document.getElementById('settings-modal').classList.add('hidden');
    });
    document.getElementById('theme-select').addEventListener('change', (e) => {
        document.body.setAttribute('data-theme', e.target.value);
    });
    document.getElementById('grid-select').addEventListener('change', (e) => {
        document.body.setAttribute('data-grid', e.target.value);
    });

    // === TOP BAR ACTIONS ===
    document.getElementById('btn-account').addEventListener('click', () => {
        console.log("Account button clicked. Current user:", currentUser);
        if (currentUser) {
            const modal = document.getElementById('account-modal');
            console.log("Modal element found:", modal);
            if (modal) {
                modal.classList.remove('hidden');
                modal.style.display = 'flex'; // Force visibility
                console.log("Modal display style:", modal.style.display);
            }
            window.dispatchEvent(new Event('account-modal-opened'));
        } else {
            console.log("No current user, calling signIn()...");
            signIn();
        }
    });

    document.getElementById('btn-new').addEventListener('click', () => {
        if (confirm('Start a new document? Unsaved changes will be lost.')) {
            editorPage.innerHTML = '<h1>Untitled</h1><p>Start typing...</p>';
            document.getElementById('doc-title').value = 'Untitled Notes';
            elements = [];
            if (mathLayer) mathLayer.innerHTML = '';
            if (drawingLayer) drawingLayer.innerHTML = '';
            selectedElements.clear();
            initMarkers();
            updateWordCount();
        }
    });

    document.getElementById('btn-save').addEventListener('click', async () => {
        const data = {
            title: document.getElementById('doc-title').value,
            notesHTML: editorPage.innerHTML,
            mathElements: elements,
            theme: document.body.getAttribute('data-theme'),
            grid: document.body.getAttribute('data-grid'),
        };
        const content = JSON.stringify(data, null, 2);
        
        try {
            const filePath = await save({
                filters: [{ name: 'MathNotes File', extensions: ['mnf'] }],
                defaultPath: (data.title || 'notes') + '.mnf'
            });

            if (filePath) {
                await writeTextFile(filePath, content);
                console.log('File saved to', filePath);
            }
        } catch (err) {
            console.error('Failed to save file:', err);
            alert('Failed to save file.');
        }
    });

    document.getElementById('btn-open').addEventListener('click', async () => {
        try {
            const selectedPath = await open({
                filters: [{ name: 'MathNotes File', extensions: ['mnf'] }],
                multiple: false
            });

            if (selectedPath) {
                const content = await readTextFile(selectedPath);
                const data = JSON.parse(content);
                
                if (data.title) document.getElementById('doc-title').value = data.title;
                if (data.notesHTML) editorPage.innerHTML = data.notesHTML;
                if (data.theme) { document.body.setAttribute('data-theme', data.theme); document.getElementById('theme-select').value = data.theme; }
                if (data.grid) { document.body.setAttribute('data-grid', data.grid); document.getElementById('grid-select').value = data.grid; }
                if (data.mathElements) {
                    elements = [];
                    if (mathLayer) mathLayer.innerHTML = '';
                    if (drawingLayer) drawingLayer.innerHTML = '';
                    initMarkers();
                    data.mathElements.forEach(d => {
                        if (d.type === 'math') createMath(d.x, d.y, d.content, d.id, d.color);
                        else if (d.type === 'text') createText(d.x, d.y, d.content, d.id, d.color);
                        else if (d.type === 'image') createImage(d.x, d.y, d.src, d.width, d.height, d.id);
                        else if (d.type === 'pen') createPenPath(d.pathData, d.color, d.width, d.id, d.isHighlight);
                        else if (d.type === 'shape') createShape(d.kind, d.x1, d.y1, d.x2, d.y2, d.id, d.color);
                    });
                }
                updateWordCount();
            }
        } catch (err) {
            console.error('Failed to open file:', err);
            alert("Failed to open file. It might be corrupted.");
        }
    });

    document.getElementById('btn-cloud-save').addEventListener('click', async () => {
        const data = {
            title: document.getElementById('doc-title').value,
            notesHTML: editorPage.innerHTML,
            mathElements: elements,
            theme: document.body.getAttribute('data-theme'),
            grid: document.body.getAttribute('data-grid'),
        };
        
        const btn = document.getElementById('btn-cloud-save');
        btn.innerHTML = `<i data-lucide="loader-2" class="spinner"></i>`;
        lucide.createIcons();
        
        await saveToCloud(data);
        
        btn.innerHTML = `<i data-lucide="cloud-upload"></i>`;
        lucide.createIcons();
    });

    document.getElementById('btn-cloud-open').addEventListener('click', async () => {
        const btn = document.getElementById('btn-cloud-open');
        btn.innerHTML = `<i data-lucide="loader-2" class="spinner"></i>`;
        lucide.createIcons();
        
        const data = await loadFromCloud();
        
        btn.innerHTML = `<i data-lucide="cloud-download"></i>`;
        lucide.createIcons();
        
        if (data) {
            if (data.title) document.getElementById('doc-title').value = data.title;
            if (data.notesHTML) editorPage.innerHTML = data.notesHTML;
            if (data.theme) { document.body.setAttribute('data-theme', data.theme); document.getElementById('theme-select').value = data.theme; }
            if (data.grid) { document.body.setAttribute('data-grid', data.grid); document.getElementById('grid-select').value = data.grid; }
            if (data.mathElements) {
                elements = [];
                if (mathLayer) mathLayer.innerHTML = '';
                if (drawingLayer) drawingLayer.innerHTML = '';
                initMarkers();
                data.mathElements.forEach(d => {
                    if (d.type === 'math') createMath(d.x, d.y, d.content, d.id, d.color);
                    else if (d.type === 'text') createText(d.x, d.y, d.content, d.id, d.color);
                    else if (d.type === 'image') createImage(d.x, d.y, d.src, d.width, d.height, d.id);
                    else if (d.type === 'pen') createPenPath(d.pathData, d.color, d.width, d.id, d.isHighlight);
                    else if (d.type === 'shape') createShape(d.kind, d.x1, d.y1, d.x2, d.y2, d.id, d.color);
                });
            }
            updateWordCount();
        }
    });

    document.getElementById('btn-export').addEventListener('click', async () => {
        try {
            alert("Exporting PDF...");
            const target = currentMode === 'notes'
                ? document.getElementById('notes-editor')
                : document.getElementById('editor-container');
            const canvas = await html2canvas(target, { scale: 2, useCORS: true, logging: false });
            const imgData = canvas.toDataURL('image/jpeg', 0.95);
            const jsPDF = window.jspdf.jsPDF;
            const w = canvas.width, h = canvas.height;
            const pdf = new jsPDF({ orientation: w > h ? 'l' : 'p', unit: 'px', format: [w, h] });
            pdf.addImage(imgData, 'JPEG', 0, 0, w, h);
            pdf.save("MathNotes_Export.pdf");
        } catch(e) { alert("PDF export failed."); console.error(e); }
    });

    // === ACCOUNT MODAL LOGIC ===
    const accountModal = document.getElementById('account-modal');
    document.getElementById('btn-close-account').addEventListener('click', () => accountModal.classList.add('hidden'));
    
    document.getElementById('btn-logout').addEventListener('click', () => {
        if(confirm("Are you sure you want to log out?")) {
            logOut();
            accountModal.classList.add('hidden');
        }
    });

    window.addEventListener('account-modal-opened', async () => {
        if (!currentUser) return;
        
        // Render Profile Info
        const isOwner = currentUser.email === 'kwinten.dco@gmail.com';
        document.getElementById('account-profile-pic-container').innerHTML = `<img src="${currentUser.photoURL}" alt="Profile" style="width: 80px; height: 80px; border-radius: 50%; box-shadow: 0 4px 20px rgba(0,0,0,0.3); border: 2px solid var(--primary-color);">`;
        document.getElementById('account-name').textContent = currentUser.displayName;
        document.getElementById('account-email').textContent = currentUser.email;
        
        const badgeContainer = document.getElementById('account-badge-container');
        if (isOwner) {
            badgeContainer.innerHTML = `<div class="owner-badge" style="background: linear-gradient(135deg, #f59e0b, #d97706); color: white; padding: 4px 12px; border-radius: 50px; display: inline-block; font-size: 0.8rem; font-weight: 700;">Owner / Plus Member +</div>`;
        } else {
            badgeContainer.innerHTML = `<div class="member-badge" style="background: rgba(255,255,255,0.1); color: var(--text-muted); padding: 4px 12px; border-radius: 50px; display: inline-block; font-size: 0.8rem;">Standard Member</div>`;
        }

        // Fetch & Render Cloud Storage Usage
        try {
            const notebooks = await getUserNotebooks();
            const count = notebooks ? notebooks.length : 0;
            const limit = isOwner ? Infinity : 3;
            
            const storageText = document.getElementById('storage-usage-text');
            const storageFill = document.getElementById('storage-usage-fill');
            
            if (isOwner) {
                if (storageText) storageText.textContent = `${count} notebooks saved (Infinite Storage)`;
                if (storageFill) {
                    storageFill.style.width = '100%';
                    storageFill.style.background = 'linear-gradient(90deg, #f59e0b, #d97706)';
                }
            } else {
                const percent = Math.min((count / limit) * 100, 100);
                if (storageText) storageText.textContent = `${count} of ${limit} notebooks used`;
                if (storageFill) {
                    storageFill.style.width = `${percent}%`;
                    if (percent >= 100) storageFill.style.background = '#ef4444';
                    else storageFill.style.background = 'var(--primary-color)';
                }
            }

            // Render Results
            const listEl = document.getElementById('cloud-notes-list');
            if (!notebooks || notebooks.length === 0) {
                listEl.innerHTML = `<p style="color: var(--text-muted); font-size: 0.85rem; text-align: center; padding: 10px;">No saved notes found in the cloud.</p>`;
                return;
            }

            listEl.innerHTML = '';
            notebooks.forEach(note => {
                const item = document.createElement('div');
                item.className = 'cloud-note-item';
                
                const localDate = new Date(note.updatedAt).toLocaleString();
                const title = note.title || 'Untitled Notes';

                item.innerHTML = `
                    <div class="cloud-note-info">
                        <div class="cloud-note-title" title="${title}">${title}</div>
                        <div class="cloud-note-date">${localDate}</div>
                    </div>
                    <div class="cloud-note-actions">
                        <button class="btn btn-small secondary btn-cloud-load" data-id="${note.id}">Load</button>
                        <button class="btn btn-small btn-cloud-delete" style="background:#ef4444; color:white; border:none;" data-id="${note.id}"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
                    </div>
                `;
                listEl.appendChild(item);
            });
            lucide.createIcons();

            // Attach event listeners to the new buttons
            listEl.querySelectorAll('.btn-cloud-load').forEach(btn => {
                btn.addEventListener('click', (e) => {
                    const idToLoad = e.currentTarget.getAttribute('data-id');
                    const note = notebooks.find(n => n.id === idToLoad);
                    if (note) {
                        if (confirm(`Load "${note.title || 'Untitled'}"? current changes will be lost.`)) {
                            if (note.title) document.getElementById('doc-title').value = note.title;
                            if (note.notesHTML) editorPage.innerHTML = note.notesHTML;
                            if (note.theme) { document.body.setAttribute('data-theme', note.theme); document.getElementById('theme-select').value = note.theme; }
                            if (note.grid) { document.body.setAttribute('data-grid', note.grid); document.getElementById('grid-select').value = note.grid; }
                            if (note.mathElements) {
                                 elements = [];
                                 if (mathLayer) mathLayer.innerHTML = '';
                                 if (drawingLayer) drawingLayer.innerHTML = '';
                                 initMarkers();
                                 note.mathElements.forEach(d => {
                                     if (d.type === 'math') createMath(d.x, d.y, d.content, d.id, d.color);
                                     else if (d.type === 'text') createText(d.x, d.y, d.content, d.id, d.color);
                                     else if (d.type === 'image') createImage(d.x, d.y, d.src, d.width, d.height, d.id);
                                     else if (d.type === 'pen') createPenPath(d.pathData, d.color, d.width, d.id, d.isHighlight);
                                     else if (d.type === 'shape') createShape(d.kind, d.x1, d.y1, d.x2, d.y2, d.id, d.color);
                                 });
                            }
                            updateWordCount();
                            accountModal.classList.add('hidden');
                            console.log('Loaded notebook:', idToLoad);
                        }
                    }
                });
            });

            listEl.querySelectorAll('.btn-cloud-delete').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const idToDelete = e.currentTarget.getAttribute('data-id');
                    if (confirm('Are you sure you want to permanently delete this note from the cloud?')) {
                        const success = await deleteFromCloud(idToDelete);
                        if (success) {
                            window.dispatchEvent(new Event('account-modal-opened'));
                        }
                    }
                });
            });
        } catch (err) {
            console.error("Account modal render error:", err);
        }
    });

    // ======================================================
    // === MATH MODE LOGIC (same as before, cleaned up) =====
    // ======================================================

    function getPos(e) {
        const rect = grid.getBoundingClientRect();
        let cX = e.clientX, cY = e.clientY;
        if (e.touches && e.touches.length > 0) { cX = e.touches[0].clientX; cY = e.touches[0].clientY; }
        else if (e.changedTouches && e.changedTouches.length > 0) { cX = e.changedTouches[0].clientX; cY = e.changedTouches[0].clientY; }
        return { x: cX - rect.left, y: cY - rect.top };
    }

    // Pen controls (injected into math toolbar)
    const mathToolbarTools = document.querySelector('.math-toolbar .tools');
    if (mathToolbarTools) {
        const penControls = document.createElement('div');
        penControls.className = 'pen-controls';
        penControls.id = 'pen-controls';
        penControls.style.display = 'none';
        penControls.innerHTML = `
            <input type="color" class="pen-color-picker" value="#4361ee" title="Pen Color">
            <input type="range" class="pen-size-slider" min="1" max="10" value="2" title="Pen Size">
        `;
        const eraserBtn = document.getElementById('tool-eraser');
        if (eraserBtn) mathToolbarTools.insertBefore(penControls, eraserBtn);
        document.querySelector('.pen-color-picker')?.addEventListener('input', (e) => penColor = e.target.value);
        document.querySelector('.pen-size-slider')?.addEventListener('input', (e) => penSize = e.target.value);
    }

    const imageUpload = document.getElementById('image-upload');
    imageUpload.addEventListener('change', handleImageUpload);

    function setActiveTool(id) {
        if (id === 'tool-image') { imageUpload.click(); return; }
        if (id === 'tool-shapes') return;
        currentTool = id;
        document.body.setAttribute('data-tool', id);
        const pc = document.getElementById('pen-controls');
        if (pc) pc.style.display = id === 'tool-pen' ? 'flex' : 'none';
        toolBtns.forEach(btn => btn.classList.toggle('active', btn.id === id));
        shapeBtns.forEach(btn => btn.classList.toggle('active', btn.getAttribute('data-shape') === id));
        if (id !== 'tool-select') clearSelectionLayer();
    }

    function initMarkers() {
        if (!drawingLayer) return;
        drawingLayer.querySelectorAll('defs').forEach(d => d.remove());
        const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
        const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
        marker.setAttribute("id", "arrowhead");
        marker.setAttribute("markerWidth", "10"); marker.setAttribute("markerHeight", "7");
        marker.setAttribute("refX", "9"); marker.setAttribute("refY", "3.5");
        marker.setAttribute("orient", "auto");
        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        poly.setAttribute("points", "0 0, 10 3.5, 0 7");
        poly.setAttribute("fill", "var(--primary-color)");
        marker.appendChild(poly); defs.appendChild(marker);
        drawingLayer.appendChild(defs);
    }
    initMarkers();

    const MATH_SHORTCUTS = { "/": "\\frac{#0}{#0}", "*": "\\times", "inf": "\\infty", "->": "\\to", "<=": "\\le", ">=": "\\ge", "alpha": "\\alpha", "beta": "\\beta", "pi": "\\pi", "sqrt": "\\sqrt{#0}", "sum": "\\sum_{#0}^{#0}", "int": "\\int_{#0}^{#0}" };

    const mathColorInput = document.getElementById('math-color');
    mathColorInput.addEventListener('input', (e) => {
        const color = e.target.value;
        if (selectedElements.size > 0) {
            selectedElements.forEach(id => {
                const el = document.getElementById(id);
                const data = elements.find(ev => ev.id === id);
                if (!data || !el) return;
                data.color = color;
                if (data.type === 'pen' || data.type === 'shape') {
                    if (!el.classList.contains('selected')) el.setAttribute('stroke', color);
                } else if (data.type === 'text') {
                    el.style.color = color;
                } else if (data.type === 'math') {
                    const mf = el.querySelector('math-field');
                    if (mf) mf.style.color = color;
                }
            });
            saveStateToAutosave();
        }
    });

    function createMath(x, y, content = '', idOverride = null, color = null) {
        const id = idOverride || 'math-' + Math.random().toString(36).substr(2, 9);
        const sx = Math.round(x / GRID_SIZE) * GRID_SIZE;
        const sy = Math.round(y / GRID_SIZE) * GRID_SIZE;
        const block = document.createElement('div');
        block.className = 'math-block erasable'; block.id = id;
        block.style.left = `${sx}px`; block.style.top = `${sy}px`;
        const mf = document.createElement('math-field');
        mf.value = content;
        const c = color || mathColorInput.value;
        mf.style.color = c;
        mf.setOptions({ smartFence: true, virtualKeyboardMode: 'manual', inlineShortcuts: { ...mf.getOption('inlineShortcuts'), ...MATH_SHORTCUTS } });
        block.appendChild(mf);
        mathLayer.appendChild(block);
        attachInteractionEvents(block, id);
        mf.addEventListener('focusin', () => activeMathField = mf);
        if (!idOverride) elements.push({ id, type: 'math', x: sx, y: sy, content, color: c });
        setTimeout(() => { mf.focus(); activeMathField = mf; }, 50);
        return block;
    }

    function createText(x, y, content = '', idOverride = null, color = null) {
        const id = idOverride || 'text-' + Math.random().toString(36).substr(2, 9);
        const sx = Math.round(x / GRID_SIZE) * GRID_SIZE;
        const sy = Math.round(y / GRID_SIZE) * GRID_SIZE;
        const block = document.createElement('div');
        block.className = 'text-block erasable'; block.id = id;
        block.style.left = `${sx}px`; block.style.top = `${sy}px`;
        block.contentEditable = "true";
        block.dataset.placeholder = "Type here...";
        const c = color || mathColorInput.value;
        block.style.color = c;
        if (content) block.innerHTML = content;
        mathLayer.appendChild(block);
        block.addEventListener('blur', () => {
            if (!block.textContent.trim() && !block.querySelector('math-field')) removeEl(id);
            updateElementData(id);
        });
        attachInteractionEvents(block, id, true);
        if (!idOverride) elements.push({ id, type: 'text', x: sx, y: sy, content, color: c });
        setTimeout(() => block.focus(), 50);
        return block;
    }

    function createImage(x, y, src, width = 200, height = null, idOverride = null) {
        const id = idOverride || 'img-' + Math.random().toString(36).substr(2, 9);
        const block = document.createElement('div');
        block.className = 'image-block erasable'; block.id = id;
        block.style.left = `${x}px`; block.style.top = `${y}px`;
        block.style.width = `${width}px`;
        if (height) block.style.height = `${height}px`;
        const img = document.createElement('img');
        img.src = src;
        block.appendChild(img);
        const handle = document.createElement('div');
        handle.className = 'image-resize-handle br';
        block.appendChild(handle);
        mathLayer.appendChild(block);
        attachInteractionEvents(block, id);
        handle.addEventListener('mousedown', (e) => startResize(e, block, id));
        handle.addEventListener('touchstart', (e) => startResize(e, block, id), {passive: false});
        if (!idOverride) elements.push({ id, type: 'image', x, y, src, width, height });
        return block;
    }

    function startResize(e, block, id) {
        e.stopPropagation(); e.preventDefault();
        const startX = e.clientX || (e.touches ? e.touches[0].clientX : 0);
        const startY = e.clientY || (e.touches ? e.touches[0].clientY : 0);
        const startW = block.offsetWidth, startH = block.offsetHeight;
        function moveFn(ev) {
            const evX = ev.clientX || (ev.touches ? ev.touches[0].clientX : 0);
            const evY = ev.clientY || (ev.touches ? ev.touches[0].clientY : 0);
            block.style.width = Math.max(50, startW + (evX - startX)) + 'px';
            block.style.height = Math.max(50, startH + (evY - startY)) + 'px';
        }
        function stopFn() {
            window.removeEventListener('mousemove', moveFn); window.removeEventListener('touchmove', moveFn);
            window.removeEventListener('mouseup', stopFn); window.removeEventListener('touchend', stopFn);
            const data = elements.find(ev => ev.id === id);
            if (data) { data.width = block.offsetWidth; data.height = block.offsetHeight; }
        }
        window.addEventListener('mousemove', moveFn); window.addEventListener('touchmove', moveFn, {passive:false});
        window.addEventListener('mouseup', stopFn); window.addEventListener('touchend', stopFn);
    }

    function createShape(type, x1, y1, x2, y2, idOverride = null, color = null) {
        const id = idOverride || 'shape-' + Math.random().toString(36).substr(2, 9);
        let shape;
        const sx1 = Math.round(x1/GRID_SIZE)*GRID_SIZE, sy1 = Math.round(y1/GRID_SIZE)*GRID_SIZE;
        const sx2 = Math.round(x2/GRID_SIZE)*GRID_SIZE, sy2 = Math.round(y2/GRID_SIZE)*GRID_SIZE;
        switch(type) {
            case 'rect': case 'square':
                shape = document.createElementNS("http://www.w3.org/2000/svg","rect");
                updateRect(shape,sx1,sy1,sx2,sy2,type==='square'); break;
            case 'circle': case 'ellipse':
                shape = document.createElementNS("http://www.w3.org/2000/svg","ellipse");
                updateEllipse(shape,sx1,sy1,sx2,sy2,type==='circle'); break;
            case 'triangle':
                shape = document.createElementNS("http://www.w3.org/2000/svg","polygon");
                updateTri(shape,sx1,sy1,sx2,sy2); break;
            default:
                shape = document.createElementNS("http://www.w3.org/2000/svg","line");
                shape.setAttribute('x1',sx1); shape.setAttribute('y1',sy1);
                shape.setAttribute('x2',sx2); shape.setAttribute('y2',sy2);
                if (['arrow','connector'].includes(type)) shape.setAttribute("marker-end","url(#arrowhead)");
                if (type==='double-arrow') { shape.setAttribute("marker-end","url(#arrowhead)"); shape.setAttribute("marker-start","url(#arrowhead)"); }
                if (type==='dash-line') shape.setAttribute("stroke-dasharray","5,5");
        }
        if (shape) {
            shape.id = id;
            shape.setAttribute('class','selectable-shape erasable');
            const c = color || mathColorInput.value;
            shape.setAttribute('stroke', c);
            shape.setAttribute('stroke-width', shape.getAttribute('stroke-width')||'2');
            shape.setAttribute('fill','transparent');
            drawingLayer.appendChild(shape);
            attachInteractionEvents(shape, id);
            if (!idOverride) elements.push({ id, type:'shape', kind:type, x1:sx1, y1:sy1, x2:sx2, y2:sy2, color:c });
        }
    }

    function createPenPath(pathData, color, width, idOverride = null, isHighlight = false) {
        const id = idOverride || 'pen-' + Math.random().toString(36).substr(2, 9);
        const path = document.createElementNS("http://www.w3.org/2000/svg","path");
        path.id = id;
        path.setAttribute('class','pen-path erasable');
        path.setAttribute('d', pathData);
        path.setAttribute('stroke', color);
        path.setAttribute('stroke-width', width);
        if (isHighlight) {
            path.style.opacity = '0.4';
            path.style.mixBlendMode = 'multiply';
        }
        drawingLayer.appendChild(path);
        attachInteractionEvents(path, id);
        if (!idOverride) elements.push({ id, type:'pen', pathData, color, width, isHighlight });
        return { id, path };
    }

    function attachInteractionEvents(el, id, isText = false) {
        const evHandler = (e) => {
            if (currentTool === 'tool-eraser') { removeEl(id); e.stopPropagation(); }
            else if (currentTool === 'tool-select') {
                if (!e.shiftKey && !selectedElements.has(id)) clearSelectionLayer();
                selectEl(id);
                isPointerDown = true; isDragging = true;
                lastPointerPos = getPos(e);
                if (!isText) e.stopPropagation();
            }
        };
        el.addEventListener('mousedown', evHandler);
        el.addEventListener('touchstart', evHandler, {passive:false});
    }

    function updateElementData(id) {
        const el = document.getElementById(id);
        const data = elements.find(ev => ev.id === id);
        if (!el || !data) return;
        if (data.type === 'math') { const mf = el.querySelector('math-field'); if (mf) data.content = mf.value; }
        else if (data.type === 'text') { data.content = el.innerHTML; }
    }

    function updateRect(r,x1,y1,x2,y2,isSq=false) {
        let w=x2-x1,h=y2-y1;
        if(isSq){const s=Math.max(Math.abs(w),Math.abs(h));w=w>=0?s:-s;h=h>=0?s:-s;}
        r.setAttribute('x',w>=0?x1:x1+w); r.setAttribute('y',h>=0?y1:y1+h);
        r.setAttribute('width',Math.max(1,Math.abs(w))); r.setAttribute('height',Math.max(1,Math.abs(h)));
    }
    function updateEllipse(e,x1,y1,x2,y2,isCr=false) {
        let rx=Math.abs(x2-x1)/2,ry=Math.abs(y2-y1)/2; if(isCr)rx=ry=Math.max(rx,ry);
        e.setAttribute('cx',x1+(x2-x1)/2); e.setAttribute('cy',y1+(y2-y1)/2);
        e.setAttribute('rx',Math.max(1,rx)); e.setAttribute('ry',Math.max(1,ry));
    }
    function updateTri(t,x1,y1,x2,y2) { t.setAttribute('points',`${x1+(x2-x1)/2},${y1} ${x1},${y2} ${x2},${y2}`); }
    function selectEl(id) {
        const el=document.getElementById(id); if(!el)return;
        selectedElements.add(id); el.classList.add('selected');
        if(['path','rect','ellipse','polygon','line'].includes(el.tagName)) el.setAttribute('stroke','#ff00ff');
    }
    function clearSelectionLayer() {
        selectedElements.forEach(id => {
            const el=document.getElementById(id);
            if(el){ el.classList.remove('selected');
                if(['path','rect','ellipse','polygon','line'].includes(el.tagName)){
                    const data=elements.find(ev=>ev.id===id);
                    el.setAttribute('stroke', data && data.color ? data.color : mathColorInput.value);
                }
            }
        });
        selectedElements.clear();
    }
    function removeEl(id) {
        const el=document.getElementById(id); if(el)el.remove();
        elements=elements.filter(e=>e.id!==id);
        selectedElements.delete(id);
    }

    // Pointer handlers (Math Mode only)
    function handlePointerDown(e) {
        if (currentMode !== 'math') return;
        if (e.target.closest('.top-bar') || e.target.closest('.math-toolbar') || e.target.closest('.dropdown') || e.target.closest('.modal') || e.target.closest('.floating-action-btn') || e.target.closest('.calc-panel')) return;
        const p = getPos(e);
        isPointerDown = true; startPos = p; lastPointerPos = p;
        if (currentTool === 'tool-math') { createMath(p.x,p.y); e.preventDefault(); }
        else if (currentTool === 'tool-text') { createText(p.x,p.y); e.preventDefault(); }
        else if (currentTool === 'tool-pen' || currentTool === 'tool-highlighter') {
            const isHighlight = currentTool === 'tool-highlighter';
            const c = isHighlight ? '#facc15' : penColor;
            const s = isHighlight ? 20 : penSize;
            const res = createPenPath(`M ${p.x} ${p.y}`, c, s, null, isHighlight);
            currentPenPath = res.path;
            const data = elements.find(ev => ev.id === res.id);
            data.pathData = `M ${p.x} ${p.y}`;
            data.points = [{x:p.x,y:p.y}];
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
        if (!isPointerDown || currentMode !== 'math') return;
        const p = getPos(e);
        if (currentTool === 'tool-select') {
            if (isDragging) {
                const stepX = p.x - lastPointerPos.x, stepY = p.y - lastPointerPos.y;
                if (stepX !== 0 || stepY !== 0) {
                    selectedElements.forEach(id => {
                        const el = document.getElementById(id);
                        const data = elements.find(ev => ev.id === id);
                        if (!data) return;
                        if (['math','text','image'].includes(data.type)) {
                            data.x += stepX; data.y += stepY;
                            el.style.left = `${data.x}px`; el.style.top = `${data.y}px`;
                        } else if (data.type === 'pen') {
                            data.pathData = shiftSVGPath(data.pathData, stepX, stepY);
                            el.setAttribute('d', data.pathData);
                        } else {
                            data.x1+=stepX;data.y1+=stepY;data.x2+=stepX;data.y2+=stepY;
                            if(el.tagName==='line'){el.setAttribute('x1',data.x1);el.setAttribute('y1',data.y1);el.setAttribute('x2',data.x2);el.setAttribute('y2',data.y2);}
                            else if(el.tagName==='rect')updateRect(el,data.x1,data.y1,data.x2,data.y2,data.kind==='square');
                            else if(el.tagName==='ellipse')updateEllipse(el,data.x1,data.y1,data.x2,data.y2,data.kind==='circle');
                            else if(el.tagName==='polygon')updateTri(el,data.x1,data.y1,data.x2,data.y2);
                        }
                    });
                    lastPointerPos.x += stepX; lastPointerPos.y += stepY;
                }
            } else if (!marquee.classList.contains('hidden')) {
                const x=Math.min(startPos.x,p.x),y=Math.min(startPos.y,p.y);
                const w=Math.abs(p.x-startPos.x),h=Math.abs(p.y-startPos.y);
                marquee.style.left=`${x}px`;marquee.style.top=`${y}px`;marquee.style.width=`${w}px`;marquee.style.height=`${h}px`;
            }
        } else if ((currentTool === 'tool-pen' || currentTool === 'tool-highlighter') && currentPenPath) {
            const data = elements.find(ev => ev.id === currentPenPath.id);
            if (data && data.points) {
                data.points.push({x:p.x,y:p.y});
                if (data.points.length > 2) {
                    let d = `M ${data.points[0].x} ${data.points[0].y}`;
                    for (let i=1;i<data.points.length-1;i++) {
                        const xc=(data.points[i].x+data.points[i+1].x)/2;
                        const yc=(data.points[i].y+data.points[i+1].y)/2;
                        d+=` Q ${data.points[i].x} ${data.points[i].y}, ${xc} ${yc}`;
                    }
                    d+=` L ${data.points[data.points.length-1].x} ${data.points[data.points.length-1].y}`;
                    data.pathData = d;
                    currentPenPath.setAttribute('d', data.pathData);
                }
            }
        } else if (!['tool-math','tool-text','tool-eraser','tool-image'].includes(currentTool)) {
            const shapeType = currentTool.startsWith('tool-') ? currentTool.substring(5) : currentTool;
            if (!currentPreview) {
                const tag=['circle','ellipse'].includes(shapeType)?'ellipse':(shapeType==='triangle'?'polygon':(['rect','square'].includes(shapeType)?'rect':'line'));
                currentPreview=document.createElementNS("http://www.w3.org/2000/svg",tag);
                currentPreview.setAttribute('stroke','var(--primary-color)');
                currentPreview.setAttribute('stroke-dasharray','4');
                currentPreview.setAttribute('fill','none');
                drawingLayer.appendChild(currentPreview);
            }
            if(currentPreview.tagName==='line'){currentPreview.setAttribute('x1',startPos.x);currentPreview.setAttribute('y1',startPos.y);currentPreview.setAttribute('x2',p.x);currentPreview.setAttribute('y2',p.y);}
            else if(currentPreview.tagName==='rect')updateRect(currentPreview,startPos.x,startPos.y,p.x,p.y,shapeType==='square');
            else if(currentPreview.tagName==='ellipse')updateEllipse(currentPreview,startPos.x,startPos.y,p.x,p.y,shapeType==='circle');
            else if(currentPreview.tagName==='polygon')updateTri(currentPreview,startPos.x,startPos.y,p.x,p.y);
        }
    }

    function handlePointerUp(e) {
        if (!isPointerDown || currentMode !== 'math') return;
        const p = getPos(e);
        if (currentTool === 'tool-pen' || currentTool === 'tool-highlighter') { currentPenPath = null; }
        else if (currentTool === 'tool-select' && !marquee.classList.contains('hidden')) {
            const sx = Math.min(startPos.x, p.x), sy = Math.min(startPos.y, p.y);
            const sw = Math.abs(p.x - startPos.x), sh = Math.abs(p.y - startPos.y);
            if (sw > 10 && sh > 10) {
                if (!e.shiftKey) clearSelectionLayer();
                elements.forEach(data => {
                    const el = document.getElementById(data.id);
                    if (!el) return;
                    let ex = data.x, ey = data.y;
                    if (data.type === 'shape') { ex = Math.min(data.x1, data.x2); ey = Math.min(data.y1, data.y2); }
                    if (data.type === 'pen') { ex = data.points && data.points.length > 0 ? data.points[0].x : 0; ey = data.points && data.points.length > 0 ? data.points[0].y : 0; }
                    
                    if (ex >= sx && ex <= sx+sw && ey >= sy && ey <= sy+sh) {
                        selectEl(data.id);
                    }
                });
            }
        }
        else if (!['tool-select','tool-math','tool-text','tool-eraser','tool-image'].includes(currentTool)) {
            if(currentPreview){currentPreview.remove();currentPreview=null;}
            if(Math.abs(p.x-startPos.x)>5||Math.abs(p.y-startPos.y)>5){
                const shapeType=currentTool.startsWith('tool-')?currentTool.substring(5):currentTool;
                createShape(shapeType,startPos.x,startPos.y,p.x,p.y);
            }
        }
        isPointerDown=false; isDragging=false; marquee.classList.add('hidden');
    }

    if (grid) {
        grid.addEventListener('mousedown', handlePointerDown);
        grid.addEventListener('touchstart', handlePointerDown, {passive:false});
    }
    window.addEventListener('mousemove', handlePointerMove);
    window.addEventListener('touchmove', handlePointerMove, {passive:false});
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchend', handlePointerUp);

    function shiftSVGPath(d,dx,dy) {
        return d.replace(/([MLQ])\s*([\d.-]+)\s*[ ,]([\d.-]+)/g, (match,cmd,x,y) => `${cmd} ${parseFloat(x)+dx} ${parseFloat(y)+dy}`);
    }

    function handleImageUpload(e) {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            const rect = grid.getBoundingClientRect();
            const cx = (window.innerWidth/2)-rect.left-100, cy = (window.innerHeight/2)-rect.top-100;
            createImage(cx, cy, event.target.result);
            setActiveTool('tool-select');
        };
        reader.readAsDataURL(file);
    }

    // Drag & drop images into math workspace
    window.addEventListener('dragover', (e) => { if(currentMode==='math'){e.preventDefault();e.stopPropagation();}});
    window.addEventListener('drop', (e) => {
        if (currentMode !== 'math') return;
        e.preventDefault(); e.stopPropagation();
        const p = getPos(e);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            const file = e.dataTransfer.files[0];
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (ev) => createImage(p.x, p.y, ev.target.result);
                reader.readAsDataURL(file);
            }
        }
    });

    // Tool wiring
    toolBtns.forEach(btn => btn.addEventListener('click', () => setActiveTool(btn.id)));
    shapeBtns.forEach(btn => btn.addEventListener('click', () => setActiveTool(btn.getAttribute('data-shape'))));

    // Hotkeys
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'MATH-FIELD' || e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
        if (e.key === 'Delete' || e.key === 'Backspace') selectedElements.forEach(id => removeEl(id));
        if (e.key === 'v') setActiveTool('tool-select');
        if (e.key === 'm') setActiveTool('tool-math');
        if (e.key === 't') setActiveTool('tool-text');
        if (e.key === 'p') setActiveTool('tool-pen');
        if (e.key === 'e') setActiveTool('tool-eraser');
    });

    // Scanner integration
    document.addEventListener('insertScanData', (e) => {
        const { x, y, text } = e.detail;
        if (text.includes('\\') || text.includes('=')) createMath(x, y, text);
        else createText(x, y, text);
    });

    // ============================================================
    // === GRAPHING CALCULATOR (improved math parser) ==============
    // ============================================================
    const calcTrigger = document.getElementById('calc-trigger');
    const calcPanel = document.getElementById('calc-panel');
    const calcClose = document.getElementById('calc-close');
    const calcImport = document.getElementById('calc-import');
    const addEquationBtn = document.getElementById('add-equation');
    const equationListEl = document.getElementById('equation-list');
    const graphCanvas = document.getElementById('graph-canvas');
    const gCtx = graphCanvas.getContext('2d');
    const GRAPH_COLORS = ['#f43f5e','#3b82f6','#22c55e','#f59e0b','#a855f7','#06b6d4','#ec4899'];
    const FUNC_NAMES = ['f','g','h','p','q','r','s'];
    let equations = [];
    let graphView = { cx:0, cy:0, scale:40 };

    calcTrigger.addEventListener('click', () => {
        calcPanel.classList.toggle('hidden');
        if (!calcPanel.classList.contains('hidden')) {
            if (equations.length === 0) addNewEquation();
            renderGraph();
            lucide.createIcons();
        }
    });
    calcClose.addEventListener('click', () => calcPanel.classList.add('hidden'));

    function addNewEquation(expr='') {
        const idx = equations.length;
        const color = GRAPH_COLORS[idx % GRAPH_COLORS.length];
        const fname = FUNC_NAMES[idx % FUNC_NAMES.length];
        equations.push({ expr, color, name: fname });
        const row = document.createElement('div');
        row.className = 'equation-row';
        row.innerHTML = `
            <span class="eq-label" style="color:${color}">${fname}(x) =</span>
            <input type="text" placeholder="e.g. sin(x), x^2, log(x, 10)" value="${expr}" data-idx="${idx}">
            <input type="color" value="${color}" data-idx="${idx}">
            <button class="eq-remove" data-idx="${idx}">&times;</button>
        `;
        equationListEl.appendChild(row);
        row.querySelector('input[type="text"]').addEventListener('input', (e) => { equations[e.target.dataset.idx].expr = e.target.value; renderGraph(); });
        row.querySelector('input[type="color"]').addEventListener('input', (e) => { equations[e.target.dataset.idx].color = e.target.value; row.querySelector('.eq-label').style.color = e.target.value; renderGraph(); });
        row.querySelector('.eq-remove').addEventListener('click', (e) => { equations.splice(parseInt(e.target.dataset.idx),1); rebuildEqList(); renderGraph(); });
    }

    function rebuildEqList() {
        equationListEl.innerHTML='';
        const saved=[...equations]; equations=[];
        saved.forEach(eq => addNewEquation(eq.expr));
    }

    addEquationBtn.addEventListener('click', () => { addNewEquation(); lucide.createIcons(); });

    // Improved math expression parser
    // Supports: log(x), log(x, base), ln(x), sin, cos, tan, asin, acos, atan,
    //           sqrt, cbrt, abs, floor, ceil, round, pi, e, ^ (power), / (division),
    //           implicit multiplication (2x, 3sin(x))
    function parseMathExpr(expr, x) {
        try {
            let s = expr
                // log(x, base) -> (Math.log(x)/Math.log(base))
                .replace(/log\(([^,]+),\s*([^)]+)\)/g, '(Math.log($1)/Math.log($2))')
                // log10(x) -> Math.log10(x)
                .replace(/\blog10\b/g, 'Math.log10')
                // ln(x) -> Math.log(x)
                .replace(/\bln\b/g, 'Math.log')
                // log(x) alone -> Math.log(x) (natural log)
                .replace(/\blog\b/g, 'Math.log')
                .replace(/\bsin\b/g, 'Math.sin')
                .replace(/\bcos\b/g, 'Math.cos')
                .replace(/\btan\b/g, 'Math.tan')
                .replace(/\basin\b/g, 'Math.asin')
                .replace(/\bacos\b/g, 'Math.acos')
                .replace(/\batan\b/g, 'Math.atan')
                .replace(/\bsqrt\b/g, 'Math.sqrt')
                .replace(/\bcbrt\b/g, 'Math.cbrt')
                .replace(/\babs\b/g, 'Math.abs')
                .replace(/\bfloor\b/g, 'Math.floor')
                .replace(/\bceil\b/g, 'Math.ceil')
                .replace(/\bround\b/g, 'Math.round')
                .replace(/\bpi\b/g, 'Math.PI')
                .replace(/\be\b/g, 'Math.E')
                .replace(/\^/g, '**')
                // Implicit multiplication: 2x -> 2*x, )x -> )*x, number( -> number*(
                .replace(/(\d)([a-zA-Z(])/g, '$1*$2')
                .replace(/\)(\w)/g, ')*$1')
                .replace(/(\w)\(/g, '$1*(');
            return new Function('x', `"use strict"; return (${s})`)(x);
        } catch(e) { return NaN; }
    }

    function renderGraph() {
        const W = graphCanvas.width = graphCanvas.offsetWidth * 2;
        const H = graphCanvas.height = graphCanvas.offsetHeight * 2;
        gCtx.clearRect(0,0,W,H);
        const s = graphView.scale;
        const ox = W/2 + graphView.cx*s;
        const oy = H/2 - graphView.cy*s;

        gCtx.fillStyle = '#0f172a'; gCtx.fillRect(0,0,W,H);

        // Grid
        gCtx.strokeStyle='#1e293b'; gCtx.lineWidth=1;
        for(let gx=ox%s;gx<W;gx+=s){gCtx.beginPath();gCtx.moveTo(gx,0);gCtx.lineTo(gx,H);gCtx.stroke();}
        for(let gy=oy%s;gy<H;gy+=s){gCtx.beginPath();gCtx.moveTo(0,gy);gCtx.lineTo(W,gy);gCtx.stroke();}

        // Axes
        gCtx.strokeStyle='#475569'; gCtx.lineWidth=2;
        gCtx.beginPath();gCtx.moveTo(0,oy);gCtx.lineTo(W,oy);gCtx.stroke();
        gCtx.beginPath();gCtx.moveTo(ox,0);gCtx.lineTo(ox,H);gCtx.stroke();

        // Labels
        gCtx.fillStyle='#94a3b8'; gCtx.font='20px Inter, sans-serif';
        for(let i=Math.floor(-ox/s);i<=Math.ceil((W-ox)/s);i++){
            if(i===0)continue; const px=ox+i*s;
            gCtx.fillText(i.toString(),px-6,oy+20);
        }
        for(let j=Math.floor(-(H-oy)/s);j<=Math.ceil(oy/s);j++){
            if(j===0)continue; const py=oy-j*s;
            gCtx.fillText(j.toString(),ox+6,py+6);
        }
        gCtx.fillText('0',ox+6,oy+20);

        // Plot + legend labels
        equations.forEach((eq, i) => {
            if(!eq.expr.trim()) return;
            gCtx.strokeStyle=eq.color; gCtx.lineWidth=3;
            gCtx.beginPath();
            let started=false;
            for(let px=0;px<W;px++){
                const x=(px-ox)/s;
                const y=parseMathExpr(eq.expr,x);
                if(isNaN(y)||!isFinite(y)){started=false;continue;}
                const py=oy-y*s;
                if(py<-1000||py>H+1000){started=false;continue;}
                if(!started){gCtx.moveTo(px,py);started=true;}
                else gCtx.lineTo(px,py);
            }
            gCtx.stroke();

            // Legend label
            gCtx.fillStyle = eq.color;
            gCtx.font = 'bold 22px Inter, sans-serif';
            gCtx.fillText(`${eq.name}(x) = ${eq.expr}`, 20, 36 + i * 28);
        });
    }

    // Pan & Zoom
    let graphDragging=false, graphLastPos={x:0,y:0};
    graphCanvas.addEventListener('mousedown',(e)=>{graphDragging=true;graphLastPos={x:e.offsetX,y:e.offsetY};});
    graphCanvas.addEventListener('mousemove',(e)=>{
        if(!graphDragging)return;
        graphView.cx+=(e.offsetX-graphLastPos.x)/graphView.scale;
        graphView.cy-=(e.offsetY-graphLastPos.y)/graphView.scale;
        graphLastPos={x:e.offsetX,y:e.offsetY};
        renderGraph();
    });
    window.addEventListener('mouseup',()=>graphDragging=false);
    graphCanvas.addEventListener('wheel',(e)=>{
        e.preventDefault();
        graphView.scale*=e.deltaY<0?1.1:0.9;
        graphView.scale=Math.max(5,Math.min(200,graphView.scale));
        renderGraph();
    });

    // Import graph to workspace
    calcImport.addEventListener('click', () => {
        renderGraph();
        const dataURL = graphCanvas.toDataURL('image/png');
        if (currentMode === 'math') {
            const rect = grid.getBoundingClientRect();
            createImage((window.innerWidth/2)-rect.left-200, (window.innerHeight/2)-rect.top-150, dataURL, 400);
        } else {
            const img = document.createElement('img');
            img.src = dataURL;
            img.style.maxWidth = '100%';
            img.style.borderRadius = '8px';
            editorPage.appendChild(img);
        }
        calcPanel.classList.add('hidden');
    });

    // === WELCOME PAGE ===
    const welcomeModal = document.getElementById('welcome-modal');
    document.getElementById('btn-home')?.addEventListener('click', () => welcomeModal.classList.remove('hidden'));
    document.getElementById('close-welcome')?.addEventListener('click', () => welcomeModal.classList.add('hidden'));

    document.getElementById('welcome-new-notes')?.addEventListener('click', () => {
        document.getElementById('btn-new').click();
        document.querySelector('.mode-btn[data-mode="notes"]').click();
        welcomeModal.classList.add('hidden');
    });

    document.getElementById('welcome-new-math')?.addEventListener('click', () => {
        document.getElementById('btn-new').click();
        document.querySelector('.mode-btn[data-mode="math"]').click();
        welcomeModal.classList.add('hidden');
    });

    document.getElementById('welcome-open')?.addEventListener('click', () => {
        document.getElementById('btn-open').click();
        welcomeModal.classList.add('hidden');
    });

    document.getElementById('welcome-templates')?.addEventListener('click', () => {
        document.getElementById('btn-templates').click();
        welcomeModal.classList.add('hidden');
    });

    // Auto-show on first load
    if (!localStorage.getItem('mathNotesWelcomed')) {
        welcomeModal.classList.remove('hidden');
        localStorage.setItem('mathNotesWelcomed', 'true');
    }

    console.log('MathNotes: Ready');
});
