// ============================================================
// CoQwen Model Evaluator — Core Application Logic
// ============================================================

// --- State ---
let samples = []; // {name, label:'fake'|'real', base64, mimeType}
let results = []; // {name, label, score, predicted, response, error}
let running = false;
let abortController = null;

// --- Forensic Prompt ---
const FORENSIC_PROMPT = `# Role
You are a senior Digital Image Forensics Expert, specializing in identifying traces of Photoshop compositing, AI generation (Deepfakes), object removal, and splicing. Your analysis is grounded in principles of physical optics, perspective geometry, and pixel-level anomaly detection.

# Task
Conduct a rigorous authenticity review of the provided image. Do not rush to a conclusion; instead, analyze visual evidence step-by-step according to the following procedure:

# Analysis Steps
1. **Lighting and Reflection Consistency**: Check if light source directions are uniform. Do the angles and softness/hardness of shadows match between the subject and the background? Do specular reflections (e.g., in eyes, glass, metal) align with environmental logic?
2. **Perspective and Geometric Logic**: Verify if vanishing points are consistent. Do object proportions adhere to the principle of "near large, far small"? Are straight lines (e.g., building edges, horizons) unnaturally curved or broken?
3. **Texture and Noise Distribution**: Observe if noise patterns are uniform across different regions of the image. Are there areas of excessive smoothing (skin retouching/blurring) or abnormal sharpening? Do skin or fabric textures exhibit repetition or a "waxy" artificial look?
4. **Edge and Blending Artifacts**: Carefully inspect object edges for halos, jagged lines, color bleeding, or unnatural blending with the background.
5. **Semantic and Logical Details**: Check if details such as text, logos, finger counts, clock times, and background pedestrians conform to real-world logic. Are there any garbled characters or structural errors?

# Output Format
Strictly output the analysis report in the following format:

---
### \\ud83d\\udd75\\ufe0f\\u200d\\u2642\\ufe0f Image Forensic Analysis Report

**1. Suspicious Area Localization**
- [Describe specific locations, e.g., left side of the subject's face, edges of background trees, etc.]

**2. Key Anomaly Evidence**
- **Lighting/Perspective**: [Describe inconsistencies found, or state "Normal" if none]
- **Texture/Noise**: [Describe noise distribution or texture anomalies, or state "Normal" if none]
- **Edges/Blending**: [Describe edge artifacts, or state "Normal" if none]
- **Semantic Logic**: [Describe illogical details, or state "Normal" if none]

**3. Comprehensive Confidence Score**
- Probability of Forgery: **[0% - 100%]**
- Primary Basis: [Summarize the core suspicion in one sentence]

**4. Final Conclusion**
- **[Authentic / Suspected Tampering / Highly Likely AI-Generated / Confirmed Forged]**
---

# Constraints
- Remain objective and rigorous; base all statements on visual evidence.
- If no obvious anomalies are detected, explicitly state "No obvious signs of tampering detected." Do not force findings where none exist.
- Distinguish between normal JPEG compression artifacts and malicious tampering traces.`;

// --- Provider Change ---
function onProviderChange() {
  const p = document.getElementById('cfg-provider').value;
  const endpointEl = document.getElementById('cfg-endpoint');
  const modelEl = document.getElementById('cfg-model');
  if (p === 'qwen') {
    endpointEl.placeholder = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
    modelEl.value = 'qwen3.5-plus';
  } else {
    endpointEl.placeholder = 'https://generativelanguage.googleapis.com/v1beta';
    modelEl.value = 'gemini-2.5-pro';
  }
}

