const urlParams = new URLSearchParams(window.location.search);
const caseId = urlParams.get('id');

let originalCaseData = null;
let isPdfOpen = true; // Default to open

async function loadCaseData() {
    if (!caseId) {
        showError("Invalid Case ID");
        return;
    }

    try {
        const response = await fetch(`/api/case/${caseId}`);
        if (!response.ok) {
            const err = await response.json();
            showError(err.error || "Failed to load case");
            return;
        }

        originalCaseData = await response.json();

        let dataToRender = originalCaseData;
        // The server stores combined data at top level, but let's be safe
        if (originalCaseData.fields) {
            dataToRender = { ...originalCaseData, ...originalCaseData.fields };
        }

        if (dataToRender.pdf_url) {
            const iframe = document.getElementById('pdf-iframe');
            if (iframe) {
                // Append #view=FitH to PDF URL for better initial view inside iframe
                iframe.src = `${dataToRender.pdf_url}#view=FitH`;
            }
        }

        renderUI(dataToRender);
    } catch (error) {
        console.error("Error loading case:", error);
        showError("Network error occurred");
    } finally {
        document.getElementById('loading').classList.add('hidden');
    }
}

function togglePDF() {
    const pdfPanel = document.getElementById('pdf-panel');
    const layout = document.getElementById('app-layout');

    isPdfOpen = !isPdfOpen;

    if (isPdfOpen) {
        pdfPanel.classList.remove('hidden');
        layout.style.gridTemplateColumns = "350px 420px 1.8fr";
    } else {
        pdfPanel.classList.add('hidden');
        layout.style.gridTemplateColumns = "1fr 1fr";
    }
}

function renderUI(data) {
    document.getElementById('matter-id-display').innerText = data.client_plate_number || data.case_id || "N/A";

    const confidenceContainer = document.getElementById('confidence-badge-container');
    const overallConfidence = document.getElementById('overall-confidence');

    if (data.confidence_score !== undefined && data.confidence_score !== null) {
        overallConfidence.innerText = `${data.confidence_score}%`;
        confidenceContainer.classList.remove('hidden');
    }

    const extractedView = document.getElementById('extracted-view');
    const formFields = document.getElementById('form-fields');

    extractedView.innerHTML = '';
    formFields.innerHTML = '';

    const fields = [
        { key: 'accident_date', label: 'Accident Date', type: 'date' },
        { key: 'accident_location', label: 'Accident Location', type: 'text' },
        { key: 'accident_description', label: 'Accident Description', type: 'textarea' },
        { key: 'defendant_name', label: 'Defendant Name', type: 'text' },
        { key: 'client_plate_number', label: 'Client Plate #', type: 'text' },
        { key: 'client_vehicle_year_and_make', label: 'Client Vehicle', type: 'text' },
        { key: 'client_gender', label: 'Client Gender', type: 'text' },
        { key: 'number_of_injured', label: '# of Injured', type: 'number' },
        { key: 'statute_of_limitations_date', label: 'Statute of Limitations', type: 'date' }
    ];

    fields.forEach(f => {
        let value = data[f.key];
        // Ensure values are strings for trim
        const stringValue = (value !== null && value !== undefined) ? String(value) : "";
        const isEmpty = (stringValue.trim() === "" || stringValue.toLowerCase() === "n/a");
        const displayValue = isEmpty ? "N/A" : stringValue;

        const isLowConfidence = (data.confidence_score !== undefined && data.confidence_score !== null && data.confidence_score < 75);

        // Read-only
        const infoGroup = document.createElement('div');
        infoGroup.className = 'info-group';
        infoGroup.innerHTML = `
            <span class="info-label">${f.label}</span>
            <div class="info-value" style="${isEmpty ? 'color:var(--text-muted); font-style:italic;' : ''}">${displayValue}</div>
        `;
        extractedView.appendChild(infoGroup);

        // Form
        const inputGroup = document.createElement('div');
        inputGroup.className = 'input-group';
        const inputValue = isEmpty ? "" : stringValue;

        let inputHtml = '';
        if (f.type === 'textarea') {
            inputHtml = `<textarea id="field-${f.key}" rows="3" placeholder="Enter ${f.label}...">${inputValue}</textarea>`;
        } else {
            inputHtml = `<input type="${f.type}" id="field-${f.key}" value="${inputValue}" placeholder="Enter ${f.label}...">`;
        }

        inputGroup.innerHTML = `
            <label class="info-label">
                ${f.label}
                ${isLowConfidence ? '<i class="fas fa-exclamation-triangle" style="color:var(--warning); margin-left:8px;"></i>' : ''}
            </label>
            ${inputHtml}
        `;
        formFields.appendChild(inputGroup);
    });
}

// Global scope for callbacks
window.togglePDF = togglePDF;

async function handleAction(action) {
    const fields = {};
    document.querySelectorAll('[id^="field-"]').forEach(input => {
        const key = input.id.replace('field-', '');
        fields[key] = input.value.trim() || "N/A";
    });
    const payload = {
        case_id: caseId,
        action: action,
        fields: fields,
        paralegal_notes: document.getElementById('paralegal-notes').value.trim() || "N/A"
    };
    try {
        const res = await fetch('/api/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (res.ok) showSuccess(action);
    } catch (e) { console.error(e); }
}

function showSuccess(action) {
    document.getElementById('main-ui').classList.add('hidden');
    document.getElementById('success-screen').classList.remove('hidden');
    if (action === 'rejected') {
        const icon = document.getElementById('status-icon');
        const title = document.getElementById('success-title');
        if (icon) { icon.innerHTML = '<i class="fas fa-times-circle"></i>'; icon.style.color = "var(--danger)"; }
        if (title) title.innerText = "Case Rejected";
    }
}

function showError(msg) {
    const loading = document.getElementById('loading');
    if (loading) loading.innerHTML = `<div style="text-align:center"><p style="color:var(--danger)">${msg}</p></div>`;
}

loadCaseData();
