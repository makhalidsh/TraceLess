// ============================
// TraceLess — Renderer
// ============================

// ---- State ----
let files = [];          // { name, path, size }
let activeIndex = -1;
let originalMeta = null; // raw metadata from ExifTool for active file
let dirtyTags = {};      // tags that were edited { TagName: newValue }

// ---- DOM Refs ----
const $ = id => document.getElementById(id);

const emptyState     = $('empty-state');
const emptyCard      = document.querySelector('.empty-state-card');
const workspace      = $('workspace');
const btnOpenFiles   = $('btn-open-files');
const btnAddMore     = $('btn-add-more');
const btnClearAll    = $('btn-clear-all');
const btnReload      = $('btn-reload');
const btnClean       = $('btn-clean');
const fileListEl     = $('file-list');
const previewMedia   = $('preview-media');
const previewName    = $('preview-filename');
const previewSize    = $('preview-filesize');
const previewType    = $('preview-filetype');
const metaGroups     = $('metadata-groups');
const searchInput    = $('search-input');
const tagCountEl     = $('tag-count');
const fabSave        = $('fab-save');
const fabSaveAs      = $('fab-save-as');
const btnCleanSaveAs = $('btn-clean-save-as');
const snackbarHost   = $('snackbar-host');
const btnTheme       = $('btn-theme');
const themeIcon      = $('theme-icon');
const loadingScreen  = $('loading-screen');
const loadingText    = $('loading-text');

// Sandbox Refs
const btnSandboxScrub   = $('btn-sandbox-scrub');
const iconSandboxScrub  = $('icon-sandbox-scrub');
const textSandboxScrub  = $('text-sandbox-scrub');
const sandboxPin        = $('sandbox-pin');
const sandboxGpsBadge   = $('sandbox-gps-badge');
const valSandboxDevice  = $('val-sandbox-device');
const valSandboxLocation = $('val-sandbox-location');
const valSandboxDate    = $('val-sandbox-date');

// Helper to toggle Save FABs
function toggleSaveFABs(show) {
  if (fabSave) fabSave.classList.toggle('hidden', !show);
  if (fabSaveAs) fabSaveAs.classList.toggle('hidden', !show);
}

// ---- Presets Refs ----
const cameraSelect      = $('camera-select');
const metaPresetSelect  = $('meta-preset-select');
const locationSelect    = $('location-select');
const btnApplyPresets   = $('btn-apply-presets');
const presetCard        = $('preset-card');
const btnPresetsToggle  = $('btn-presets-toggle');

// Filename Rename Refs
const btnRenameEdit   = $('btn-rename-edit');
const btnRenameSave   = $('btn-rename-save');
const btnRenameCancel = $('btn-rename-cancel');
const filenameInput   = $('filename-input');
const filenameContainer = $('filename-container');

// Share Refs
const btnShare        = $('btn-share');
const shareMenu       = $('share-menu');
const btnShareFolder  = $('btn-share-folder');
const btnShareCopy    = $('btn-share-copy');
const btnSharePath    = $('btn-share-path');

// ---- Utilities ----
function fmtBytes(b) {
  if (!b || b === 0) return '0 B';
  const u = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(1024));
  return (b / Math.pow(1024, i)).toFixed(i ? 1 : 0) + ' ' + u[i];
}

function extOf(name) {
  const m = name.match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toUpperCase() : '—';
}

function findTagValue(data, tagName) {
  const lowerTag = tagName.toLowerCase();
  for (const group of Object.values(data)) {
    if (typeof group !== 'object' || group === null) continue;
    for (const [key, val] of Object.entries(group)) {
      if (key.toLowerCase() === lowerTag) {
        return val;
      }
    }
  }
  return '';
}

// Check if a tag name represents a Date or Time field
function isDateTimeTag(tagName) {
  const lower = tagName.toLowerCase();
  
  // Exclude known non-datetime tags that contain "time" or "date"
  const exclusions = [
    'exposuretime', 'subsectime', 'timezone', 'timeoffset', 'timesource', 
    'datetype', 'datesource', 'gpsstatus', 'gpstimestamp'
  ];
  if (exclusions.some(exc => lower.includes(exc))) {
    return false;
  }
  
  if (
    lower.includes('date') || 
    lower.includes('datetime') || 
    lower === 'modifydate' || 
    lower === 'createdate' || 
    lower === 'datetimeoriginal' ||
    lower.includes('when')
  ) {
    return true;
  }
  
  return false;
}

// Convert EXIF date format (YYYY:MM:DD HH:MM:SS) to datetime-local format (YYYY-MM-DDTHH:MM:SS)
function exifToDatetimeLocal(exifStr) {
  if (!exifStr) return '';
  exifStr = String(exifStr).trim();
  
  // Exif datetime: "YYYY:MM:DD HH:MM:SS"
  // Match dates with colons, dashes or slashes
  const match = exifStr.match(/^(\d{4})[:/-](\d{2})[:/-](\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (match) {
    const [_, year, month, day, hour, min, sec] = match;
    const seconds = sec || '00';
    return `${year}-${month}-${day}T${hour}:${min}:${seconds}`;
  }
  
  // Fallback match date only: "YYYY:MM:DD"
  const matchDate = exifStr.match(/^(\d{4})[:/-](\d{2})[:/-](\d{2})/);
  if (matchDate) {
    const [_, year, month, day] = matchDate;
    return `${year}-${month}-${day}T00:00:00`;
  }
  
  return '';
}

// Convert datetime-local format (YYYY-MM-DDTHH:MM:SS) to EXIF date format (YYYY:MM:DD HH:MM:SS)
function datetimeLocalToExif(dateTimeStr) {
  if (!dateTimeStr) return '';
  dateTimeStr = String(dateTimeStr).trim();
  
  // Replace dashes with colons in the date part, and T with space
  // E.g., 2026-10-12T16:12:04 -> 2026:10:12 16:12:04
  let formatted = dateTimeStr.replace('T', ' ').replace(/-/g, ':');
  
  // Ensure we have seconds
  const parts = formatted.split(':');
  if (parts.length === 2) {
    formatted += ':00';
  }
  return formatted;
}


function showLoading(msg = 'Processing...') {
  loadingText.textContent = msg;
  loadingScreen.classList.remove('hidden');
}

function hideLoading() {
  loadingScreen.classList.add('hidden');
}

function isImageExt(name) {
  return /\.(jpe?g|png|gif|webp|bmp|tiff?|avif|heic|ico)$/i.test(name);
}

function iconForFile(name) {
  if (isImageExt(name)) return 'image';
  if (/\.(mp4|mov|avi|mkv|webm)$/i.test(name)) return 'videocam';
  if (/\.(mp3|wav|flac|aac|ogg)$/i.test(name)) return 'audio_file';
  if (/\.pdf$/i.test(name)) return 'picture_as_pdf';
  return 'draft';
}

function snackbar(msg) {
  const el = document.createElement('div');
  el.className = 'snackbar';
  el.textContent = msg;
  snackbarHost.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    el.addEventListener('animationend', () => el.remove());
  }, 3000);
}

