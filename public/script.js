// public/script.js
document.addEventListener('DOMContentLoaded', () => {
    const uploadForm = document.getElementById('uploadForm');
    const receiptFile = document.getElementById('receiptFile');
    const uploadStatus = document.getElementById('uploadStatus');
    const fileActionStatus = document.getElementById('fileActionStatus');

    const filesTableBody = document.querySelector('#filesTable tbody');
    const receiptsTableBody = document.querySelector('#receiptsTable tbody');
    
    const refreshFilesButton = document.getElementById('refreshFiles');
    const refreshReceiptsButton = document.getElementById('refreshReceipts');

    const modal = document.getElementById('modal');
    const modalData = document.getElementById('modalData');
    const closeButton = document.querySelector('.close-button');

    // --- Utility Functions ---
    function showStatus(element, message, isSuccess) {
        element.textContent = message;
        element.className = isSuccess ? 'status-success' : 'status-error';
    }

    // --- Event Listeners ---
    uploadForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData();
        formData.append('receiptPdf', receiptFile.files[0]);

        showStatus(uploadStatus, 'Uploading...', true);

        try {
            const response = await fetch('http://127.0.0.1:3000/api/upload', {
                method: 'POST',
                body: formData,
            });
            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.message || 'Upload failed');
            }
            showStatus(uploadStatus, `Success: ${result.message} (File ID: ${result.fileId})`, true);
            receiptFile.value = ''; // Clear file input
            loadFiles(); // Refresh file list
        } catch (error) {
            showStatus(uploadStatus, `Error: ${error.message}`, false);
        }
    });

    refreshFilesButton.addEventListener('click', loadFiles);
    refreshReceiptsButton.addEventListener('click', loadReceipts);

    closeButton.onclick = function() {
        modal.style.display = "none";
    }
    window.onclick = function(event) {
        if (event.target == modal) {
            modal.style.display = "none";
        }
    }

    // --- Data Loading Functions ---
    async function loadFiles() {
        showStatus(fileActionStatus, 'Loading files...', true);
        try {
            const response = await fetch('http://127.0.0.1:3000/api/files');
            if (!response.ok) throw new Error('Failed to fetch files');
            const files = await response.json();
            
            filesTableBody.innerHTML = ''; // Clear existing rows
            if (files.length === 0) {
                filesTableBody.innerHTML = '<tr><td colspan="5">No files uploaded yet.</td></tr>';
                showStatus(fileActionStatus, 'No files found.', true);
                return;
            }
            files.forEach(file => {
                const row = filesTableBody.insertRow();
                row.innerHTML = `
                    <td>${file.id}</td>
                    <td>${file.file_name}</td>
                    <td>${file.is_valid ? 'Valid PDF' : (file.invalid_reason || 'Not Validated')}</td>
                    <td>${file.is_processed ? 'Yes' : 'No'}</td>
                    <td>
                        <button class="action-button validate-btn" data-id="${file.id}" ${file.is_valid ? 'disabled title="Already Valid"' : ''}>Validate</button>
                        <button class="action-button process-btn" data-id="${file.id}" ${!file.is_valid || file.is_processed ? 'disabled' : ''} title="${!file.is_valid ? 'Validate first' : (file.is_processed ? 'Already Processed' : 'Process File')}">Process</button>
                    </td>
                `;
            });
            showStatus(fileActionStatus, 'Files loaded.', true);
            attachActionListeners();
        } catch (error) {
            showStatus(fileActionStatus, `Error loading files: ${error.message}`, false);
            filesTableBody.innerHTML = `<tr><td colspan="5">Error loading files.</td></tr>`;
        }
    }

    async function loadReceipts() {
        try {
            const response = await fetch('http://127.0.0.1:3000/api/receipts');
             if (!response.ok) throw new Error('Failed to fetch receipts');
            const receipts = await response.json();
            
            receiptsTableBody.innerHTML = ''; // Clear existing rows
             if (receipts.length === 0) {
                receiptsTableBody.innerHTML = '<tr><td colspan="6">No receipts processed yet.</td></tr>';
                return;
            }
            receipts.forEach(receipt => {
                const row = receiptsTableBody.insertRow();
                const purchasedDate = receipt.purchased_at ? new Date(receipt.purchased_at).toLocaleString() : 'N/A';
                row.innerHTML = `
                    <td>${receipt.id}</td>
                    <td>${receipt.merchant_name || 'N/A'}</td>
                    <td>${purchasedDate}</td>
                    <td>${receipt.total_amount !== null ? receipt.total_amount.toFixed(2) : 'N/A'}</td>
                    <td>${receipt.original_file_name || 'N/A'}</td>
                    <td><button class="action-button view-details-btn" data-id="${receipt.id}">View JSON</button></td>
                `;
            });
            attachReceiptActionListeners();
        } catch (error) {
            console.error('Error loading receipts:', error);
            receiptsTableBody.innerHTML = `<tr><td colspan="6">Error loading receipts.</td></tr>`;
        }
    }
    
    // --- Attach Event Listeners for Dynamic Buttons ---
    function attachActionListeners() {
        document.querySelectorAll('.validate-btn').forEach(button => {
            button.addEventListener('click', async (e) => {
                const fileId = e.target.dataset.id;
                showStatus(fileActionStatus, `Validating file ID ${fileId}...`, true);
                try {
                    const response = await fetch(`http://127.0.0.1:3000/api/validate/${fileId}`, { method: 'POST' });
                    const result = await response.json();
                    if (!response.ok) throw new Error(result.message || `Validation failed for ${fileId}`);
                    showStatus(fileActionStatus, `File ID ${fileId}: ${result.message}`, true);
                    loadFiles(); // Refresh list
                } catch (error) {
                    showStatus(fileActionStatus, `Error: ${error.message}`, false);
                }
            });
        });

        document.querySelectorAll('.process-btn').forEach(button => {
            button.addEventListener('click', async (e) => {
                const fileId = e.target.dataset.id;
                showStatus(fileActionStatus, `Processing file ID ${fileId}... This may take a moment.`, true);
                e.target.disabled = true; // Disable button during processing
                e.target.textContent = 'Processing...';

                try {
                    const response = await fetch(`http://127.0.0.1:3000/api/process/${fileId}`, { method: 'POST' });
                    const result = await response.json();
                    if (!response.ok) {
                         // Try to get more details from the error if available
                        let errorMessage = result.message || `Processing failed for ${fileId}`;
                        if (result.error) errorMessage += ` Details: ${result.error}`;
                        if (result.rawResponse) errorMessage += ` Raw AI Response: ${result.rawResponse.substring(0, 200)}...`;
                        throw new Error(errorMessage);
                    }
                    showStatus(fileActionStatus, `File ID ${fileId}: ${result.message}`, true);
                    loadFiles(); // Refresh file list
                    loadReceipts(); // Refresh receipt list
                } catch (error) {
                    showStatus(fileActionStatus, `Error: ${error.message}`, false);
                } finally {
                    // Re-enable button or update its state based on the new file list
                    // For simplicity, loadFiles() will redraw buttons with correct states.
                    // If you want to target this specific button, you'd need to re-query it or pass the element.
                    loadFiles(); // This will correctly set button states
                }
            });
        });
    }

    function attachReceiptActionListeners() {
        document.querySelectorAll('.view-details-btn').forEach(button => {
            button.addEventListener('click', async (e) => {
                const receiptId = e.target.dataset.id;
                try {
                    const response = await fetch(`http://127.0.0.1:3000/api/receipts/${receiptId}`);
                    if (!response.ok) throw new Error('Failed to fetch receipt details');
                    const receiptDetails = await response.json();
                    modalData.textContent = JSON.stringify(receiptDetails, null, 2);
                    modal.style.display = "block";
                } catch (error) {
                    alert(`Error fetching details: ${error.message}`);
                }
            });
        });
    }

    // --- Initial Load ---
    loadFiles();
    loadReceipts();
});