const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const dotenv = require('dotenv');
const multer = require('multer');
const fs = require('fs');
const axios = require('axios');
const FormData = require('form-data');

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

app.post('/api/upload-test', upload.single('pdf'), async (req, res) => {
    try {
        if (!req.file) throw new Error("No PDF file provided.");

        const LLAMAPARSE_KEY = process.env.LLAMAPARSE_KEY;
        const GEMINI_KEY = process.env.GEMINI_KEY;

        if (!LLAMAPARSE_KEY || !GEMINI_KEY) {
            throw new Error("API keys for AI extraction are not configured.");
        }

        // 1. Upload to LlamaParse
        const fData = new FormData();
        fData.append('file', fs.createReadStream(req.file.path));
        fData.append('configuration', JSON.stringify({ tier: 'agentic', version: 'latest' }));

        const uploadRes = await axios.post('https://api.cloud.llamaindex.ai/api/v2/parse/upload', fData, {
            headers: { 'Authorization': `Bearer ${LLAMAPARSE_KEY}`, ...fData.getHeaders() }
        });

        const jobId = uploadRes.data.id;
        let completed = false;
        let markdownText = "";

        // Poll LlamaParse
        while (!completed) {
            await new Promise(r => setTimeout(r, 3000));
            const statRes = await axios.get(`https://api.cloud.llamaindex.ai/api/v2/parse/${jobId}?expand=text,markdown`, {
                headers: { 'Authorization': `Bearer ${LLAMAPARSE_KEY}` }
            });

            const jobStatus = statRes.data.status || statRes.data.job?.status;

            if (jobStatus === 'SUCCESS' || jobStatus === 'COMPLETED') {
                completed = true;
                if (statRes.data.markdown) {
                    markdownText = statRes.data.markdown;
                } else if (statRes.data.text) {
                    markdownText = statRes.data.text;
                } else {
                    markdownText = JSON.stringify(statRes.data);
                }
            } else if (jobStatus === 'FAILED') {
                throw new Error("LlamaParse job failed: " + (statRes.data.job?.error_message || "Unknown error"));
            }
        }

        // 2. Pass to Gemini
        const systemPrompt = `You are a legal data extraction assistant for a personal injury law firm. Your job is to extract structured data from parsed police report text and return it as clean JSON only — no preamble, no explanation, no markdown backticks.

Always return this exact JSON structure:
{
  "accident_date": "YYYY-MM-DD",
  "accident_location": "",
  "accident_description": "",
  "defendant_name": "",
  "client_plate_number": "",
  "client_vehicle_year_and_make": "",
  "client_gender": "",
  "number_of_injured": 0,
  "statute_of_limitations_date": "YYYY-MM-DD",
  "confidence": 86
}

Rules:
- The CLIENT is the plaintiff — identified by the first name in the filename before "_v_". Find this person in the report and extract their details.
- The DEFENDANT is the opposing party — identified by the name after "_v_" in the filename. Find this person in the report and extract their name.
- defendant_name should be the full name formatted as "FIRSTNAME LASTNAME"
- accident_date and statute_of_limitations_date must be in YYYY-MM-DD format
- statute_of_limitations_date is always exactly 8 years after accident_date
- accident_description should be a clean, readable 2-3 sentence summary written in plain English from the officer's notes — do not copy raw report text
- client_plate_number is the plate number of the vehicle the client was driving or occupying. If the client is a pedestrian or bicyclist, set this to null
- client_vehicle_year_and_make is the year and make of the client's vehicle (e.g. "2010 FREIGHTLINER"). If the client is a pedestrian or bicyclist, set this to null
- client_gender should be "Male", "Female", or "Unknown" — determine from the Sex field next to the client's name in the report
- number_of_injured is the total number of injured persons recorded in the report as an integer
- confidence is an integer from 0 to 100 reflecting how clearly and completely the data could be extracted from this specific report
- If a field cannot be found, use null
- Return JSON only, nothing else`;

        const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`;
        const geminiRes = await axios.post(geminiUrl, {
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: `Filename: ${req.file.originalname}\n\nReport Text:\n${markdownText}` }] }],
            generationConfig: { response_mime_type: "application/json" }
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        const gContent = geminiRes.data.candidates[0].content.parts[0].text;
        const extracted = JSON.parse(gContent);

        // 3. Create Case
        const caseId = 'test_' + Date.now().toString(36);
        const dataForVerify = {
            case_id: caseId,
            matter_id: "TEST",
            pdf_url: `/uploads/${req.file.filename}`,
            fields: extracted,
            client_name: req.file.originalname.split('_v_')[0].replace(".pdf", ""),
            confidence_score: extracted.confidence || 0,
            submitted: false,
            created_at: new Date().toISOString()
        };

        pendingVerifications[caseId] = dataForVerify;

        res.json({ redirect: `/verify.html?id=${caseId}` });

    } catch (error) {
        console.error("Test upload error:", error);
        res.status(500).json({ error: error.message || "Failed to process test file" });
    }
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
        const mappedCases = [];
        rawJson.forEach(row => {
            let status = row.status ? row.status.trim().toLowerCase() : '';
            if (status === 'completed' || status === 'approved') {
                status = 'approved';
            } else if (status === 'pending') {
                status = 'pending';
            } else {
                return; // Only register exact matches
            }

            mappedCases.push({
                case_id: row.euuid || row.matter_id || Date.now().toString(),
                client_plate_number: row.client_name || row.vehicle_info || 'Unknown',
                accident_date: row.accident_date,
                confidence_score: parseInt(row.confidence_score) || 0,
                status: status,
                created_at: row.created_at || new Date().toISOString(),
                approved_at: row.approved_at || null,
                sol_date: row.sol_date || null,
                form_link: row.form_link || null
            });
        });

        // 2) Fetch the Error_Logs tab (Assume GID is 1152865223 based on standard practice or we'll aggregate just based on raw text if needed, but since we don't have exact GID, let's fetch by sheet name via a macro-fetch or alternative. Wait, GSheets export CSV requires GID. Since we don't know the exact GID for Error_Logs, we can try fetching the exact tab name using gviz/tq)
        const errorUrl = 'https://docs.google.com/spreadsheets/d/1NdaLWcR-zm9iuskoHgJzazD3EReEXI-y5ILPc2Ja7JA/gviz/tq?tqx=out:csv&sheet=Error_Logs';
        let errorCount = 0;
        try {
            const errorRes = await axios.get(errorUrl, { responseType: 'text' });
            const errorJson = await csvtojson().fromString(errorRes.data);
            errorCount = errorJson.length;
        } catch (e) {
            console.error("Could not fetch Error_Logs sheet:", e.message);
        }

        // Include local test cases
        const pendingTestCases = Object.values(pendingVerifications)
            .filter(pv => pv.case_id.startsWith('test_') && !pv.submitted)
            .map(pv => ({
                case_id: pv.case_id,
                client_plate_number: pv.client_name || pv.fields?.defendant_name || 'Testing',
                accident_date: pv.fields?.accident_date || 'N/A',
                confidence_score: parseInt(pv.confidence_score) || 0,
                status: 'pending',
                created_at: pv.created_at || new Date().toISOString(),
                approved_at: null,
                sol_date: pv.fields?.statute_of_limitations_date || null,
                form_link: `/verify.html?id=${pv.case_id}`
            }));

        // Return the exact filtered list from Google Sheets + Tests
        res.json({
            cases: [...pendingTestCases, ...mappedCases, ...cases.filter(c => c.case_id && c.case_id.startsWith('test_'))],
            errorCount: errorCount
        });
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

    if (case_id.startsWith('test_')) {
        caseData.submitted = true;

        // Add to dashboard list for visualization without hitting API
        cases.unshift({
            ...fields,
            case_id,
            client_plate_number: caseData.client_name || fields.defendant_name || 'Testing',
            accident_date: fields.accident_date || 'N/A',
            confidence_score: caseData.confidence_score || 0,
            status: action === 'approve' ? 'approved' : 'rejected',
            created_at: caseData.created_at,
            approved_at: new Date().toISOString()
        });

        return res.status(200).json({ status: "success" });
    }

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
