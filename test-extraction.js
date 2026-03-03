const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
require('dotenv').config();

async function test() {
    try {
        const LLAMAPARSE_KEY = process.env.LLAMAPARSE_KEY || 'llx-dSRGjVpuEPPeSopkGQsXEItNfv62QMcb8T4xufT2lSctsXJn';
        const GEMINI_KEY = process.env.GEMINI_KEY || 'AIzaSyD1TbIb59cRpxKasbx_Nj-Mc7ftL5yuuFM';
        const filePath = 'JOHN_GRILLO_v_JOHN_GRILLO_EXHIBIT_S__16.pdf';

        console.log('Uploading to LlamaParse...');
        const fData = new FormData();
        fData.append('file', fs.createReadStream(filePath));
        fData.append('configuration', JSON.stringify({ tier: 'agentic', version: 'latest' }));

        const uploadRes = await axios.post('https://api.cloud.llamaindex.ai/api/v2/parse/upload', fData, {
            headers: { 'Authorization': 'Bearer ' + LLAMAPARSE_KEY, ...fData.getHeaders() }
        });

        const jobId = uploadRes.data.id;
        console.log('Job ID:', jobId);

        let completed = false;
        let markdownText = '';
        while (!completed) {
            await new Promise(r => setTimeout(r, 3000));
            console.log('Polling...');
            const statRes = await axios.get('https://api.cloud.llamaindex.ai/api/v2/parse/' + jobId + '?expand=text,markdown', {
                headers: { 'Authorization': 'Bearer ' + LLAMAPARSE_KEY }
            });
            const jobStatus = statRes.data.status || statRes.data.job?.status;
            console.log('Status:', jobStatus);
            if (jobStatus === 'SUCCESS' || jobStatus === 'COMPLETED') {
                completed = true;
                if (statRes.data.markdown?.pages) {
                    markdownText = statRes.data.markdown.pages.map(p => p.markdown || p.text).join('\n\n');
                } else if (statRes.data.text?.pages) {
                    markdownText = statRes.data.text.pages.map(p => p.text).join('\n\n');
                } else {
                    markdownText = JSON.stringify(statRes.data);
                }
            } else if (jobStatus === 'FAILED') {
                throw new Error('LlamaParse job failed: ' + (statRes.data.job?.error_message || 'Unknown error'));
            }
        }

        console.log('Extracting with Gemini...');
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

        const geminiUrl = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=' + GEMINI_KEY;
        const geminiRes = await axios.post(geminiUrl, {
            system_instruction: { parts: [{ text: systemPrompt }] },
            contents: [{ parts: [{ text: 'Filename: ' + filePath + '\n\nReport Text:\n' + markdownText }] }],
            generationConfig: { response_mime_type: 'application/json' }
        }, {
            headers: { 'Content-Type': 'application/json' }
        });

        const gContent = geminiRes.data.candidates[0].content.parts[0].text;
        const extracted = JSON.parse(gContent);
        console.log('Result:', JSON.stringify(extracted, null, 2));
    } catch (error) {
        console.error('Test error:', error.response?.data || error.message);
    }
}

test();
