const urlParams = new URLSearchParams(window.location.search);
const caseId = urlParams.get('id');

let originalCaseData = null;

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

        // Handle n8n data structure
        let dataToRender = originalCaseData;

        if (originalCaseData.pdf_url) {
            const btn = document.getElementById('open-pdf-btn');
            if (btn) btn.style.display = 'block';
        }

        renderUI(dataToRender);
    } catch (error) {
        console.error("Error loading case:", error);
        showError("Network error occurred");
    } finally {
        document.getElementById('loading').classList.add('hidden');
    }
}

function openPDF() {
    if (originalCaseData && originalCaseData.pdf_url) {
        window.open(originalCaseData.pdf_url, '_blank');
    }
}

function renderUI(data) {
    // Set Page Title
    document.getElementById('page-title').innerText = `Verifying Intake`;

    // Use plate number or case ID as identifier
    document.getElementById('matter-id-display').innerText = data.client_plate_number || data.case_id || "N/A";
    document.getElementById('overall-confidence').innerText = `${data.confidence_score}%`;
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
        const value = data[f.key] || "";
        const isLowConfidence = (data.confidence_score < 75);

        // Render Read-only view
        const infoGroup = document.createElement('div');
        infoGroup.className = 'info-group';
        infoGroup.innerHTML = `
            <span class="info-label">${f.label}</span>
            <div class="info-value">${value || 'N/A'}</div>
        `;
        extractedView.appendChild(infoGroup);

        // Render Editable form
        const inputGroup = document.createElement('div');
        inputGroup.className = 'input-group';

        let inputHtml = '';
        if (f.type === 'textarea') {
            inputHtml = `<textarea id="field-${f.key}" rows="3">${value}</textarea>`;
        } else {
            inputHtml = `<input type="${f.type}" id="field-${f.key}" value="${value}">`;
        }

        inputGroup.innerHTML = `
            <label class="info-label">
                ${f.label}
                ${isLowConfidence ? '<span class="warning-icon"><i class="fas fa-exclamation-triangle"></i> Review</span>' : ''}
            </label>
            ${inputHtml}
        `;

        if (isLowConfidence) {
            inputGroup.querySelector('input, textarea')?.classList.add('low-confidence');
        }

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
        fields[key] = input.value;
    });

    const payload = {
        case_id: caseId,
        action: action,
        fields: fields,
        paralegal_notes: document.getElementById('paralegal-notes').value
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