// --- Drag & Drop ---
const dropZone = document.getElementById('drop-zone');
dropZone.addEventListener('click', (e) => {
  // Don't trigger if clicking inside an input or button (they handle their own clicks)
  if (e.target.closest('button') || e.target.closest('input')) return;
  document.getElementById('file-input').click();
});
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', async e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  // Check for folder drop via DataTransferItem API
  const items = e.dataTransfer.items;
  if (items && items.length > 0) {
    const entries = [];
    for (const item of items) {
      const entry = item.webkitGetAsEntry ? item.webkitGetAsEntry() : null;
      if (entry) entries.push(entry);
    }
    if (entries.some(e => e.isDirectory)) {
      await processDraggedEntries(entries);
      updateUploadSummary();
      return;
    }
  }
  handleFiles(e.dataTransfer.files);
});

async function processDraggedEntries(entries) {
  showUploadProgress('Reading dropped folder...');
  for (const entry of entries) {
    await traverseEntry(entry, '');
  }
  hideUploadProgress();
}

function traverseEntry(entry, pathPrefix) {
  return new Promise(resolve => {
    if (entry.isFile) {
      entry.file(async file => {
        if (file.type.startsWith('image/')) {
          const fullPath = (pathPrefix + '/' + file.name).toLowerCase();
          const label = fullPath.includes('/fake/') ? 'fake'
                      : fullPath.includes('/real/') ? 'real' : 'unknown';
          const b64 = await fileToBase64(file);
          samples.push({ name: file.name, label, base64: b64, mimeType: file.type });
        }
        resolve();
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      reader.readEntries(async subEntries => {
        for (const sub of subEntries) {
          await traverseEntry(sub, pathPrefix + '/' + entry.name);
        }
        resolve();
      });
    } else {
      resolve();
    }
  });
}

async function handleFileUpload(e) {
  const files = e.target.files;
  e.target.value = '';
  if (!files.length) return;
  await handleFiles(files);
}

async function handleFolderUpload(e) {
  const files = e.target.files;
  if (!files.length) return;
  showUploadProgress('Reading folder...');
  let processed = 0;
  const total = Array.from(files).filter(f => f.type.startsWith('image/')).length;
  for (const f of files) {
    if (!f.type.startsWith('image/')) continue;
    const path = (f.webkitRelativePath || f.name).toLowerCase();
    const label = path.includes('/fake/') || path.startsWith('fake/') ? 'fake'
                : path.includes('/real/') || path.startsWith('real/') ? 'real' : 'unknown';
    const b64 = await fileToBase64(f);
    samples.push({ name: f.name, label, base64: b64, mimeType: f.type });
    processed++;
    showUploadProgress(`Reading folder... ${processed}/${total} images`);
  }
  hideUploadProgress();
  updateUploadSummary();
  e.target.value = '';
}

async function handleFiles(files) {
  showUploadProgress('Processing files...');
  for (const f of files) {
    if (f.name.endsWith('.zip')) {
      await processZip(f);
    } else if (f.type.startsWith('image/')) {
      const b64 = await fileToBase64(f);
      samples.push({ name: f.name, label: 'unknown', base64: b64, mimeType: f.type });
    }
  }
  hideUploadProgress();
  updateUploadSummary();
}

async function processZip(file) {
  showUploadProgress('Extracting ZIP...');
  const zip = await JSZip.loadAsync(file);
  const entries = Object.keys(zip.files).filter(n => !zip.files[n].dir);
  const imageEntries = entries.filter(p => /\.(jpg|jpeg|png|webp)$/i.test(p));
  let processed = 0;
  const total = imageEntries.length;
  for (const path of imageEntries) {
    const lower = path.toLowerCase();
    const label = lower.includes('/fake/') || lower.startsWith('fake/') ? 'fake'
                : lower.includes('/real/') || lower.startsWith('real/') ? 'real' : 'unknown';
    const fname = path.split('/').pop();
    const blob = await zip.files[path].async('blob');
    const b64 = await blobToBase64(blob);
    const ext = fname.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    samples.push({ name: fname, label, base64: b64, mimeType: mime });
    processed++;
    if (processed % 5 === 0 || processed === total) {
      showUploadProgress(`Extracting ZIP... ${processed}/${total} images`);
      // Yield to UI thread
      await new Promise(r => setTimeout(r, 0));
    }
  }
}

function fileToBase64(file) {
  return new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result.split(',')[1]); rd.readAsDataURL(file); });
}
function blobToBase64(blob) {
  return new Promise(r => { const rd = new FileReader(); rd.onload = () => r(rd.result.split(',')[1]); rd.readAsDataURL(blob); });
}

