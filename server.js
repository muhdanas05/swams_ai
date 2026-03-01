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
    let rawFields;
    try {
        // Handle n8n sending fields as a JSON string or individual fields
        rawFields = req.body.fields ? JSON.parse(req.body.fields) : req.body;
        // If n8n sends an array, take the first element
        if (Array.isArray(rawFields)) rawFields = rawFields[0];
    } catch (e) {
        rawFields = req.body;
    }

    const case_id = rawFields.case_id || Date.now().toString();
    const pdfPath = req.file ? `/uploads/${req.file.filename}` : null;

    // Store in verification queue
    pendingVerifications[case_id] = {
        ...rawFields,
        case_id,
        pdf_url: pdfPath,
        confidence_score: req.body.confidence_score || 85,
        submitted: false,
        created_at: new Date().toISOString()
    };

    const baseUrl = process.env.BASE_URL || `http://localhost:${PORT}`;
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
    const { case_id, action, fields, paralegal_notes } = req.body;
    const caseData = pendingVerifications[case_id];

    if (!caseData || caseData.submitted) return res.status(404).json({ error: "Invalid case" });

    caseData.submitted = true;

    // Send to n8n
    const n8nUrl = "https://n8n-latest-ydsf.onrender.com/webhook/hit";

    try {
        // In a real environment, you'd use node-fetch or axios here.
        // For this demo, we'll simulate the successful push to n8n.
        console.log(`Pushing to n8n: ${n8nUrl}`, { case_id, action, fields });

        // Add to dashboard list for visualization
        cases.unshift({
            ...fields,
            case_id,
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