function showConfirm(title, message, okText = 'OK') {
  return new Promise((resolve) => {
    const dialogOverlay = $('confirm-dialog');
    const dialogTitle = $('confirm-dialog-title');
    const dialogMessage = $('confirm-dialog-message');
    const btnCancel = $('btn-confirm-cancel');
    const btnOk = $('btn-confirm-ok');

    dialogTitle.textContent = title;
    dialogMessage.textContent = message;
    btnOk.textContent = okText;

    dialogOverlay.classList.remove('hidden');

    function cleanup(result) {
      dialogOverlay.classList.add('hidden');
      btnOk.removeEventListener('click', onOk);
      btnCancel.removeEventListener('click', onCancel);
      resolve(result);
    }

    function onOk() { cleanup(true); }
    function onCancel() { cleanup(false); }

    btnOk.addEventListener('click', onOk);
    btnCancel.addEventListener('click', onCancel);
  });
}

// ---- Prevent default drag on window ----
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => e.preventDefault());

// ---- Drag/Drop on empty state card ----
emptyCard.addEventListener('dragenter', e => { e.preventDefault(); emptyCard.classList.add('dragover'); });
emptyCard.addEventListener('dragover',  e => { e.preventDefault(); });
emptyCard.addEventListener('dragleave', e => { e.preventDefault(); emptyCard.classList.remove('dragover'); });
emptyCard.addEventListener('drop', e => {
  e.preventDefault();
  e.stopPropagation();
  emptyCard.classList.remove('dragover');
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

// ---- Open files button ----
btnOpenFiles.addEventListener('click', openNativeDialog);
btnAddMore.addEventListener('click', openNativeDialog);

async function openNativeDialog() {
  const paths = await window.traceless.selectFiles();
  if (paths.length) addFiles(paths);
}

// ---- Add files (from drag or dialog) ----
function addFiles(input) {
  for (let i = 0; i < input.length; i++) {
    const item = input[i];
    const fPath = typeof item === 'string' ? item : item.path;
    const fName = typeof item === 'string' ? fPath.split(/[\\/]/).pop() : item.name;
    const fSize = typeof item === 'string' ? 0 : (item.size || 0);
    if (files.some(f => f.path === fPath)) continue;
    files.push({ name: fName, path: fPath, size: fSize });
    addToHistory(fName, fPath, fSize);
  }
  if (files.length) {
    showWorkspace();
    renderFileList();
    if (activeIndex < 0) selectFile(0);
  }
}

// ---- UI state switching ----
function showWorkspace() {
  emptyState.classList.add('hidden');
  workspace.classList.remove('hidden');
}

function showEmpty() {
  workspace.classList.add('hidden');
  emptyState.classList.remove('hidden');
}

// ---- File list rendering ----
function renderFileList() {
  fileListEl.innerHTML = '';
  files.forEach((f, i) => {
    const el = document.createElement('div');
    el.className = 'file-list-item' + (i === activeIndex ? ' active' : '');
    el.innerHTML = `
      <span class="material-symbols-outlined" style="font-variation-settings:'FILL' 1">${iconForFile(f.name)}</span>
      <div class="file-list-item-info">
        <div class="file-list-item-name">${f.name}</div>
        <div class="file-list-item-size">${f.size ? fmtBytes(f.size) : '—'}</div>
      </div>`;
    el.addEventListener('click', () => selectFile(i));
    fileListEl.appendChild(el);
  });
}

// ---- Clear all ----
btnClearAll.addEventListener('click', () => {
  files = [];
  activeIndex = -1;
  originalMeta = null;
  dirtyTags = {};
  toggleSaveFABs(false);
  if (presetCard) {
    presetCard.classList.add('hidden');
  }
  if (btnPresetsToggle) {
    btnPresetsToggle.classList.remove('active');
  }
  showEmpty();
});

// ---- Select & load file ----
async function selectFile(idx) {
  if (idx < 0 || idx >= files.length) return;
  activeIndex = idx;
  dirtyTags = {};
  toggleSaveFABs(false);
  renderFileList();

  const f = files[idx];

  // Update preview
  previewName.textContent = f.name;
  previewSize.textContent = fmtBytes(f.size);
  previewType.textContent = extOf(f.name);

  previewMedia.innerHTML = '';
  if (isImageExt(f.name)) {
    const img = document.createElement('img');
    img.src = 'file:///' + f.path.replace(/\\/g, '/');
    img.onerror = () => {
      previewMedia.innerHTML = `<span class="material-symbols-outlined preview-placeholder" style="font-variation-settings:'FILL' 1">${iconForFile(f.name)}</span>`;
    };
    previewMedia.appendChild(img);
  } else {
    previewMedia.innerHTML = `<span class="material-symbols-outlined preview-placeholder" style="font-variation-settings:'FILL' 1">${iconForFile(f.name)}</span>`;
  }

  // Load metadata
  showLoading(`Analyzing ${f.name}...`);
  const res = await window.traceless.readMetadata(f.path);
  hideLoading();

  if (res.success) {
    originalMeta = res.data;
    if (cameraSelect) cameraSelect.value = '';
    if (metaPresetSelect) metaPresetSelect.value = '';
    if (locationSelect) locationSelect.value = '';
    renderMetadata(res.data);
  } else {
    metaGroups.innerHTML = `<p style="padding:16px;color:var(--md-sys-color-error)">${res.error}</p>`;
    snackbar('Failed to read metadata');
  }
}

// ---- Render metadata groups ----
function renderMetadata(data) {
  metaGroups.innerHTML = '';
  searchInput.value = '';
  let totalTags = 0;

  // ---- 1. Render Common Writable Fields Group ----
  const commonSection = document.createElement('div');
  commonSection.className = 'meta-group common-editor-group';
  
  const commonTitle = document.createElement('div');
  commonTitle.className = 'meta-group-title';
  commonTitle.innerHTML = `<span class="material-symbols-outlined" style="font-size:14px;vertical-align:middle;margin-right:6px;">edit</span>Edit Common Tags`;
  commonSection.appendChild(commonTitle);

  const commonGrid = document.createElement('div');
  commonGrid.className = 'meta-group-fields';

  const commonFields = [
    { label: 'Title', tag: 'Title', placeholder: 'e.g. Summer Vacation' },
    { label: 'Artist / Author', tag: 'Artist', placeholder: 'e.g. John Doe' },
    { label: 'Copyright Notice', tag: 'Copyright', placeholder: 'e.g. © 2026 John Doe' },
    { label: 'Description', tag: 'ImageDescription', placeholder: 'e.g. A beautiful scenery' },
    { label: 'Date/Time Original', tag: 'DateTimeOriginal', placeholder: 'YYYY:MM:DD HH:MM:SS' },
    { label: 'GPS Latitude', tag: 'GPSLatitude', placeholder: 'e.g. 40.7128 (N is positive, S is negative)' },
    { label: 'GPS Longitude', tag: 'GPSLongitude', placeholder: 'e.g. -74.0060 (E is positive, W is negative)' },
    { label: 'Camera Make', tag: 'Make', placeholder: 'e.g. Apple' },
    { label: 'Camera Model', tag: 'Model', placeholder: 'e.g. iPhone 15 Pro' },
    { label: 'Software / OS', tag: 'Software', placeholder: 'e.g. iOS 17.5' },
    { label: 'Lens Model', tag: 'LensModel', placeholder: 'e.g. EF24-70mm f/2.8L' }
  ];

  commonFields.forEach(f => {
    const val = findTagValue(data, f.tag);
    const valStr = val !== null && val !== undefined ? String(val) : '';

    const row = document.createElement('div');
    row.className = 'm3-field common-field';
    row.setAttribute('data-common-tag', f.tag);

    const label = document.createElement('span');
    label.className = 'm3-field-label';
    label.textContent = f.label;

    const input = document.createElement('input');
    input.className = 'm3-field-input';

    if (isDateTimeTag(f.tag)) {
      input.type = 'datetime-local';
      input.step = '1';
      input.value = exifToDatetimeLocal(valStr);

      input.addEventListener('input', () => {
        const exifVal = datetimeLocalToExif(input.value);
        const orig = String(val ?? '');
        if (exifVal !== orig) {
          dirtyTags[f.tag] = exifVal;
          input.classList.add('modified');
        } else {
          delete dirtyTags[f.tag];
          input.classList.remove('modified');
        }
        toggleSaveFABs(Object.keys(dirtyTags).length > 0);
      });
    } else {
      input.type = 'text';
      input.value = valStr;
      input.placeholder = f.placeholder;

      input.addEventListener('focus', () => console.log(`Input ${f.label} focused!`));
      input.addEventListener('click', () => console.log(`Input ${f.label} clicked!`));

      input.addEventListener('input', () => {
        const orig = String(val ?? '');
        if (input.value !== orig) {
          dirtyTags[f.tag] = input.value;
          input.classList.add('modified');
        } else {
          delete dirtyTags[f.tag];
          input.classList.remove('modified');
        }
        toggleSaveFABs(Object.keys(dirtyTags).length > 0);
      });
    }

    row.appendChild(label);
    row.appendChild(input);
    commonGrid.appendChild(row);
  });

  commonSection.appendChild(commonGrid);
  metaGroups.appendChild(commonSection);

  // ---- 2. Render Remaining Raw Groups ----
  const readOnlyGroups = new Set(['file', 'composite', 'system', 'exiftool']);

  for (const [group, tags] of Object.entries(data)) {
    if (typeof tags !== 'object' || tags === null) continue;

    const isReadOnly = readOnlyGroups.has(group.toLowerCase());
    const keys = Object.keys(tags).sort();
    if (!keys.length) continue;
    totalTags += keys.length;

    const section = document.createElement('div');
    section.className = 'meta-group';
    section.setAttribute('data-group', group.toLowerCase());

    const title = document.createElement('div');
    title.className = 'meta-group-title';
    title.textContent = group;
    section.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'meta-group-fields';

    keys.forEach(key => {
      const val = tags[key];
      const valStr = val !== null && val !== undefined ? String(val) : '';

      const row = document.createElement('div');
      row.className = 'm3-field';
      row.setAttribute('data-key', key.toLowerCase());
      row.setAttribute('data-val', valStr.toLowerCase());

      const label = document.createElement('span');
      label.className = 'm3-field-label';
      label.textContent = key;

      const input = document.createElement('input');
      input.className = 'm3-field-input';

      if (isReadOnly) {
        input.type = 'text';
        input.value = valStr;
        input.readOnly = true;
      } else if (isDateTimeTag(key)) {
        input.type = 'datetime-local';
        input.step = '1';
        input.value = exifToDatetimeLocal(valStr);

        input.addEventListener('input', () => {
          const exifVal = datetimeLocalToExif(input.value);
          const orig = String(tags[key] ?? '');
          if (exifVal !== orig) {
            dirtyTags[key] = exifVal;
            input.classList.add('modified');
          } else {
            delete dirtyTags[key];
            input.classList.remove('modified');
          }
          toggleSaveFABs(Object.keys(dirtyTags).length > 0);
        });
      } else {
        input.type = 'text';
        input.value = valStr;

        input.addEventListener('input', () => {
          const orig = String(tags[key] ?? '');
          if (input.value !== orig) {
            dirtyTags[key] = input.value;
            input.classList.add('modified');
          } else {
            delete dirtyTags[key];
            input.classList.remove('modified');
          }
          toggleSaveFABs(Object.keys(dirtyTags).length > 0);
        });
      }

      row.appendChild(label);
      row.appendChild(input);
      grid.appendChild(row);
    });

    section.appendChild(grid);
    metaGroups.appendChild(section);
  }

  tagCountEl.textContent = totalTags + ' tags';
}

// ---- Search / Filter ----
searchInput.addEventListener('input', () => {
  const q = searchInput.value.toLowerCase();
  document.querySelectorAll('.meta-group').forEach(group => {
    let anyVisible = false;
    group.querySelectorAll('.m3-field').forEach(field => {
      const k = field.getAttribute('data-key');
      const v = field.getAttribute('data-val');
      const show = k.includes(q) || v.includes(q);
      field.style.display = show ? '' : 'none';
      if (show) anyVisible = true;
    });
    group.style.display = anyVisible ? '' : 'none';
  });
});

// ---- Save (FAB) ----
async function executeSave() {
  if (activeIndex < 0 || !Object.keys(dirtyTags).length) return;
  const f = files[activeIndex];

  toggleSaveFABs(false);
  showLoading(`Saving changes to ${f.name}...`);
  const res = await window.traceless.writeMetadata(f.path, dirtyTags, true);
  hideLoading();
  
  if (res.success) {
    snackbar('Metadata saved ✓');
    await selectFile(activeIndex); // reload
  } else {
    const handled = await tryResolveExtensionMismatch(res.error, 'save');
    if (!handled) {
      snackbar('Save failed: ' + res.error);
      toggleSaveFABs(true);
    }
  }
}

fabSave.addEventListener('click', executeSave);

// ---- Reload ----
btnReload.addEventListener('click', () => {
  if (activeIndex >= 0) selectFile(activeIndex);
});

// ---- Clean all metadata ----
async function executeClean() {
  if (activeIndex < 0) return;
  const f = files[activeIndex];

  showLoading(`Scrubbing metadata from ${f.name}...`);
  const res = await window.traceless.cleanMetadata(f.path, true);
  hideLoading();
  
  if (res.success) {
    snackbar('All metadata removed ✓');
    await selectFile(activeIndex);
  } else {
    const handled = await tryResolveExtensionMismatch(res.error, 'clean');
    if (!handled) {
      snackbar('Clean failed: ' + res.error);
    }
  }
}

btnClean.addEventListener('click', async () => {
  if (activeIndex < 0) return;
  const f = files[activeIndex];
  
  const proceed = await showConfirm(
    'Strip Metadata',
    `Are you sure you want to strip ALL metadata from "${f.name}"? This action cannot be undone.`,
    'Strip All',
    true
  );
  if (!proceed) return;
  
  await executeClean();
});

// ---- Try to Resolve File Extension Mismatches ----
async function tryResolveExtensionMismatch(errorMsg, actionType) {
  if (!errorMsg) return false;
  
  // ExifTool error looks like: "Error: Not a valid JPG (looks more like a PNG)"
  const match = errorMsg.match(/looks more like a ([a-zA-Z0-9]+)/i);
  if (!match) return false;
  
  const f = files[activeIndex];
  if (!f) return false;
  
  const actualFormatName = match[1]; // e.g. "PNG"
  const actualExt = actualFormatName.toLowerCase();
  
  const extMap = {
    jpeg: 'jpg',
    tiff: 'tiff',
  };
  const targetExt = extMap[actualExt] || actualExt;
  
  const currentName = f.name;
  const nameParts = currentName.split('.');
  if (nameParts.length > 1) {
    nameParts.pop();
  }
  const baseName = nameParts.join('.');
  const newName = `${baseName}.${targetExt}`;
  
  const confirmed = await showConfirm(
    'Extension Mismatch Detected!',
    `"${f.name}" is named as a .${extOf(f.name).toLowerCase()}, but its internal data is actually ${actualFormatName}.\n\nExifTool cannot modify files with mismatched extensions.\n\nWould you like TraceLess to rename this file to "${newName}" and try again?`,
    'Rename File',
    false
  );
  
  if (!confirmed) return false;
  
  showLoading(`Renaming to ${newName}...`);
  const renameRes = await window.traceless.renameFile(f.path, newName);
  hideLoading();
  
  if (renameRes.success) {
    // Update local state
    files[activeIndex].path = renameRes.newPath;
    files[activeIndex].name = renameRes.newName;
    renderFileList();
    
    // Update preview card UI
    previewName.textContent = renameRes.newName;
    previewType.textContent = extOf(renameRes.newName);
    
    snackbar(`File renamed to ${renameRes.newName} ✓`);
    
    // Retry original action
    if (actionType === 'clean') {
      await executeClean();
    } else if (actionType === 'save') {
      await executeSave();
    }
    return true;
  } else {
    snackbar(`Rename failed: ${renameRes.error}`);
    return false;
  }
}

// ==========================================
// CAMERA PROFILES & METADATA PRESETS DATA
// ==========================================
const CAMERA_PROFILES = {
  iphone15: {
    Make: 'Apple',
    Model: 'iPhone 15 Pro',
    Software: 'iOS 17.5',
    LensModel: 'iPhone 15 Pro back triple camera 6.86mm f/1.78'
  },
  iphone13: {
    Make: 'Apple',
    Model: 'iPhone 13',
    Software: 'iOS 16.1.1',
    LensModel: 'iPhone 13 back dual camera 5.1mm f/1.6'
  },
  canon5d: {
    Make: 'Canon',
    Model: 'Canon EOS 5D Mark IV',
    Software: 'Digital Photo Professional v4.15',
    LensModel: 'EF24-70mm f/2.8L II USM'
  },
  canonr5: {
    Make: 'Canon',
    Model: 'Canon EOS R5',
    Software: 'Canon R5 Firmware v1.8.0',
    LensModel: 'RF24-105mm F4 L IS USM'
  },
  sony7iv: {
    Make: 'Sony',
    Model: 'ILCE-7M4',
    Software: 'ILCE-7M4 v2.00',
    LensModel: 'FE 24-70mm F2.8 GM II'
  },
  sony7rv: {
    Make: 'Sony',
    Model: 'ILCE-7RM5',
    Software: 'ILCE-7RM5 v1.20',
    LensModel: 'FE 16-35mm F2.8 GM II'
  },
  fujixt5: {
    Make: 'Fujifilm',
    Model: 'X-T5',
    Software: 'Digital Camera X-T5',
    LensModel: 'XF18-55mmF2.8-4 R LM OIS'
  },
  nikond850: {
    Make: 'Nikon',
    Model: 'D850',
    Software: 'D850 Ver.1.20',
    LensModel: 'AF-S Nikkor 24-70mm f/2.8E ED VR'
  },
  nikonz9: {
    Make: 'Nikon',
    Model: 'Z 9',
    Software: 'Z 9 Ver.4.00',
    LensModel: 'NIKKOR Z 24-70mm f/2.8 S'
  },
  pixel8: {
    Make: 'Google',
    Model: 'Pixel 8 Pro',
    Software: 'Android 14',
    LensModel: 'Pixel 8 Pro back camera 6.9mm f/1.68'
  },
  samsung23: {
    Make: 'samsung',
    Model: 'SM-S918B',
    Software: 'Android 13',
    LensModel: 'Galaxy S23 Ultra rear camera'
  },
  djimavic3: {
    Make: 'DJI',
    Model: 'FC3411',
    Software: 'DJI Firmware v01.00.0700',
    LensModel: '24.0 mm f/2.8'
  },
  gopro12: {
    Make: 'GoPro',
    Model: 'HERO12 Black',
    Software: 'GoPro firmware v1.10',
    LensModel: 'HERO12 Black Lens'
  },
  clear_camera: {
    Make: '',
    Model: '',
    Software: '',
    LensModel: ''
  }
};

const METADATA_PRESETS = {
  anonymous: {
    Artist: '',
    Copyright: '',
    GPSLatitude: '',
    GPSLongitude: ''
  },
  copyright_standard: {
    Artist: 'Private Owner',
    Copyright: '© 2026. All rights reserved.'
  },
  cc_by: {
    Copyright: 'Creative Commons Attribution 4.0 International (CC BY 4.0)'
  },
  strip_gps: {
    GPSLatitude: '',
    GPSLongitude: ''
  },
  windows_snip: {
    Software: 'Microsoft Windows Snipping Tool',
    Artist: 'Windows User'
  },
  windows_paint: {
    Software: 'Microsoft Windows Paint',
    Artist: 'Windows User'
  },
  photoshop_win: {
    Software: 'Adobe Photoshop CC (Windows)'
  },
  lightroom_win: {
    Software: 'Adobe Photoshop Lightroom Classic (Windows)'
  }
};

const LOCATION_PRESETS = {
  loc_nyc: {
    GPSLatitude: '40.7128',
    GPSLongitude: '-74.0060'
  },
  loc_london: {
    GPSLatitude: '51.5074',
    GPSLongitude: '-0.1278'
  },
  loc_paris: {
    GPSLatitude: '48.8566',
    GPSLongitude: '2.3522'
  },
  loc_tokyo: {
    GPSLatitude: '35.6762',
    GPSLongitude: '139.6503'
  },
  loc_sydney: {
    GPSLatitude: '-33.8688',
    GPSLongitude: '151.2093'
  },
  loc_cairo: {
    GPSLatitude: '30.0444',
    GPSLongitude: '31.2357'
  },
  loc_rome: {
    GPSLatitude: '41.9028',
    GPSLongitude: '12.4964'
  },
  loc_sf: {
    GPSLatitude: '37.7749',
    GPSLongitude: '-122.4194'
  },
  clear_gps: {
    GPSLatitude: '',
    GPSLongitude: ''
  }
};

// Apply preset values helper
function setPresetTag(tag, value) {
  // 1. Update dynamic UI common fields inputs
  const commonRow = document.querySelector(`[data-common-tag="${tag}"]`);
  if (commonRow) {
    const input = commonRow.querySelector('input');
    if (input) {
      input.value = value;
      input.classList.add('modified');
    }
  }

  // 2. Update dynamic UI raw groups inputs if they are visible
  const rawRows = document.querySelectorAll(`[data-key="${tag.toLowerCase()}"]`);
  rawRows.forEach(row => {
    const input = row.querySelector('input');
    if (input && !input.readOnly) {
      input.value = value;
      input.classList.add('modified');
    }
  });

  // 3. Mark in dirtyTags
  dirtyTags[tag] = value;
}

// Preset application event listener
if (btnApplyPresets) {
  btnApplyPresets.addEventListener('click', () => {
    if (activeIndex < 0) {
      snackbar('No file selected');
      return;
    }

    const camVal = cameraSelect.value;
    const metaVal = metaPresetSelect.value;
    const locVal = locationSelect.value;

    if (!camVal && !metaVal && !locVal) {
      snackbar('Select a Camera Profile, Metadata Preset, or Location Preset first');
      return;
    }

    let appliedTags = [];

    // Apply Camera Profile
    if (camVal && CAMERA_PROFILES[camVal]) {
      const profile = CAMERA_PROFILES[camVal];
      for (const [tag, val] of Object.entries(profile)) {
        setPresetTag(tag, val);
        appliedTags.push(tag);
      }
    }

    // Apply Metadata Preset
    if (metaVal && METADATA_PRESETS[metaVal]) {
      const preset = METADATA_PRESETS[metaVal];
      for (const [tag, val] of Object.entries(preset)) {
        setPresetTag(tag, val);
        appliedTags.push(tag);
      }
    }

    // Apply Location Preset
    if (locVal && LOCATION_PRESETS[locVal]) {
      const preset = LOCATION_PRESETS[locVal];
      for (const [tag, val] of Object.entries(preset)) {
        setPresetTag(tag, val);
        appliedTags.push(tag);
      }
    }

    if (appliedTags.length > 0) {
      toggleSaveFABs(true);
      snackbar(`Presets applied! Click "Save Changes" to apply permanently.`);
    }
  });
}


// ==========================================
// FILENAME RENAME ACTIONS
// ==========================================
function startEditingFilename() {
  if (activeIndex < 0) return;
  const f = files[activeIndex];
  
  // Show input container and hide static name
  previewName.classList.add('hidden');
  btnRenameEdit.classList.add('hidden');
  
  filenameInput.classList.remove('hidden');
  btnRenameSave.classList.remove('hidden');
  btnRenameCancel.classList.remove('hidden');
  
  // Extract filename without directories (f.name is already the base name)
  filenameInput.value = f.name;
  filenameInput.focus();
  filenameInput.select();
}

function stopEditingFilename() {
  previewName.classList.remove('hidden');
  btnRenameEdit.classList.remove('hidden');
  
  filenameInput.classList.add('hidden');
  btnRenameSave.classList.add('hidden');
  btnRenameCancel.classList.add('hidden');
}

async function saveFilename() {
  if (activeIndex < 0) return;
  const f = files[activeIndex];
  const newName = filenameInput.value.trim();
  
  if (!newName) {
    snackbar('Filename cannot be empty');
    return;
  }
  
  // Validate characters (no invalid characters for Windows/macOS/Linux)
  if (/[\\/:*?"<>|]/.test(newName)) {
    snackbar('Filename contains invalid characters (\\ / : * ? " < > |)');
    return;
  }

  showLoading(`Renaming to ${newName}...`);
  const res = await window.traceless.renameFile(f.path, newName);
  hideLoading();

  if (res.success) {
    // Update local state
    files[activeIndex].path = res.newPath;
    files[activeIndex].name = res.newName;

    // Refresh layout
    previewName.textContent = res.newName;
    previewType.textContent = extOf(res.newName);
    
    // Rerender sidebar
    renderFileList();
    
    snackbar('File renamed successfully ✓');
    stopEditingFilename();
  } else {
    snackbar('Rename failed: ' + res.error);
  }
}

if (btnRenameEdit) {
  btnRenameEdit.addEventListener('click', startEditingFilename);
}
if (btnRenameCancel) {
  btnRenameCancel.addEventListener('click', stopEditingFilename);
}
if (btnRenameSave) {
  btnRenameSave.addEventListener('click', saveFilename);
}
if (filenameInput) {
  filenameInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      saveFilename();
    } else if (e.key === 'Escape') {
      stopEditingFilename();
    }
  });
}

