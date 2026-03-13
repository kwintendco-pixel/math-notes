/**
 * MathNotes - Scanner Integration (OpenCV + Tesseract)
 */

document.addEventListener('DOMContentLoaded', () => {
    const scanModal = document.getElementById('scanner-modal');
    const closeBtn = document.getElementById('close-scanner');
    const toolScan = document.getElementById('tool-scan');
    
    const uiControls = document.getElementById('scan-controls');
    const uiProcessing = document.getElementById('scan-processing-area');
    const uiReview = document.getElementById('scan-review-area');
    
    const inputUpload = document.getElementById('scan-upload');
    const inputCamera = document.getElementById('scan-camera');
    
    const statusText = document.getElementById('scan-status');
    const canvasOut = document.getElementById('scan-canvas-output');
    const resultText = document.getElementById('scan-result-text');
    
    const btnRetry = document.getElementById('scan-retry');
    const btnInsert = document.getElementById('scan-insert');

    toolScan.addEventListener('click', () => {
        scanModal.classList.remove('hidden');
        resetScannerUI();
    });

    closeBtn.addEventListener('click', () => scanModal.classList.add('hidden'));
    btnRetry.addEventListener('click', resetScannerUI);

    function resetScannerUI() {
        uiControls.classList.remove('hidden');
        uiProcessing.classList.add('hidden');
        uiReview.classList.add('hidden');
        resultText.value = '';
        inputUpload.value = '';
        inputCamera.value = '';
    }

    inputUpload.addEventListener('change', handleImageInput);
    inputCamera.addEventListener('change', handleImageInput);

    function handleImageInput(e) {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        
        uiControls.classList.add('hidden');
        uiProcessing.classList.remove('hidden');
        statusText.innerText = "Reading image...";

        if (file.type === 'application/pdf') {
            statusText.innerText = "Extracting PDF page...";
            extractPdfPage(file).then(processImageDetections).catch(handleError);
        } else {
            const reader = new FileReader();
            reader.onload = (event) => {
                const img = new Image();
                img.onload = () => {
                    const ctx = canvasOut.getContext('2d');
                    canvasOut.width = img.width;
                    canvasOut.height = img.height;
                    ctx.drawImage(img, 0, 0);
                    processImageDetections();
                };
                img.src = event.target.result;
            };
            reader.readAsDataURL(file);
        }
    }

    async function extractPdfPage(file) {
        return new Promise((resolve, reject) => {
            const fileReader = new FileReader();
            fileReader.onload = async function() {
                try {
                    const typedarray = new Uint8Array(this.result);
                    const pdf = await pdfjsLib.getDocument(typedarray).promise;
                    const page = await pdf.getPage(1);
                    const viewport = page.getViewport({scale: 2.0});
                    
                    canvasOut.width = viewport.width;
                    canvasOut.height = viewport.height;
                    
                    await page.render({
                        canvasContext: canvasOut.getContext('2d'),
                        viewport: viewport
                    }).promise;
                    resolve();
                } catch (e) {
                    reject(e);
                }
            };
            fileReader.readAsArrayBuffer(file);
        });
    }

    function handleError(err) {
        console.error("Scanner Error:", err);
        statusText.innerText = "Error: " + err.message;
        setTimeout(resetScannerUI, 3000);
    }

    async function processImageDetections() {
        try {
            statusText.innerText = "Initializing AI OCR Model (Math + Text)...";
            const worker = await Tesseract.createWorker({
                logger: m => {
                    if (m.status === 'recognizing text') statusText.innerText = `Scanning: ${Math.round(m.progress * 100)}%`;
                    else if (m.status) statusText.innerText = `Loading AI: ${m.status}`;
                }
            });
            await worker.loadLanguage('eng+equ');
            await worker.initialize('eng+equ');

            const { data: { text } } = await worker.recognize(canvasOut);
            await worker.terminate();
            
            const cleanedText = postProcessContent(text);
            
            uiProcessing.classList.add('hidden');
            uiReview.classList.remove('hidden');
            resultText.value = cleanedText;
        } catch (e) {
            handleError(e);
        }
    }

    function postProcessContent(rawText) {
        let txt = rawText.replace(/\n\s*\n/g, '\n\n');
        txt = txt.replace(/√/g, 'sq'); 
        txt = txt.replace(/∞/g, 'inf');
        txt = txt.replace(/∑/g, 'sum');
        txt = txt.replace(/∫/g, 'int');
        txt = txt.replace(/≤/g, '<=');
        txt = txt.replace(/≥/g, '>=');
        txt = txt.replace(/÷/g, '/');
        txt = txt.replace(/×/g, '*');
        return txt.trim();
    }

    btnInsert.addEventListener('click', () => {
        const finalText = resultText.value.trim();
        if (!finalText) {
            scanModal.classList.add('hidden');
            return;
        }

        const grid = document.getElementById('canvas-grid');
        const rect = grid.getBoundingClientRect();
        const centerX = (window.innerWidth / 2) - rect.left - 50;
        const centerY = (window.innerHeight / 2) - rect.top - 50;
        
        const event = new CustomEvent('insertScanData', { 
            detail: { x: centerX, y: centerY, text: finalText } 
        });
        document.dispatchEvent(event);
        
        scanModal.classList.add('hidden');
    });
});
