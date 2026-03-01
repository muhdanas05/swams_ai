const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');

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

const csvtojson = require('csvtojson');

app.get('/api/cases', async (req, res) => {
    try {
        const sheetUrl = 'https://docs.google.com/spreadsheets/d/1NdaLWcR-zm9iuskoHgJzazD3EReEXI-y5ILPc2Ja7JA/export?format=csv&gid=270289194';
        const response = await axios.get(sheetUrl, { responseType: 'text' });

        const rawJson = await csvtojson().fromString(response.data);

        // Map Google Sheet columns to Dashboard expected keys
        const mappedCases = rawJson.map(row => {
            let status = row.status ? row.status.toLowerCase() : 'pending';
            if (status === 'completed' || status === 'approved') status = 'approved';
            else if (status === 'rejected') status = 'rejected';
            else status = 'pending';

            return {
                case_id: row.euuid || row.matter_id || Date.now().toString(),
                client_plate_number: row.client_name || row.vehicle_info || 'Unknown',
                accident_date: row.accident_date,
                confidence_score: parseInt(row.confidence_score) || 0,
                status: status,
                created_at: row.created_at || new Date().toISOString(),
                approved_at: row.approved_at || null,
                sol_date: row.sol_date || null
            };
        });

        // Include pending cases still in the queue (not yet written to sheets)
        const pendingLocal = Object.values(pendingVerifications)
            .filter(pv => !pv.submitted)
            .map(pv => ({
                case_id: pv.case_id,
                client_plate_number: pv.client_name || pv.defendant_name || pv.client_plate_number || 'TBD',
                accident_date: pv.accident_date || 'N/A',
                confidence_score: parseInt(pv.confidence_score) || 0,
                status: 'pending',
                created_at: pv.created_at || new Date().toISOString(),
                approved_at: null,
                sol_date: pv.statute_of_limitations_date || null
            }));

        // Return combined list, with pending items at the top
        res.json([...pendingLocal, ...mappedCases]);
    } catch (err) {
        console.error("Error fetching Google Sheet:", err);
        res.status(500).json({ error: "Failed to fetch from Google Sheets" });
    }
});

app.get('/api/case/:id', (req, res) => {
    const data = pendingVerifications[req.params.id];
    if (!data || data.submitted) return res.status(404).json({ error: "Not found" });
    res.json(data);
});

app.post('/api/verify', async (req, res) => {
    // Add email_uuid from payload
    const { case_id, action, fields, paralegal_notes, matter_id, template_id, email_uuid } = req.body;
    const caseData = pendingVerifications[case_id];

    if (!caseData || caseData.submitted) return res.status(404).json({ error: "Invalid case or already submitted." });

    // Send to n8n webhook
    const n8nUrl = "https://n8n-latest-ydsf.onrender.com/webhook/hit";

    // Construct final payload
    const finalPayload = {
        case_id,
        action,
        matter_id,
        template_id,
        email_uuid,
        fields,
        paralegal_notes
    };

    try {
        console.log(`Pushing to n8n: ${n8nUrl}`, finalPayload);

        // Use axios instead of fetch to avoid issues on older Node versions
        const webhookResponse = await axios.post(n8nUrl, finalPayload, {
            headers: { 'Content-Type': 'application/json' },
            validateStatus: function (status) {
                return status < 500; // Resolve only if status is < 500
            }
        });

        if (webhookResponse.status >= 400) {
            throw new Error(`n8n responded with status ${webhookResponse.status}: ${JSON.stringify(webhookResponse.data)}`);
        }

        // Only mark submitted if webhook successfully fired
        caseData.submitted = true;

        // Add to dashboard list for visualization
        cases.unshift({
            ...fields,
            case_id,
            matter_id,
            template_id,
            email_uuid,
            status: action,
            created_at: caseData.created_at,
            approved_at: new Date().toISOString()
        });

        res.status(200).json({ status: "success" });
    } catch (error) {
        console.error("Failed to notify n8n:", error);
        res.status(500).json({ error: error.message || "Failed to notify downstream webhook." });
    }
});

const server = app.listen(PORT, () => console.log(`Server at http://localhost:${PORT}`));

server.on('error', (err) => {
    console.error('Server failed to start:', err);
    process.exit(1);
});