// ==========================================
// FILE SHARING ACTIONS
// ==========================================
if (btnShare) {
  btnShare.addEventListener('click', (e) => {
    e.stopPropagation();
    if (activeIndex < 0) {
      snackbar('No active file to share');
      return;
    }
    shareMenu.classList.toggle('hidden');
  });
}

if (btnShareFolder) {
  btnShareFolder.addEventListener('click', async () => {
    if (activeIndex < 0) return;
    shareMenu.classList.add('hidden');
    const f = files[activeIndex];
    await window.traceless.showItemInFolder(f.path);
  });
}

if (btnShareCopy) {
  btnShareCopy.addEventListener('click', async () => {
    if (activeIndex < 0) return;
    shareMenu.classList.add('hidden');
    const f = files[activeIndex];
    const res = await window.traceless.copyFileToClipboard(f.path);
    if (res.success) {
      snackbar('File copied to clipboard! Paste it anywhere.');
    } else {
      snackbar('Failed to copy file: ' + res.error);
    }
  });
}

if (btnSharePath) {
  btnSharePath.addEventListener('click', async () => {
    if (activeIndex < 0) return;
    shareMenu.classList.add('hidden');
    const f = files[activeIndex];
    const res = await window.traceless.copyTextToClipboard(f.path);
    if (res.success) {
      snackbar('File path copied to clipboard!');
    } else {
      snackbar('Failed to copy path: ' + res.error);
    }
  });
}