function clearSamples() {
  samples = []; results = [];
  document.getElementById('upload-summary').classList.add('hidden');
  document.getElementById('sec-results').classList.add('hidden');
  document.getElementById('btn-run').disabled = true;
}

function showUploadProgress(msg) {
  const zone = document.getElementById('drop-zone');
  const inner = zone.querySelector('div');
  inner.innerHTML = `
    <div class="flex flex-col items-center gap-2">
      <svg class="animate-spin w-8 h-8 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
      </svg>
      <p class="font-medium text-gray-600">${msg}</p>
    </div>`;
}

function hideUploadProgress() {
  const zone = document.getElementById('drop-zone');
  const inner = zone.querySelector('div');
  inner.innerHTML = `
    <svg class="mx-auto mb-3 w-10 h-10 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"/></svg>
    <p class="font-medium text-gray-600">Drop files or folders here</p>
    <p class="text-xs mt-1">ZIP with fake/ &amp; real/ folders, individual images, or a folder with subfolders</p>`;
}

function updateUploadSummary() {
  const fk = samples.filter(s => s.label === 'fake').length;
  const rl = samples.filter(s => s.label === 'real').length;
  document.getElementById('fake-count').textContent = `${fk} fake`;
  document.getElementById('real-count').textContent = `${rl} real`;
  document.getElementById('total-count').textContent = `${samples.length} total`;
  document.getElementById('upload-summary').classList.remove('hidden');
  document.getElementById('btn-run').disabled = samples.length === 0;
}

// --- API Calls ---
// Detect if backend proxy is available (server.py running)
let useProxy = null; // null = not yet checked, true/false after check

async function checkProxy() {
  if (useProxy !== null) return useProxy;
  try {
    const resp = await fetch('/api/evaluate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    // 400 means the endpoint exists (just missing params)
    useProxy = resp.status === 400 || resp.ok;
  } catch {
    useProxy = false;
  }
  return useProxy;
}

async function callProxy(base64, mimeType, provider, endpoint, model, apiKey, signal) {
  const resp = await fetch('/api/evaluate', {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider, model, endpoint, apiKey,
      imageBase64: base64,
      mimeType,
      prompt: FORENSIC_PROMPT
    })
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
    throw new Error(err.detail || `Proxy error ${resp.status}`);
  }
  const data = await resp.json();
  return data.text;
}

async function callQwen(base64, mimeType, endpoint, model, apiKey, signal) {
  const url = `${endpoint.replace(/\/$/,'')}/chat/completions`;
  const body = {
    model,
    messages: [
      { role: 'user', content: [
        { type: 'text', text: FORENSIC_PROMPT },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } }
      ]}
    ],
    max_tokens: 2048
  };
  const resp = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.choices[0].message.content;
}

async function callGemini(base64, mimeType, endpoint, model, apiKey, signal) {
  const url = `${endpoint.replace(/\/$/,'')}/models/${model}:generateContent?key=${apiKey}`;
  const body = {
    contents: [{ parts: [
      { text: FORENSIC_PROMPT },
      { inline_data: { mime_type: mimeType, data: base64 } }
    ]}],
    generationConfig: { maxOutputTokens: 2048 }
  };
  const resp = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!resp.ok) throw new Error(`API ${resp.status}: ${await resp.text()}`);
  const data = await resp.json();
  return data.candidates[0].content.parts[0].text;
}

