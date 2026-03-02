const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('pdf-input');
const selectedFileDiv = document.getElementById('selected-file');
const submitBtn = document.getElementById('submit-btn');
const uploadForm = document.getElementById('upload-form');
const loadingOverlay = document.getElementById('loading-overlay');

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-active');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('drag-active');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-active');
    if (e.dataTransfer.files.length) {
        fileInput.files = e.dataTransfer.files;
        handleFileSelect();
    }
});

fileInput.addEventListener('change', handleFileSelect);

function handleFileSelect() {
    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        if (file.type === "application/pdf") {
            selectedFileDiv.innerHTML = `<i class="fas fa-check-circle" style="color: var(--success);"></i> ${file.name} ready for processing.`;
            submitBtn.style.display = 'block';
        } else {
            selectedFileDiv.innerHTML = `<i class="fas fa-exclamation-triangle" style="color: var(--danger);"></i> Please select a valid PDF file.`;
            submitBtn.style.display = 'none';
        }
    }
}

submitBtn.addEventListener('click', async () => {
    if (!fileInput.files.length) return;

    loadingOverlay.classList.remove('hidden');

    const formData = new FormData();
    formData.append('pdf', fileInput.files[0]);

    try {
        const response = await fetch('/api/upload-test', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || "Upload failed");
        }

        const data = await response.json();
        // Redirect to verify form with local case ID
        window.location.href = data.redirect;
    } catch (error) {
        alert("Processing Error: " + error.message);
        loadingOverlay.classList.add('hidden');
    }
});