// Click outside menu to close it
document.addEventListener('click', (e) => {
  if (shareMenu && !shareMenu.classList.contains('hidden')) {
    if (!shareMenu.contains(e.target) && e.target !== btnShare) {
      shareMenu.classList.add('hidden');
    }
  }
});

// ---- Custom MD3 Confirm Dialog ----
function showConfirm(title, message, confirmBtnText = 'Confirm', isDanger = true) {
  return new Promise((resolve) => {
    const dialog = $('confirm-dialog');
    const titleEl = $('confirm-dialog-title');
    const msgEl = $('confirm-dialog-message');
    const cancelBtn = $('btn-confirm-cancel');
    const okBtn = $('btn-confirm-ok');

    if (!dialog || !titleEl || !msgEl || !cancelBtn || !okBtn) {
      console.error('Custom dialog DOM components are missing!');
      resolve(false);
      return;
    }

    titleEl.textContent = title;
    msgEl.innerHTML = message.replace(/\n/g, '<br>');
    okBtn.textContent = confirmBtnText;

    // Set buttons styling
    if (isDanger) {
      okBtn.className = 'm3-btn m3-btn-filled m3-btn-error';
    } else {
      okBtn.className = 'm3-btn m3-btn-filled';
    }

    dialog.classList.remove('hidden');

    const cleanUp = () => {
      dialog.classList.add('hidden');
      okBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
    };

    const onConfirm = () => {
      cleanUp();
      resolve(true);
    };

    const onCancel = () => {
      cleanUp();
      resolve(false);
    };

    okBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  });
}