// --- Score Parsing ---
function parseScore(text) {
  // Look for "Probability of Forgery: **XX%**" pattern
  const patterns = [
    /Probability\s+of\s+Forgery[:\s]*\*{0,2}\s*(\d{1,3})\s*%/i,
    /Forgery[:\s]*\*{0,2}\s*(\d{1,3})\s*%/i,
    /(\d{1,3})\s*%/g
  ];
  for (const pat of patterns) {
    const m = pat.exec(text);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function parseConclusion(text) {
  const lower = text.toLowerCase();
  if (lower.includes('confirmed forged')) return 'forgery';
  if (lower.includes('highly likely ai-generated')) return 'forgery';
  if (lower.includes('suspected tampering')) return 'forgery';
  if (lower.includes('authentic')) return 'authentic';
  return null;
}

// --- Evaluation Engine ---
async function startEvaluation() {
  const provider = document.getElementById('cfg-provider').value;
  const model = document.getElementById('cfg-model').value;
  const endpoint = document.getElementById('cfg-endpoint').value || document.getElementById('cfg-endpoint').placeholder;
  const apiKey = document.getElementById('cfg-key').value;
  const concurrency = parseInt(document.getElementById('cfg-concurrency').value) || 3;
  const threshold = parseInt(document.getElementById('cfg-threshold').value) || 60;

  if (!apiKey) { alert('Please enter an API key.'); return; }
  if (samples.length === 0) { alert('Please upload test samples first.'); return; }

  running = true;
  abortController = new AbortController();
  results = [];

  document.getElementById('btn-run').classList.add('hidden');
  document.getElementById('btn-stop').classList.remove('hidden');
  document.getElementById('log-area').classList.remove('hidden');
  document.getElementById('log-area').innerHTML = '';
  document.getElementById('sec-results').classList.add('hidden');
  setStatus('running', 'Running...');

  // Check if backend proxy is available
  const proxyAvailable = await checkProxy();
  if (proxyAvailable) {
    log('Backend proxy detected — API calls will go through server (no CORS issues)');
  } else {
    log('No backend proxy — calling APIs directly from browser (may fail due to CORS)');
    log('Tip: Run "python server.py" for reliable API calls');
  }

  // Choose call function
  let callFn;
  if (proxyAvailable) {
    callFn = (base64, mimeType, _endpoint, _model, _apiKey, signal) =>
      callProxy(base64, mimeType, provider, endpoint, model, apiKey, signal);
  } else {
    callFn = provider === 'gemini' ? callGemini : callQwen;
  }

  let completed = 0;
  const total = samples.length;

  const semaphore = { count: 0, queue: [] };
  function acquire() {
    return new Promise(resolve => {
      if (semaphore.count < concurrency) { semaphore.count++; resolve(); }
      else semaphore.queue.push(resolve);
    });
  }
  function release() {
    if (semaphore.queue.length > 0) semaphore.queue.shift()();
    else semaphore.count--;
  }

  const tasks = samples.map(async (sample, idx) => {
    await acquire();
    if (!running) { release(); return; }
    try {
      log(`[${idx+1}/${total}] Processing ${sample.name}...`);
      const response = await callFn(sample.base64, sample.mimeType, endpoint, model, apiKey, abortController.signal);
      const score = parseScore(response);
      const conclusionLabel = parseConclusion(response);
      let predicted;
      if (score !== null) {
        predicted = score >= threshold ? 'fake' : 'real';
      } else if (conclusionLabel) {
        predicted = conclusionLabel === 'forgery' ? 'fake' : 'real';
      } else {
        predicted = 'unknown';
      }
      results.push({ name: sample.name, label: sample.label, score, predicted, response, error: null });
      log(`  -> ${sample.name}: score=${score}%, predicted=${predicted}, truth=${sample.label}`);
    } catch (err) {
      if (err.name === 'AbortError') { release(); return; }
      results.push({ name: sample.name, label: sample.label, score: null, predicted: 'error', response: '', error: err.message });
      log(`  !! ${sample.name}: ERROR - ${err.message}`);
    }
    completed++;
    updateProgress(completed, total);
    release();
  });

  await Promise.all(tasks);

  running = false;
  document.getElementById('btn-run').classList.remove('hidden');
  document.getElementById('btn-stop').classList.add('hidden');
  setStatus('done', 'Completed');
  updateProgress(completed, total);

  if (results.length > 0) renderResults(threshold, provider, model);
}

function stopEvaluation() {
  running = false;
  if (abortController) abortController.abort();
  document.getElementById('btn-run').classList.remove('hidden');
  document.getElementById('btn-stop').classList.add('hidden');
  setStatus('stopped', 'Stopped');
}

function log(msg) {
  const area = document.getElementById('log-area');
  const ts = new Date().toLocaleTimeString();
  area.innerHTML += `<div>[${ts}] ${escapeHtml(msg)}</div>`;
  area.scrollTop = area.scrollHeight;
}

function updateProgress(done, total) {
  const pct = total > 0 ? Math.round(done / total * 100) : 0;
  document.getElementById('progress-label').textContent = `${done} / ${total}`;
  document.getElementById('progress-pct').textContent = `${pct}%`;
  document.getElementById('progress-fill').style.width = `${pct}%`;
}

function setStatus(type, text) {
  const dot = document.getElementById('status-dot');
  document.getElementById('status-text').textContent = text;
  dot.className = 'w-2 h-2 rounded-full ' + ({
    running: 'bg-amber-500 animate-pulse',
    done: 'bg-emerald-500',
    stopped: 'bg-red-500',
    ready: 'bg-gray-300'
  }[type] || 'bg-gray-300');
}

// --- Results Rendering ---
function renderResults(threshold, provider, model) {
  document.getElementById('sec-results').classList.remove('hidden');
  document.getElementById('sec-results').classList.add('fade-in');

  const valid = results.filter(r => r.label !== 'unknown' && r.predicted !== 'error' && r.predicted !== 'unknown');
  const tp = valid.filter(r => r.label === 'fake' && r.predicted === 'fake').length;
  const fn = valid.filter(r => r.label === 'fake' && r.predicted === 'real').length;
  const fp = valid.filter(r => r.label === 'real' && r.predicted === 'fake').length;
  const tn = valid.filter(r => r.label === 'real' && r.predicted === 'real').length;

  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
  const fpRate = fp + tn > 0 ? fp / (fp + tn) : 0;

  // Header
  document.getElementById('report-header').innerHTML =
    `Provider: <strong>${provider}</strong> &nbsp;|&nbsp; Model: <strong>${model}</strong> &nbsp;|&nbsp; Generated: <strong>${new Date().toISOString().slice(0,19).replace('T',' ')}</strong> &nbsp;|&nbsp; Threshold: <strong>${threshold}%</strong>`;

  // Metrics grid
  const grid = document.getElementById('metrics-grid');
  grid.innerHTML = [
    metricCard('Precision', precision.toFixed(4), 'indigo'),
    metricCard('Recall', recall.toFixed(4), 'emerald'),
    metricCard('F1-Score', f1.toFixed(4), 'cyan'),
    metricCard('FP Rate', fpRate.toFixed(4), 'red'),
    metricCard('Total', valid.length, 'gray')
  ].join('');

  // Confusion matrix
  renderConfusionMatrix(tp, fn, fp, tn);

  // Score distribution chart
  renderScoreChart();

  // Detail table
  renderDetailTable();

  // Threshold breakdown
  renderThresholdTable();
}

function metricCard(label, value, color) {
  return `<div class="bg-gray-50 border border-gray-100 rounded-lg p-4 text-center">
    <div class="text-xs text-gray-400 mb-1">${label}</div>
    <div class="text-xl font-bold text-${color}-600">${value}</div>
  </div>`;
}

function renderConfusionMatrix(tp, fn, fp, tn) {
  document.getElementById('confusion-matrix').innerHTML = `
    <table class="w-full">
      <thead><tr><th></th><th class="text-center text-red-600 text-xs">Pred: FORGERY</th><th class="text-center text-emerald-600 text-xs">Pred: AUTHENTIC</th></tr></thead>
      <tbody>
        <tr><td class="text-red-600 text-xs font-medium">True: FORGERY</td>
          <td class="cm-cell bg-red-50 text-red-700 border border-red-100">${tp} (TP)</td>
          <td class="cm-cell bg-amber-50 text-amber-700 border border-amber-100">${fn} (FN)</td></tr>
        <tr><td class="text-emerald-600 text-xs font-medium">True: AUTHENTIC</td>
          <td class="cm-cell bg-amber-50 text-amber-700 border border-amber-100">${fp} (FP)</td>
          <td class="cm-cell bg-emerald-50 text-emerald-700 border border-emerald-100">${tn} (TN)</td></tr>
      </tbody>
    </table>`;
}

function renderScoreChart() {
  const chart = echarts.init(document.getElementById('score-chart'));
  const fakeScores = results.filter(r => r.label === 'fake' && r.score !== null).map(r => r.score);
  const realScores = results.filter(r => r.label === 'real' && r.score !== null).map(r => r.score);

  const bins = [0,10,20,30,40,50,60,70,80,90,100];
  function histogram(scores) {
    const counts = new Array(bins.length - 1).fill(0);
    scores.forEach(s => { const i = Math.min(Math.floor(s / 10), 9); counts[i]++; });
    return counts;
  }

  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['Fake (GT)', 'Real (GT)'], textStyle: { color: '#6b7280' } },
    xAxis: { type: 'category', data: bins.slice(0,-1).map(b => `${b}-${b+10}%`), axisLabel: { color: '#9ca3af', fontSize: 10 } },
    yAxis: { type: 'value', axisLabel: { color: '#9ca3af' }, splitLine: { lineStyle: { color: '#f3f4f6' } } },
    series: [
      { name: 'Fake (GT)', type: 'bar', data: histogram(fakeScores), itemStyle: { color: '#ef4444' }, barGap: '10%' },
      { name: 'Real (GT)', type: 'bar', data: histogram(realScores), itemStyle: { color: '#22c55e' } }
    ],
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    backgroundColor: 'transparent'
  });
  window.addEventListener('resize', () => chart.resize());
}

