# CoQwen Model Evaluator

A client-side web application for evaluating AI models on document/image forgery detection tasks.

## Features

- **Multi-model support**: Qwen (OpenAI-compatible API) and Google Gemini
- **Batch evaluation**: Upload ZIP files with `fake/` and `real/` folders
- **Comprehensive metrics**: Precision, Recall, F1-Score, Confusion Matrix
- **Threshold analysis**: Performance breakdown across score thresholds (10-90%)
- **Score distribution charts**: Visual comparison of fake vs real score distributions
- **Per-image detail view**: Inspect each model response individually
- **Export**: Download evaluation report as Markdown
- **Pure client-side**: No backend needed, runs entirely in the browser

## Usage

1. Select your model provider (Qwen or Gemini) and enter API credentials
2. Upload a ZIP file containing test images in `fake/` and `real/` subfolders
3. Click "Start Evaluation" to begin processing
4. View results in the Overview, Per-Image Details, and Threshold Analysis tabs

## Deployment

This app is deployed on GitHub Pages. No build step required — it's pure HTML + JS.

## Test Data Format

```
test_samples.zip
├── fake/
│   ├── image1.jpg
│   ├── image2.png
│   └── ...
└── real/
    ├── image1.jpg
    ├── image2.png
    └── ...
```