// ---- Theme Toggle ----
function initTheme() {
  console.log('initTheme called');
  const savedTheme = localStorage.getItem('theme') || 'dark';
  console.log('Saved theme preference is:', savedTheme);
  if (savedTheme === 'light') {
    document.documentElement.classList.add('light-theme');
  } else {
    document.documentElement.classList.remove('light-theme');
  }
  console.log('Document classes:', document.documentElement.className);
  if (themeIcon) {
    themeIcon.textContent = savedTheme === 'dark' ? 'light_mode' : 'dark_mode';
    console.log('themeIcon text content set to:', themeIcon.textContent);
  } else {
    console.error('themeIcon element is null!');
  }
}

if (btnTheme) {
  console.log('btnTheme element found, adding click listener');
  btnTheme.addEventListener('click', () => {
    console.log('Theme toggle button clicked!');
    const isLight = document.documentElement.classList.contains('light-theme');
    const newTheme = isLight ? 'dark' : 'light';
    console.log('Switching theme to:', newTheme);
    if (newTheme === 'light') {
      document.documentElement.classList.add('light-theme');
    } else {
      document.documentElement.classList.remove('light-theme');
    }
    localStorage.setItem('theme', newTheme);
    if (themeIcon) {
      themeIcon.textContent = newTheme === 'dark' ? 'light_mode' : 'dark_mode';
    }
    snackbar(`Switched to ${newTheme} mode`);
  });
} else {
  console.error('btnTheme element is null!');
}