function renderDetailTable() {
  const tbody = document.getElementById('detail-tbody');
  tbody.innerHTML = results.map((r, i) => `
    <tr class="${r.label === r.predicted ? '' : 'bg-red-50'}">
      <td class="text-gray-400">${i+1}</td>
      <td class="font-mono text-xs max-w-[200px] truncate" title="${escapeHtml(r.name)}">${escapeHtml(r.name)}</td>
      <td><span class="badge ${r.label==='fake'?'badge-red':'badge-green'}">${r.label}</span></td>
      <td><span class="badge ${r.predicted==='fake'?'badge-red':r.predicted==='real'?'badge-green':'badge-yellow'}">${r.predicted}</span></td>
      <td class="font-mono">${r.score !== null ? r.score + '%' : 'N/A'}</td>
      <td>${r.label === r.predicted ? '<span class="text-emerald-400">&#10003;</span>' : '<span class="text-red-400">&#10007;</span>'}</td>
      <td><button class="text-indigo-600 hover:text-indigo-500 text-xs" onclick="showDetail(${i})">View</button></td>
    </tr>`).join('');
}

function renderThresholdTable() {
  const scored = results.filter(r => r.label !== 'unknown' && r.score !== null);
  const total = scored.length;
  const tbody = document.getElementById('threshold-tbody');
  const thresholds = [10,20,30,40,50,60,70,80,90];
  const rows = [];

  thresholds.forEach(t => {
    const tp = scored.filter(r => r.label === 'fake' && r.score >= t).length;
    const fn = scored.filter(r => r.label === 'fake' && r.score < t).length;
    const fp = scored.filter(r => r.label === 'real' && r.score >= t).length;
    const tn = scored.filter(r => r.label === 'real' && r.score < t).length;
    const prec = tp + fp > 0 ? (tp / (tp + fp)) : 0;
    const rec = tp + fn > 0 ? (tp / (tp + fn)) : 0;
    const f1 = prec + rec > 0 ? (2 * prec * rec / (prec + rec)) : 0;
    const fpr = fp + tn > 0 ? (fp / (fp + tn)) : 0;
    rows.push({ t, prec, rec, f1, fpr, total, tp, fn, fp, tn });
  });

  tbody.innerHTML = rows.map(r => `<tr>
    <td class="font-mono">&gt;= ${r.t}</td>
    <td>${r.prec.toFixed(4)}</td><td>${r.rec.toFixed(4)}</td><td>${r.f1.toFixed(4)}</td>
    <td>${r.fpr.toFixed(4)}</td><td>${r.total}</td>
    <td>${r.tp}</td><td>${r.fn}</td><td>${r.fp}</td><td>${r.tn}</td>
  </tr>`).join('');

  // Threshold chart
  const chart = echarts.init(document.getElementById('threshold-chart'));
  chart.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['Precision', 'Recall', 'F1-Score'], textStyle: { color: '#6b7280' } },
    xAxis: { type: 'category', data: thresholds.map(t => `>=${t}`), axisLabel: { color: '#9ca3af' } },
    yAxis: { type: 'value', min: 0, max: 1, axisLabel: { color: '#9ca3af' }, splitLine: { lineStyle: { color: '#f3f4f6' } } },
    series: [
      { name: 'Precision', type: 'line', data: rows.map(r => r.prec.toFixed(4)), itemStyle: { color: '#818cf8' } },
      { name: 'Recall', type: 'line', data: rows.map(r => r.rec.toFixed(4)), itemStyle: { color: '#34d399' } },
      { name: 'F1-Score', type: 'line', data: rows.map(r => r.f1.toFixed(4)), itemStyle: { color: '#fbbf24' } }
    ],
    grid: { left: 40, right: 20, top: 40, bottom: 30 },
    backgroundColor: 'transparent'
  });
  window.addEventListener('resize', () => chart.resize());
}

