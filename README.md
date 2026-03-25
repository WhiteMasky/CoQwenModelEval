# CoQwen Model Evaluator

A web application for benchmarking AI models on document/image forgery detection. Supports **Qwen** (OpenAI-compatible) and **Google Gemini** APIs.

Includes a Python backend server that proxies API calls to avoid browser CORS issues.

---

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/WhiteMasky/CoQwenModelEval.git
cd CoQwenModelEval
pip install -r requirements.txt
```

### 2. Start the Server

```bash
python server.py
```

This starts a local server at **http://localhost:8765** that:
- Serves the frontend (HTML + JS)
- Proxies API calls to Qwen/Gemini (avoids CORS issues)

### 3. Open in Browser

Open **http://localhost:8765** in your browser. You should see a green "Backend connected" banner in the config section.

### 2. Configure Your Model

| Field | Example (Qwen) | Example (Gemini) |
|---|---|---|
| Provider | `Qwen (OpenAI-compatible)` | `Google Gemini` |
| Model Name | `qwen3.5-plus` | `gemini-2.5-pro` |
| API Endpoint | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `https://generativelanguage.googleapis.com/v1beta` |
| API Key | Your DashScope API key | Your Google AI API key |
| Concurrency | `3` (parallel requests) | `3` |
| Score Threshold | `60` (forgery if score >= 60%) | `60` |

### 3. Upload Test Samples

You have three options:

- **Upload a folder** — Click "Upload Folder" and select a directory containing `fake/` and `real/` subfolders
- **Upload a ZIP** — Click "Upload Files / ZIP" and select a `.zip` file with the same folder structure
- **Drag & drop** — Drag files, folders, or a ZIP directly onto the drop zone

#### Expected folder structure

```
YourTestData/
├── fake/
│   ├── image1.jpg
│   ├── image2.png
│   └── ...
└── real/
    ├── image1.jpg
    ├── image2.png
    └── ...
```

Images in the `fake/` folder are labeled as **forgery (ground truth = fake)**.
Images in the `real/` folder are labeled as **authentic (ground truth = real)**.

### 4. Run Evaluation

Click the **Start Evaluation** button. The app will:

1. Send each image to the selected model with a forensic analysis prompt
2. Parse the "Probability of Forgery" score from the model's response
3. Classify each image as fake or real based on the threshold

### 5. View Results

Three tabs are available after evaluation completes:

- **Overview** — Precision, Recall, F1-Score, FP Rate, Confusion Matrix, Score Distribution chart
- **Per-Image Details** — Filterable table showing each image's result; click "View" to see the model's full analysis and the image
- **Threshold Analysis** — Performance metrics across score thresholds (10%-90%) with an interactive line chart

### 6. Export

Click **Export Report** to download a Markdown report with all metrics, confusion matrix, threshold breakdown, and per-image results.

---

## How It Works

The app sends each test image to the AI model along with a structured forensic analysis prompt. The model returns an analysis report including a **"Probability of Forgery: X%"** score. The app parses this score and compares the prediction against the ground truth label (from the folder name) to compute standard classification metrics.

### Metrics

| Metric | Definition |
|---|---|
| **Precision** | TP / (TP + FP) — How many flagged images are actually forged |
| **Recall** | TP / (TP + FN) — How many forged images are correctly detected |
| **F1-Score** | Harmonic mean of Precision and Recall |
| **FP Rate** | FP / (FP + TN) — False alarm rate on authentic images |

### Architecture

- **Frontend**: Pure HTML + JS (TailwindCSS, ECharts, JSZip from CDN). No build step.
- **Backend** (`server.py`): FastAPI server that proxies API calls to Qwen/Gemini, avoiding CORS. Required for reliable operation.
- **GitHub Pages**: The frontend can also be opened directly in a browser, but API calls will fail due to CORS unless the backend is running.

### Why a Backend?

Browser security (CORS) blocks direct `fetch` calls from a web page to Qwen/Gemini API endpoints. The backend server acts as a same-origin proxy:

```
Browser → localhost:8765/api/evaluate → Qwen/Gemini API → response back
```

---

## Development

```bash
git clone https://github.com/WhiteMasky/CoQwenModelEval.git
cd CoQwenModelEval

# Serve locally
python3 -m http.server 8080
# Open http://localhost:8080
```

No dependencies to install. The app loads TailwindCSS, ECharts, and JSZip from CDN.

---

## License

MIT
