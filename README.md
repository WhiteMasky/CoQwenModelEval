# CoQwen Model Evaluator

A client-side web application for benchmarking AI models on document/image forgery detection. Supports **Qwen** (OpenAI-compatible) and **Google Gemini** APIs.

Live demo: **https://whitemasky.github.io/CoQwenModelEval/**

---

## Quick Start

### 1. Open the App

Visit the GitHub Pages URL above, or clone and open `index.html` locally:

```bash
git clone https://github.com/WhiteMasky/CoQwenModelEval.git
cd CoQwenModelEval
# Open index.html in any browser — no build step needed
open index.html
```

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

- **Pure client-side** — All API calls are made directly from the browser. No backend or server required.
- **No data leaves your browser** except to the API endpoint you configure.
- **GitHub Pages compatible** — Static HTML + JS, no build step.

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
