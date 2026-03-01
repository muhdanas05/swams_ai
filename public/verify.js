const urlParams = new URLSearchParams(window.location.search);
const caseId = urlParams.get('id');

let originalCaseData = null;
let isPdfOpen = false;

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

        // Handle n8n data structure fallback
        let dataToRender = originalCaseData;
        if (originalCaseData.fields) {
            dataToRender = { ...originalCaseData, ...originalCaseData.fields };
        }

        if (dataToRender.pdf_url) {
            const btn = document.getElementById('open-pdf-btn');
            if (btn) btn.style.display = 'block';
            document.getElementById('pdf-iframe').src = dataToRender.pdf_url;
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
    const layout = document.getElementById('app-layout');
    const pdfPanel = document.getElementById('pdf-panel');
    const btn = document.getElementById('open-pdf-btn');

    isPdfOpen = !isPdfOpen;

    if (isPdfOpen) {
        layout.classList.add('show-pdf');
        pdfPanel.classList.remove('hidden');
        btn.innerHTML = '<i class="fas fa-eye-slash"></i> Hide PDF';
        btn.classList.replace('badge-approved', 'badge-rejected');
    } else {
        layout.classList.remove('show-pdf');
        pdfPanel.classList.add('hidden');
        btn.innerHTML = '<i class="fas fa-file-pdf"></i> Open PDF Report';
        btn.classList.replace('badge-rejected', 'badge-approved');
    }
}

function renderUI(data) {
    // Set identifier display
    document.getElementById('matter-id-display').innerText = data.client_plate_number || data.case_id || "N/A";
    document.getElementById('overall-confidence').innerText = `${data.confidence_score || 0}%`;
    document.getElementById('confidence-badge-container').classList.remove('hidden');

    const extractedView = document.getElementById('extracted-view');
    const formFields = document.getElementById('form-fields');

    // Clear previous
    extractedView.innerHTML = '';
    formFields.innerHTML = '';

    // Define fields based on user request
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
        // If it's undefined, null, or empty string, use "N/A"
        if (value === undefined || value === null || value === "") {
            value = "N/A";
        }

        const isLowConfidence = (data.confidence_score < 75);

        // Render Read-only view
        const infoGroup = document.createElement('div');
        infoGroup.className = 'info-group';
        infoGroup.innerHTML = `
            <span class="info-label">${f.label}</span>
            <div class="info-value">${value}</div>
        `;
        extractedView.appendChild(infoGroup);

        // Render Editable form
        const inputGroup = document.createElement('div');
        inputGroup.className = 'input-group';

        let inputHtml = '';
        // For inputs, if value is "N/A", we leave it empty so the user can type fresh data
        const displayValue = value === "N/A" ? "" : value;

        if (f.type === 'textarea') {
            inputHtml = `<textarea id="field-${f.key}" rows="3" placeholder="N/A">${displayValue}</textarea>`;
        } else {
            inputHtml = `<input type="${f.type}" id="field-${f.key}" value="${displayValue}" placeholder="N/A">`;
        }

        inputGroup.innerHTML = `
            <label class="info-label">
                ${f.label}
                ${isLowConfidence ? '<span class="warning-icon"><i class="fas fa-exclamation-triangle"></i> Review</span>' : ''}
            </label>
            ${inputHtml}
        `;

        formFields.appendChild(inputGroup);
    });
}

function showError(msg) {
    document.getElementById('loading').innerHTML = `
        <div style="text-align:center">
            <div class="stat-value" style="color:var(--danger)"><i class="fas fa-exclamation-circle"></i> Error</div>
            <p>${msg}</p>
            <button class="badge badge-approved" style="margin-top:10px; cursor:pointer;" onclick="window.location.href='/'">Go Home</button>
        </div>
    `;
}

async function handleAction(action) {
    const fields = {};
    const inputs = document.querySelectorAll('[id^="field-"]');
    inputs.forEach(input => {
        const key = input.id.replace('field-', '');
        fields[key] = input.value || "N/A"; // Submit N/A if empty
    });

    const payload = {
        case_id: caseId,
        action: action,
        fields: fields,
        paralegal_notes: document.getElementById('paralegal-notes').value || "N/A"
    };

    try {
        const response = await fetch('/api/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            showSuccess(action);
        } else {
            alert("Failed to submit verification.");
        }
    } catch (error) {
        console.error("Submission error:", error);
    }
}

function showSuccess(action) {
    document.getElementById('main-ui').classList.add('hidden');
    document.getElementById('success-screen').classList.remove('hidden');

    if (action === 'rejected') {
        document.getElementById('status-icon').innerHTML = '<i class="fas fa-times-circle"></i>';
        document.getElementById('status-icon').style.color = "var(--danger)";
        document.getElementById('success-title').innerText = "Case Rejected";
        document.getElementById('success-message').innerText = "Feedback sent to n8n.";
    }
}

// Initial load
loadCaseData();