// --- Tab Switching ---
function switchTab(name, btn) {
  document.querySelectorAll('[id^="tab-"]').forEach(el => el.classList.add('hidden'));
  document.getElementById('tab-' + name).classList.remove('hidden');
  document.querySelectorAll('.tab').forEach(t => { t.classList.remove('tab-active'); t.classList.add('tab-inactive'); });
  btn.classList.remove('tab-inactive'); btn.classList.add('tab-active');
}

// --- Detail Modal ---
function showDetail(idx) {
  const r = results[idx];
  const s = samples.find(s => s.name === r.name);
  document.getElementById('modal-title').textContent = r.name;
  document.getElementById('modal-image').innerHTML = s ?
    `<img src="data:${s.mimeType};base64,${s.base64}" class="max-h-64 rounded-lg">` : '';
  document.getElementById('modal-response').textContent = r.response || r.error || 'No response';
  document.getElementById('detail-modal').classList.remove('hidden');
}
function closeModal() { document.getElementById('detail-modal').classList.add('hidden'); }

// --- Filter ---
function filterDetails() {
  const q = document.getElementById('detail-filter').value.toLowerCase();
  document.querySelectorAll('#detail-tbody tr').forEach(tr => {
    tr.style.display = tr.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

// --- Export Report ---
function exportReport() {
  const provider = document.getElementById('cfg-provider').value;
  const model = document.getElementById('cfg-model').value;
  const threshold = parseInt(document.getElementById('cfg-threshold').value) || 60;
  const scored = results.filter(r => r.label !== 'unknown' && r.score !== null);
  const total = scored.length;

  const tp = scored.filter(r => r.label === 'fake' && r.score >= threshold).length;
  const fn = scored.filter(r => r.label === 'fake' && r.score < threshold).length;
  const fp = scored.filter(r => r.label === 'real' && r.score >= threshold).length;
  const tn = scored.filter(r => r.label === 'real' && r.score < threshold).length;
  const prec = tp+fp>0 ? (tp/(tp+fp)) : 0;
  const rec = tp+fn>0 ? (tp/(tp+fn)) : 0;
  const f1 = prec+rec>0 ? (2*prec*rec/(prec+rec)) : 0;
  const fpr = fp+tn>0 ? (fp/(fp+tn)) : 0;

  let md = `# Document Forgery Detection Evaluation Report\n\n`;
  md += `Provider: ${provider}  \nModel: ${model}  \nGenerated: ${new Date().toISOString().slice(0,19).replace('T',' ')}\n\n`;
  md += `## 1. Classification Performance\n\n`;
  md += `| Metric | Value |\n|---|---|\n`;
  md += `| Precision | ${prec.toFixed(4)} |\n| Recall | ${rec.toFixed(4)} |\n| F1-Score | ${f1.toFixed(4)} |\n| FP Rate | ${fpr.toFixed(4)} |\n| Total Samples | ${total} |\n\n`;
  md += `### Confusion Matrix\n\n`;
  md += `| | Pred: FORGERY | Pred: AUTHENTIC |\n|---|---|---|\n`;
  md += `| True: FORGERY | ${tp} (TP) | ${fn} (FN) |\n| True: AUTHENTIC | ${fp} (FP) | ${tn} (TN) |\n\n`;
  md += `## 2. Score-based Performance Breakdown\n\n`;
  md += `| Threshold | Precision | Recall | F1 | FP Rate | Total | TP | FN | FP | TN |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  [10,20,30,40,50,60,70,80,90].forEach(t => {
    const tp2 = scored.filter(r => r.label==='fake' && r.score>=t).length;
    const fn2 = scored.filter(r => r.label==='fake' && r.score<t).length;
    const fp2 = scored.filter(r => r.label==='real' && r.score>=t).length;
    const tn2 = scored.filter(r => r.label==='real' && r.score<t).length;
    const p2 = tp2+fp2>0?(tp2/(tp2+fp2)):0;
    const r2 = tp2+fn2>0?(tp2/(tp2+fn2)):0;
    const f2 = p2+r2>0?(2*p2*r2/(p2+r2)):0;
    const fr2 = fp2+tn2>0?(fp2/(fp2+tn2)):0;
    md += `| >= ${t} | ${p2.toFixed(4)} | ${r2.toFixed(4)} | ${f2.toFixed(4)} | ${fr2.toFixed(4)} | ${total} | ${tp2} | ${fn2} | ${fp2} | ${tn2} |\n`;
  });

  md += `\n## 3. Per-Image Results\n\n`;
  md += `| # | Filename | Truth | Predicted | Score | Match |\n|---|---|---|---|---|---|\n`;
  results.forEach((r,i) => {
    md += `| ${i+1} | ${r.name} | ${r.label} | ${r.predicted} | ${r.score !== null ? r.score+'%' : 'N/A'} | ${r.label===r.predicted?'Y':'N'} |\n`;
  });

  const blob = new Blob([md], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `evaluation_report_${model.replace(/[^a-z0-9]/gi,'_')}.md`; a.click();
  URL.revokeObjectURL(url);
}

// --- Utilities ---
function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// --- Backend detection on load ---
(async function detectBackend() {
  const el = document.getElementById('backend-status');
  const available = await checkProxy();
  el.classList.remove('hidden');
  if (available) {
    el.className = 'mt-4 px-4 py-3 rounded-lg text-sm bg-emerald-50 text-emerald-700 border border-emerald-200';
    el.innerHTML = '<strong>Backend connected</strong> — API calls will be proxied through the local server (no CORS issues).';
  } else {
    el.className = 'mt-4 px-4 py-3 rounded-lg text-sm bg-amber-50 text-amber-700 border border-amber-200';
    el.innerHTML = '<strong>No backend detected</strong> — API calls go directly from browser (may fail due to CORS). Run <code class="bg-amber-100 px-1 rounded">python server.py</code> for reliable operation.';
  }
})();