initTheme();

// ---- Custom Window Controls ----
const btnMinimize = $('btn-minimize');
const btnMaximize = $('btn-maximize');
const btnClose = $('btn-close');

if (btnMinimize) {
  btnMinimize.addEventListener('click', () => window.traceless.minimize());
}
if (btnMaximize) {
  btnMaximize.addEventListener('click', () => window.traceless.maximize());
}
if (btnClose) {
  btnClose.addEventListener('click', () => window.traceless.close());
}

// ---- Disable Context Menu ----
window.addEventListener('contextmenu', e => e.preventDefault());

// ---- Presets Toggle ----
console.log('DOM Check - btnPresetsToggle:', btnPresetsToggle, 'presetCard:', presetCard);
if (btnPresetsToggle && presetCard) {
  console.log('btnPresetsToggle listener registered successfully!');
  btnPresetsToggle.addEventListener('click', () => {
    console.log('btnPresetsToggle clicked!');
    presetCard.classList.toggle('hidden');
    btnPresetsToggle.classList.toggle('active');
    console.log('presetCard classes after toggle:', presetCard.className);
  });
} else {
  console.error('btnPresetsToggle or presetCard not found in DOM!');
}

// ==========================================
// INTERACTIVE SANDBOX DEMO LOGIC
// ==========================================
let sandboxScrubbed = false;

if (btnSandboxScrub) {
  btnSandboxScrub.addEventListener('click', () => {
    sandboxScrubbed = !sandboxScrubbed;
    
    if (sandboxScrubbed) {
      // Transition to scrubbed/redacted state
      sandboxPin.textContent = 'verified_user';
      sandboxPin.classList.add('redacted');
      
      sandboxGpsBadge.textContent = 'GPS Coordinates: [REDACTED]';
      sandboxGpsBadge.classList.add('redacted');
      
      valSandboxDevice.textContent = '[REDACTED]';
      valSandboxDevice.classList.add('redacted');
      
      valSandboxLocation.textContent = '[REDACTED] (Private Location)';
      valSandboxLocation.classList.add('redacted');
      
      valSandboxDate.textContent = '[REDACTED] (Original Time Stripped)';
      valSandboxDate.classList.add('redacted');
      
      iconSandboxScrub.textContent = 'refresh';
      textSandboxScrub.textContent = 'Restore Demo Data';
      btnSandboxScrub.className = 'm3-btn m3-btn-tonal sandbox-action-btn';
      
      snackbar('Demo file successfully anonymized!');
    } else {
      // Restore back to original state
      sandboxPin.textContent = 'pin_drop';
      sandboxPin.classList.remove('redacted');
      
      sandboxGpsBadge.textContent = 'GPS Coordinates: 37.7749° N, 122.4194° W';
      sandboxGpsBadge.classList.remove('redacted');
      
      valSandboxDevice.textContent = 'iPhone 15 Pro (Sn: 897FA88B)';
      valSandboxDevice.classList.remove('redacted');
      
      valSandboxLocation.textContent = '37.7749° N, 122.4194° W (San Francisco, CA)';
      valSandboxLocation.classList.remove('redacted');
      
      valSandboxDate.textContent = '2026:10:12 16:12:04 (Original Time)';
      valSandboxDate.classList.remove('redacted');
      
      iconSandboxScrub.textContent = 'cleaning_services';
      textSandboxScrub.textContent = 'Scrub Demo Metadata';
      btnSandboxScrub.className = 'm3-btn m3-btn-filled sandbox-action-btn';
    }
  });
}

// ==========================================
// EXPORT / SAVE AS OPERATIONS
// ==========================================
async function executeSaveAs() {
  if (activeIndex < 0 || !Object.keys(dirtyTags).length) return;
  const f = files[activeIndex];
  
  // 1. Get save file location using Electron's native dialog
  const ext = f.name.split('.').pop() || '';
  const filters = ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [];
  
  const targetPath = await window.traceless.showSaveDialog(f.path, filters);
  if (!targetPath) return; // user cancelled

  toggleSaveFABs(false);
  showLoading(`Saving a copy to ${targetPath.split(/[\\/]/).pop()}...`);
  
  const res = await window.traceless.saveAs(f.path, targetPath, dirtyTags, false);
  hideLoading();
  
  if (res.success) {
    snackbar('Cleaned copy saved successfully ✓');
    
    // Add the new file to our file list and select it
    const newName = targetPath.split(/[\\/]/).pop();
    const newSize = f.size;
    
    files.push({ name: newName, path: targetPath, size: newSize });
    addToHistory(newName, targetPath, newSize);
    await selectFile(files.length - 1);
  } else {
    snackbar('Save As failed: ' + res.error);
    toggleSaveFABs(true);
  }
}

