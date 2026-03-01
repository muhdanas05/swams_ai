const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const multer = require('multer');
const fs = require('fs');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Setup storage for PDFs
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        const uploadDir = 'public/uploads';
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

app.use(cors());
app.use(bodyParser.json());
app.use(express.static('public'));

// In-memory store
let cases = [];
let pendingVerifications = {};

// 1. New Case Webhook: Triggered by n8n
// Accepts multipart/form-data with fields and a "pdf" file
app.post('/webhook/new-case', upload.single('pdf'), (req, res) => {
    let rawFields = {};
    try {
        console.log("Incoming Webhook keys:", Object.keys(req.body));

        const looseJsonParse = (str) => {
            if (typeof str !== 'string') return str;
            let s = str.replace(/([\]}0-9a-zA-Z_"])\s*\n\s*"/g, '$1,\n"').replace(/,\s*([\]}])/g, '$1');
            try { return JSON.parse(s); } catch (e) {
                try { return (new Function('return ' + s))(); } catch (err) { return str; }
            }
        };

        let inputData = req.body;

        // Common keys check
        if (req.body.fields) inputData = req.body.fields;
        else if (req.body.data) inputData = req.body.data;
        else if (req.body.payload) inputData = req.body.payload;

        if (typeof inputData === 'string') {
            inputData = looseJsonParse(inputData);
        }

        // Aggressive search for JSON strings in multipart form data
        if (typeof inputData !== 'object' || inputData === null) {
            if (Object.keys(req.body).length > 0) {
                for (const val of Object.values(req.body)) {
                    if (typeof val === 'string' && (val.trim().startsWith('[') || val.trim().startsWith('{'))) {
                        let parsed = looseJsonParse(val);
                        if (typeof parsed === 'object' && parsed !== null) {
                            inputData = parsed;
                            break;
                        }
                    }
                }
            }
        }

        rawFields = Array.isArray(inputData) ? inputData[0] : inputData;
        if (typeof rawFields !== 'object' || rawFields === null) rawFields = {};
    } catch (e) {
        console.error("Payload parsing error:", e);
        rawFields = req.body || {};
    }

    const case_id = rawFields.case_id || Date.now().toString();
    const pdfPath = req.file ? `/uploads/${req.file.filename}` : null;

    // Extract confidence from either the top level body or the nested fields
    const confidence = req.body.confidence_score || (rawFields ? rawFields.confidence_score : null);

    // Store in verification queue
    pendingVerifications[case_id] = {
        ...rawFields,
        case_id,
        pdf_url: pdfPath,
        confidence_score: confidence,
        submitted: false,
        created_at: new Date().toISOString()
    };

    const host = req.get('host');
    const protocol = req.protocol || 'http';
    const baseUrl = process.env.BASE_URL || `${protocol}://${host}`;
    const form_url = `${baseUrl}/verify.html?id=${case_id}`;

    console.log(`New case created: ${case_id}. Form URL: ${form_url}`);
    res.status(200).json({ form_url });
});

// 2. Dashboard Webhook: Receive full sheet update
app.post('/webhook/sheets-update', (req, res) => {
    const updatedCases = req.body;
    if (Array.isArray(updatedCases)) {
        cases = updatedCases;
        res.status(200).json({ message: "Dashboard updated" });
    } else {
        res.status(400).json({ error: "Invalid payload" });
    }
});

app.get('/api/cases', (req, res) => res.json(cases));

app.get('/api/case/:id', (req, res) => {
    const data = pendingVerifications[req.params.id];
    if (!data || data.submitted) return res.status(404).json({ error: "Not found" });
    res.json(data);
});

app.post('/api/verify', async (req, res) => {
    const { case_id, action, fields, paralegal_notes, matter_id, template_id } = req.body;
    const caseData = pendingVerifications[case_id];

    if (!caseData || caseData.submitted) return res.status(404).json({ error: "Invalid case" });

    caseData.submitted = true;

    // Send to n8n
    const n8nUrl = "https://n8n-latest-ydsf.onrender.com/webhook/hit";

    try {
        // Log explicitly with new metadata fields
        console.log(`Pushing to n8n: ${n8nUrl}`, { case_id, action, matter_id, template_id, fields, paralegal_notes });

        // Add to dashboard list for visualization
        cases.unshift({
            ...fields,
            case_id,
            matter_id,
            template_id,
            status: action,
            created_at: caseData.created_at,
            approved_at: new Date().toISOString()
        });

        res.status(200).json({ status: "success" });
    } catch (error) {
        res.status(500).json({ error: "Failed to notify n8n" });
    }
});

const server = app.listen(PORT, () => console.log(`Server at http://localhost:${PORT}`));

server.on('error', (err) => {
    console.error('Server failed to start:', err);
    process.exit(1);
});
