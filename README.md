# Richards & Law - AI Intake System

A professional, real-time intake dashboard and verification system for personal injury law firms.

## Features
- **Real-Time KPI Dashboard**: Live tracking of intakes, speed-to-lead, and SOL risk.
- **Verification UX**: Two-panel interface for paralegals to review AI-extracted data.
- **Webhook Integration**: Ready to receive updates from Google Sheets/n8n.
- **Premium Design**: Navy and Gold legal aesthetic with responsive layout.

## Railway.app Hosting (Recommended)

1. **GitHub**: Push your code to a New GitHub repository.
2. **Railway New Proj**: Click "New" > "GitHub Repository".
3. **Variables**: Set `BASE_URL` in the Variables tab to your public Railway domain.
4. **Deploy**: Railway will use the `start` script to launch your app.

## Webhook Endpoints
- **Update Feed**: `POST /webhook/sheets-update`
- **New Extraction**: `POST /webhook/new-case` (Multipart form-data: `fields` + `pdf`)
- **n8n Target Destination**: `https://n8n-latest-ydsf.onrender.com/webhook/hit`