async function executeCleanSaveAs() {
  if (activeIndex < 0) return;
  const f = files[activeIndex];
  
  // 1. Get save file location using Electron's native dialog
  const ext = f.name.split('.').pop() || '';
  const filters = ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [];
  
  const targetPath = await window.traceless.showSaveDialog(f.path, filters);
  if (!targetPath) return; // user cancelled
  
  showLoading(`Scrubbing and saving copy to ${targetPath.split(/[\\/]/).pop()}...`);
  
  const res = await window.traceless.saveAs(f.path, targetPath, null, true);
  hideLoading();
  
  if (res.success) {
    snackbar('Fully scrubbed copy saved successfully ✓');
    
    // Add the new file to our list and select it
    const newName = targetPath.split(/[\\/]/).pop();
    const newSize = f.size;
    
    files.push({ name: newName, path: targetPath, size: newSize });
    addToHistory(newName, targetPath, newSize);
    await selectFile(files.length - 1);
  } else {
    snackbar('Clean & Save As failed: ' + res.error);
  }
}

if (fabSaveAs) {
  fabSaveAs.addEventListener('click', executeSaveAs);
}

if (btnCleanSaveAs) {
  btnCleanSaveAs.addEventListener('click', executeCleanSaveAs);
}

// ==========================================
// INTERACTIVE DONATION WIDGET LOGIC
// ==========================================
const btnWidgetDonate = $('btn-widget-donate');
const donationCustomContainer = $('donation-custom-container');
const donationCustomAmountInput = $('donation-custom-amount');

const paypalBaseUrl = "https://paypal.me/Benttisse";

function updateWidgetDonationLink(amount) {
  if (btnWidgetDonate) {
    if (amount && amount !== 'custom') {
      btnWidgetDonate.href = `${paypalBaseUrl}/${amount}`;
    } else if (amount === 'custom') {
      const customVal = donationCustomAmountInput ? donationCustomAmountInput.value.trim() : '';
      if (customVal && Number(customVal) > 0) {
        btnWidgetDonate.href = `${paypalBaseUrl}/${customVal}`;
      } else {
        btnWidgetDonate.href = paypalBaseUrl;
      }
    } else {
      btnWidgetDonate.href = paypalBaseUrl;
    }
  }
}

document.querySelectorAll('.donation-preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    // Remove active class from all preset buttons
    document.querySelectorAll('.donation-preset-btn').forEach(b => b.classList.remove('active'));
    
    // Add active class to clicked button
    btn.classList.add('active');
    
    const amount = btn.getAttribute('data-amount');
    
    if (amount === 'custom') {
      if (donationCustomContainer) {
        donationCustomContainer.classList.remove('hidden');
      }
      updateWidgetDonationLink('custom');
    } else {
      if (donationCustomContainer) {
        donationCustomContainer.classList.add('hidden');
      }
      updateWidgetDonationLink(amount);
    }
  });
});

if (donationCustomAmountInput) {
  donationCustomAmountInput.addEventListener('input', () => {
    updateWidgetDonationLink('custom');
  });
}

// ==========================================
// PROCESSING HISTORY SECTION LOGIC
// ==========================================
const btnClearHistory = $('btn-clear-history');

function addToHistory(name, path, size) {
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem('traceless_history') || '[]');
  } catch (e) {
    history = [];
  }
  
  // Filter out existing item with same path to avoid duplicates
  history = history.filter(item => item.path !== path);
  
  // Add new item at the beginning
  history.unshift({
    name,
    path,
    size,
    timestamp: Date.now()
  });
  
  // Keep only last 10 items
  if (history.length > 10) {
    history = history.slice(0, 10);
  }
  
  localStorage.setItem('traceless_history', JSON.stringify(history));
  renderHistory();
}

function removeFromHistory(path) {
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem('traceless_history') || '[]');
  } catch (e) {
    history = [];
  }
  
  history = history.filter(item => item.path !== path);
  localStorage.setItem('traceless_history', JSON.stringify(history));
  renderHistory();
}

function clearHistory() {
  localStorage.removeItem('traceless_history');
  renderHistory();
}

function renderHistory() {
  const container = $('history-list');
  if (!container) return;
  
  let history = [];
  try {
    history = JSON.parse(localStorage.getItem('traceless_history') || '[]');
  } catch (e) {
    history = [];
  }
  
  if (history.length === 0) {
    container.innerHTML = `
      <div class="history-empty-state">
        <span class="material-symbols-outlined">folder_open</span>
        <span>No recently processed files</span>
      </div>
    `;
    return;
  }
  
  container.innerHTML = '';
  history.forEach(item => {
    const el = document.createElement('div');
    el.className = 'history-item';
    
    // Get corresponding file icon using the existing iconForFile function
    const icon = iconForFile(item.name);
                 
    el.innerHTML = `
      <div class="history-item-left" title="Click to open: ${item.path}">
        <span class="material-symbols-outlined history-item-icon">${icon}</span>
        <div class="history-item-details">
          <span class="history-item-name">${item.name}</span>
          <span class="history-item-path">${item.path}</span>
        </div>
      </div>
      <button class="m3-icon-btn history-item-remove" title="Remove from history">
        <span class="material-symbols-outlined">close</span>
      </button>
    `;
    
    // Click left side to open/reselect file
    const leftSide = el.querySelector('.history-item-left');
    leftSide.addEventListener('click', () => {
      addFiles([{ path: item.path, name: item.name, size: item.size }]);
    });
    
    // Click remove button to clear from history
    const removeBtn = el.querySelector('.history-item-remove');
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFromHistory(item.path);
    });
    
    container.appendChild(el);
  });
}

// Wire up Clear History button
if (btnClearHistory) {
  btnClearHistory.addEventListener('click', () => {
    clearHistory();
  });
}

// Initial render of history
renderHistory();

// ==========================================
// HISTORY DRAWER TOGGLE LOGIC
// ==========================================
const historyDrawer      = $('history-drawer');
const historyDrawerScrim = $('history-drawer-scrim');
const btnDrawerToggle    = $('btn-history-drawer-toggle');
const btnDrawerClose     = $('btn-history-drawer-close');

function openHistoryDrawer() {
  if (!historyDrawer || !historyDrawerScrim) return;
  historyDrawer.classList.add('open');
  historyDrawerScrim.classList.remove('hidden');
  // Allow the display change before adding the visible class for the transition
  requestAnimationFrame(() => {
    historyDrawerScrim.classList.add('visible');
  });
}

