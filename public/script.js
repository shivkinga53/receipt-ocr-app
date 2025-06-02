// script.js

document.addEventListener('DOMContentLoaded', () => {
  // ─── DOM ELEMENTS ─────────────────────────────────────────
  const loaderOverlay       = document.getElementById('loaderOverlay');
  const uploadForm          = document.getElementById('uploadForm');
  const receiptFileInput    = document.getElementById('receiptFile');
  const uploadStatus        = document.getElementById('uploadStatus');
  const fileActionStatus    = document.getElementById('fileActionStatus');

  const filesTableBody      = document.querySelector('#filesTable tbody');
  const receiptsTableBody   = document.querySelector('#receiptsTable tbody');

  const refreshFilesButton    = document.getElementById('refreshFiles');
  const refreshReceiptsButton = document.getElementById('refreshReceipts');

  const filesSearchInput      = document.getElementById('filesSearchInput');
  const receiptsSearchInput   = document.getElementById('receiptsSearchInput');

  const modalElem           = document.getElementById('modal');
  const modalSummary        = document.getElementById('modalSummary');
  const modalData           = document.getElementById('modalData');
  const itemsTableContainer = document.getElementById('itemsTableContainer');

  const themeToggle         = document.getElementById('themeToggle');

  let bootstrapModalInstance = new bootstrap.Modal(modalElem);

  // ─── HELPER: Show / Hide Loader ────────────────────────────
  function showLoader() {
    loaderOverlay.classList.add('show');
  }
  function hideLoader() {
    loaderOverlay.classList.remove('show');
  }

  // ─── HELPER: display a temporary Bootstrap alert in the given element.
  //      (8‐second duration)
  function showStatus(element, message, isSuccess) {
    const alertType = isSuccess ? 'success' : 'danger';
    element.innerHTML = `<div class="alert alert-${alertType}">${message}</div>`;
    setTimeout(() => {
      element.innerHTML = '';
    }, 8000);
  }

  // ─── UPDATE URL HASH WHEN TABS CHANGE ─────────────────────
  document.querySelectorAll('button[data-bs-toggle="tab"]').forEach((tabBtn) => {
    tabBtn.addEventListener('shown.bs.tab', (e) => {
      let newHash = '';
      switch (e.target.id) {
        case 'upload-tab':   newHash = '#upload';    break;
        case 'files-tab':    newHash = '#files';     break;
        case 'receipts-tab': newHash = '#receipts';  break;
      }
      if (newHash) {
        history.replaceState(null, null, newHash);
      }
    });
  });

  // ─── ACTIVATE CORRECT TAB BASED ON window.location.hash ────
  function activateTabFromHash() {
    const hash = window.location.hash;
    if (hash === '#files') {
      new bootstrap.Tab(document.getElementById('files-tab')).show();
    } else if (hash === '#receipts') {
      new bootstrap.Tab(document.getElementById('receipts-tab')).show();
    } else {
      new bootstrap.Tab(document.getElementById('upload-tab')).show();
    }
  }
  activateTabFromHash();

  // ─── THEME TOGGLE ──────────────────────────────────────────
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    themeToggle.checked = (theme === 'dark');
  }
  // On load, read localStorage
  const savedTheme = localStorage.getItem('theme');
  applyTheme(savedTheme === 'dark' ? 'dark' : 'light');
  themeToggle.addEventListener('change', () => {
    const newTheme = themeToggle.checked ? 'dark' : 'light';
    applyTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  });

  // ─── UPLOAD FORM HANDLER (no page reload) ─────────────────
  uploadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const uploadBtn = uploadForm.querySelector('button[type="submit"]');
    if (!receiptFileInput.files[0]) {
      showStatus(uploadStatus, 'Please select a PDF first.', false);
      return;
    }

    // Disable input & button, show loader
    receiptFileInput.disabled = true;
    uploadBtn.disabled = true;
    showLoader();
    showStatus(uploadStatus, 'Uploading…', true);

    try {
      const formData = new FormData();
      formData.append('receiptPdf', receiptFileInput.files[0]);

      const response = await fetch('http://127.0.0.1:3000/api/upload', {
        method: 'POST',
        body: formData,
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.message || 'Upload failed.');
      }
      showStatus(
        uploadStatus,
        `✔️ ${result.message} (File ID: ${result.fileId})`,
        true
      );
      receiptFileInput.value = '';
      await loadFiles(); // reload only the Files table
    } catch (error) {
      showStatus(uploadStatus, `❌ ${error.message}`, false);
    } finally {
      hideLoader();
      receiptFileInput.disabled = false;
      uploadBtn.disabled = false;
    }
  });

  // ─── REFRESH BUTTONS ───────────────────────────────────────
  refreshFilesButton.addEventListener('click', loadFiles);
  refreshReceiptsButton.addEventListener('click', loadReceipts);

  // ─── FETCH & RENDER FILES (no page reload) ─────────────────
  async function loadFiles() {
    // Disable Refresh Files button
    refreshFilesButton.disabled = true;
    showLoader();
    showStatus(fileActionStatus, 'Loading files…', true);

    try {
      const response = await fetch('http://127.0.0.1:3000/api/files');
      if (!response.ok) throw new Error('Failed to fetch files.');
      const files = await response.json();

      filesTableBody.innerHTML = '';
      if (files.length === 0) {
        filesTableBody.innerHTML =
          '<tr><td colspan="6" class="text-center">No files uploaded yet.</td></tr>';
        showStatus(fileActionStatus, 'No files found.', true);
        return;
      }

      files.forEach((file) => {
        const row = filesTableBody.insertRow();
        const downloadUrl = `http://127.0.0.1:3000/${file.file_path}`;
        row.innerHTML = `
          <td>${file.id}</td>
          <td>${file.file_name}</td>
          <td>${file.is_valid ? 'Valid PDF' : (file.invalid_reason || 'Not Validated')}</td>
          <td>${file.is_processed ? 'Yes' : 'No'}</td>
          <td>
            <a href="${downloadUrl}" target="_blank" class="btn btn-sm btn-outline-primary">
              Download
            </a>
          </td>
          <td>
            <button
              class="btn btn-sm btn-primary validate-btn"
              data-id="${file.id}"
              ${file.is_valid ? 'disabled' : ''}
              type="button"
            >
              Validate
            </button>
            <button
              class="btn btn-sm btn-success process-btn"
              data-id="${file.id}"
              ${(!file.is_valid || file.is_processed) ? 'disabled' : ''}
              type="button"
            >
              Process
            </button>
          </td>
        `;
      });

      showStatus(fileActionStatus, 'Files loaded.', true);
      attachActionListeners();
    } catch (error) {
      showStatus(
        fileActionStatus,
        `Error loading files: ${error.message}`,
        false
      );
      filesTableBody.innerHTML =
        '<tr><td colspan="6" class="text-center text-danger">Error loading files.</td></tr>';
    } finally {
      hideLoader();
      refreshFilesButton.disabled = false;
    }
  }

  // ─── FETCH & RENDER RECEIPTS (no page reload) ───────────────
  async function loadReceipts() {
    // Disable Refresh Receipts button
    refreshReceiptsButton.disabled = true;
    showLoader();

    try {
      const response = await fetch('http://127.0.0.1:3000/api/receipts');
      if (!response.ok) throw new Error('Failed to fetch receipts.');
      const receipts = await response.json();

      receiptsTableBody.innerHTML = '';
      if (receipts.length === 0) {
        receiptsTableBody.innerHTML =
          '<tr><td colspan="7" class="text-center">No receipts processed yet.</td></tr>';
        return;
      }

      receipts.forEach((receipt) => {
        const row = receiptsTableBody.insertRow();
        const purchasedDate = receipt.purchased_at
          ? new Date(receipt.purchased_at).toLocaleString()
          : 'N/A';
        const downloadUrl = `http://127.0.0.1:3000/${receipt.file_path}`;
        console.log(receipt);
        
        row.innerHTML = `
          <td>${receipt.id}</td>
          <td>${receipt.merchant_name || 'N/A'}</td>
          <td>${purchasedDate}</td>
          <td>${receipt.total_amount !== null
            ? receipt.total_amount.toFixed(2)
            : 'N/A'}</td>
          <td>
            <a href="${downloadUrl}" target="_blank" class="btn btn-sm btn-outline-primary">
              Download
            </a>
          </td>
          <td>
            <button
              class="btn btn-sm btn-outline-secondary view-details-btn"
              data-id="${receipt.id}"
              type="button"
            >
              Details
            </button>
          </td>
          <td>
            <button
              class="btn btn-sm btn-danger delete-receipt-btn"
              data-id="${receipt.id}"
              type="button"
            >
              Delete
            </button>
          </td>
        `;
      });

      attachReceiptActionListeners();
      attachDeleteListeners();
    } catch (error) {
      console.error('Error loading receipts:', error);
      receiptsTableBody.innerHTML =
        '<tr><td colspan="7" class="text-center text-danger">Error loading receipts.</td></tr>';
    } finally {
      hideLoader();
      refreshReceiptsButton.disabled = false;
    }
  }

  // ─── ATTACH VALIDATE / PROCESS LISTENERS FOR FILES ────────
  function attachActionListeners() {
    document.querySelectorAll('.validate-btn').forEach((button) => {
      button.addEventListener('click', async (e) => {
        const validateBtn = e.target;
        const fileId = validateBtn.dataset.id;

        showLoader();
        showStatus(fileActionStatus, `Validating file #${fileId}…`, true);
        validateBtn.disabled = true;

        try {
          const response = await fetch(
            `http://127.0.0.1:3000/api/validate/${fileId}`,
            { method: 'POST' }
          );
          const result = await response.json();
          if (!response.ok) {
            throw new Error(result.message || `Validation failed for ${fileId}`);
          }

          showStatus(
            fileActionStatus,
            `✔️ File #${fileId}: ${result.message}`,
            true
          );
          await loadFiles(); // reload Files table only
        } catch (error) {
          showStatus(fileActionStatus, `❌ ${error.message}`, false);
        } finally {
          hideLoader();
          // Re-enable (in case the row is still present; otherwise row reload will re-render)
          validateBtn.disabled = false;
        }
      });
    });

    document.querySelectorAll('.process-btn').forEach((button) => {
      button.addEventListener('click', async (e) => {
        const processBtn = e.target;
        const fileId = processBtn.dataset.id;

        showLoader();
        showStatus(
          fileActionStatus,
          `Processing file #${fileId}… this may take a moment.`,
          true
        );
        processBtn.disabled = true;
        processBtn.textContent = 'Processing…';

        try {
          const response = await fetch(
            `http://127.0.0.1:3000/api/process/${fileId}`,
            { method: 'POST' }
          );
          const result = await response.json();
          if (!response.ok) {
            let errorMessage = result.message || `Processing failed for ${fileId}`;
            if (result.error) errorMessage += ` Details: ${result.error}`;
            if (result.rawResponse) {
              errorMessage += ` Raw AI Response: ${result.rawResponse
                .substring(0, 200)
                .trim()}…`;
            }
            throw new Error(errorMessage);
          }
          showStatus(
            fileActionStatus,
            `✔️ File #${fileId}: ${result.message}`,
            true
          );
          await loadFiles();     // reload Files
          await loadReceipts();  // reload Receipts
        } catch (error) {
          showStatus(fileActionStatus, `❌ ${error.message}`, false);
        } finally {
          hideLoader();
          processBtn.disabled = false;
          processBtn.textContent = 'Process';
        }
      });
    });
  }

  // ─── ATTACH “VIEW DETAILS” LISTENERS FOR RECEIPTS ─────────
  function attachReceiptActionListeners() {
    document.querySelectorAll('.view-details-btn').forEach((button) => {
      button.addEventListener('click', async (e) => {
        const viewBtn = e.target;
        const receiptId = viewBtn.dataset.id;

        showLoader();
        viewBtn.disabled = true;

        try {
          const response = await fetch(
            `http://127.0.0.1:3000/api/receipts/${receiptId}`
          );
          if (!response.ok) throw new Error('Failed to fetch receipt details.');
          const receiptDetails = await response.json();

          // Populate modal summary (merchant, date, amount)
          const purchasedDate = receiptDetails.purchased_at
            ? new Date(receiptDetails.purchased_at).toLocaleString()
            : 'N/A';
          modalSummary.innerHTML = `
            <p><strong>Merchant:</strong> ${receiptDetails.merchant_name || 'N/A'}</p>
            <p><strong>Date:</strong> ${purchasedDate}</p>
            <p><strong>Total Amount:</strong> ${
              receiptDetails.total_amount !== null
                ? receiptDetails.total_amount.toFixed(2)
                : 'N/A'
            }</p>
          `;

          // Parse items array (JSON string → array of objects)
          let itemsArray = [];
          try {
            itemsArray = JSON.parse(receiptDetails.items || '[]');
          } catch {
            itemsArray = [];
          }

          // Build items table if any items exist
          if (itemsArray.length > 0) {
            let tableHTML = `
              <h6 class="mb-2">Itemized Details:</h6>
              <div class="table-responsive">
                <table class="table table-sm table-bordered">
                  <thead class="table-secondary">
                    <tr>
                      <th>Name</th>
                      <th>Price</th>
                      <th>Quantity</th>
                    </tr>
                  </thead>
                  <tbody>
            `;
            itemsArray.forEach((itemObj) => {
              const name = itemObj.name || 'N/A';
              const price = (itemObj.price !== undefined && itemObj.price !== null)
                ? itemObj.price.toFixed(2)
                : 'N/A';
              const quantity = itemObj.quantity || 'N/A';
              tableHTML += `
                <tr>
                  <td>${name}</td>
                  <td>${price}</td>
                  <td>${quantity}</td>
                </tr>
              `;
            });
            tableHTML += `
                  </tbody>
                </table>
              </div>
            `;
            itemsTableContainer.innerHTML = tableHTML;
          } else {
            itemsTableContainer.innerHTML = `<p class="text-muted">No item details available.</p>`;
          }

          // Show the raw JSON in the <pre>
          modalData.textContent = JSON.stringify(receiptDetails, null, 2);
          bootstrapModalInstance.show();
        } catch (error) {
          alert(`Error fetching details: ${error.message}`);
        } finally {
          hideLoader();
          viewBtn.disabled = false;
        }
      });
    });
  }

  // ─── ATTACH “DELETE” LISTENERS FOR RECEIPTS ─────────────────
  function attachDeleteListeners() {
    document.querySelectorAll('.delete-receipt-btn').forEach((button) => {
      button.addEventListener('click', async (e) => {
        const deleteBtn = e.target;
        const receiptId = deleteBtn.dataset.id;
        const confirmed = confirm(
          `Are you sure you want to delete receipt #${receiptId}? This also removes its file entry.`
        );
        if (!confirmed) return;

        showLoader();
        deleteBtn.disabled = true;

        try {
          const response = await fetch(
            `http://127.0.0.1:3000/api/receipts/${receiptId}`,
            { method: 'DELETE' }
          );
          const result = await response.json();
          if (!response.ok) {
            throw new Error(result.message || 'Delete failed');
          }
          alert(`✔️ ${result.message}`);
          await loadReceipts();  // reload Receipts table
          await loadFiles();     // also reload Files table
        } catch (error) {
          alert(`❌ Error deleting receipt: ${error.message}`);
        } finally {
          hideLoader();
          deleteBtn.disabled = false;
        }
      });
    });
  }

  // ─── SEARCH FILTER FOR TABLES ─────────────────────────────
  function filterTableRows(inputElem, tableBody) {
    const query = inputElem.value.trim().toLowerCase();
    Array.from(tableBody.rows).forEach((row) => {
      const rowText = row.textContent.toLowerCase();
      row.style.display = rowText.includes(query) ? '' : 'none';
    });
  }
  filesSearchInput.addEventListener('input', () => {
    filterTableRows(filesSearchInput, filesTableBody);
  });
  receiptsSearchInput.addEventListener('input', () => {
    filterTableRows(receiptsSearchInput, receiptsTableBody);
  });

  // ─── INITIAL DATA LOAD ─────────────────────────────────────
  loadFiles();
  loadReceipts();
});