function closeHistoryDrawer() {
  if (!historyDrawer || !historyDrawerScrim) return;
  historyDrawer.classList.remove('open');
  historyDrawerScrim.classList.remove('visible');
  // Wait for transition to end before hiding
  setTimeout(() => {
    historyDrawerScrim.classList.add('hidden');
  }, 300);
}

if (btnDrawerToggle) {
  btnDrawerToggle.addEventListener('click', openHistoryDrawer);
}
if (btnDrawerClose) {
  btnDrawerClose.addEventListener('click', closeHistoryDrawer);
}
if (historyDrawerScrim) {
  historyDrawerScrim.addEventListener('click', closeHistoryDrawer);
}

// ==========================================
// AUTO-UPDATE NOTIFICATION UI
// ==========================================
const updateOverlay       = $('update-overlay');
const updateToast         = $('update-toast');
const updateTitle         = $('update-title');
const updateVersionBadge  = $('update-version-badge');
const updateHeaderIcon    = $('update-header-icon');
const releaseNotesContent = $('release-notes-content');
const updateProgressSection = $('update-progress-section');
const updateProgressFill  = $('update-progress-fill');
const updateProgressText  = $('update-progress-text');
const updateActions       = $('update-actions');
const btnUpdateClose      = $('btn-update-close');
const btnUpdateLater      = $('btn-update-later');
const btnUpdateDownload   = $('btn-update-download');
const btnUpdateInstall    = $('btn-update-install');
const btnToastView        = $('btn-toast-view');
const btnToastClose       = $('btn-toast-close');
const toastTitle          = $('toast-title');
const toastSubtitle       = $('toast-subtitle');

let pendingUpdateInfo = null;

// Listen for update status from main process
if (window.traceless.onUpdateStatus) {
  window.traceless.onUpdateStatus((data) => {
    handleUpdateStatus(data);
  });
}

function handleUpdateStatus(data) {
  switch (data.status) {
    case 'available':
      pendingUpdateInfo = data;
      showUpdateToast(data);
      break;

    case 'downloading':
      showDownloadProgress(data);
      break;

    case 'downloaded':
      pendingUpdateInfo = data;
      showUpdateReady(data);
      break;

    case 'error':
      console.error('[Update] Error:', data.message);
      break;

    case 'not-available':
      // Silently do nothing
      break;
  }
}

// --- Toast (non-intrusive bottom-right notification) ---
function showUpdateToast(data) {
  if (!updateToast) return;
  toastTitle.textContent = 'Update Available';
  toastSubtitle.textContent = `Version ${data.version} is ready to download`;
  updateToast.classList.remove('hidden');
}

function hideUpdateToast() {
  if (updateToast) updateToast.classList.add('hidden');
}

// --- Full overlay modal with release notes ---
function showUpdateOverlay(data) {
  if (!updateOverlay) return;

  hideUpdateToast();

  // Reset state
  updateHeaderIcon.textContent = 'system_update';
  updateTitle.textContent = 'Update Available';
  updateVersionBadge.textContent = `v${data.version}`;
  updateProgressSection.classList.add('hidden');
  btnUpdateDownload.classList.remove('hidden');
  btnUpdateInstall.classList.add('hidden');
  btnUpdateLater.classList.remove('hidden');

  // Parse and render release notes
  renderReleaseNotes(data.releaseNotes, data.version);

  updateOverlay.classList.remove('hidden');
}

function hideUpdateOverlay() {
  if (updateOverlay) updateOverlay.classList.add('hidden');
}

function renderReleaseNotes(notes, version) {
  if (!releaseNotesContent) return;

  if (!notes || notes.trim() === '') {
    releaseNotesContent.innerHTML = `
      <p>Version <strong>${version}</strong> includes bug fixes and improvements.</p>
      <p>Update now to get the latest features and security enhancements.</p>
    `;
    return;
  }

  // If notes is HTML (from GitHub), use it directly but sanitize basic XSS
  let safeNotes = notes;
  // Strip script tags for safety
  safeNotes = safeNotes.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  safeNotes = safeNotes.replace(/on\w+="[^"]*"/gi, '');
  safeNotes = safeNotes.replace(/on\w+='[^']*'/gi, '');

  releaseNotesContent.innerHTML = safeNotes;
}

// --- Download Progress ---
function showDownloadProgress(data) {
  if (!updateOverlay || updateOverlay.classList.contains('hidden')) return;

  updateProgressSection.classList.remove('hidden');
  btnUpdateDownload.classList.add('hidden');
  btnUpdateLater.classList.add('hidden');

  updateProgressFill.style.width = `${data.percent}%`;
  updateProgressText.textContent = `Downloading... ${data.percent}%`;

  updateTitle.textContent = 'Downloading Update';
  updateHeaderIcon.textContent = 'downloading';
}

// --- Update Ready (downloaded, waiting for restart) ---
function showUpdateReady(data) {
  if (!updateOverlay) return;

  // If overlay is hidden, show the toast again with "ready" message
  if (updateOverlay.classList.contains('hidden')) {
    toastTitle.textContent = 'Update Ready!';
    toastSubtitle.textContent = `v${data.version} downloaded — click to install`;
    updateToast.classList.remove('hidden');
    return;
  }

  updateTitle.textContent = 'Update Ready!';
  updateHeaderIcon.textContent = 'check_circle';
  updateVersionBadge.textContent = `v${data.version}`;
  updateProgressSection.classList.add('hidden');
  btnUpdateDownload.classList.add('hidden');
  btnUpdateInstall.classList.remove('hidden');
  btnUpdateLater.classList.remove('hidden');
  btnUpdateLater.textContent = 'Later';

  if (data.releaseNotes) {
    renderReleaseNotes(data.releaseNotes, data.version);
  }
}

// --- Event Listeners ---
if (btnToastView) {
  btnToastView.addEventListener('click', () => {
    if (pendingUpdateInfo) {
      showUpdateOverlay(pendingUpdateInfo);
    }
  });
}

if (btnToastClose) {
  btnToastClose.addEventListener('click', hideUpdateToast);
}

if (btnUpdateClose) {
  btnUpdateClose.addEventListener('click', hideUpdateOverlay);
}

if (btnUpdateLater) {
  btnUpdateLater.addEventListener('click', hideUpdateOverlay);
}

if (btnUpdateDownload) {
  btnUpdateDownload.addEventListener('click', () => {
    if (window.traceless.downloadUpdate) {
      window.traceless.downloadUpdate();
      btnUpdateDownload.disabled = true;
      btnUpdateDownload.innerHTML = `
        <span class="material-symbols-outlined">hourglass_top</span>
        Starting Download...
      `;
    }
  });
}

if (btnUpdateInstall) {
  btnUpdateInstall.addEventListener('click', () => {
    if (window.traceless.installUpdate) {
      window.traceless.installUpdate();
    }
  });
}
