// Drag-and-drop (or click-to-browse) file input with a small preview.
//
// Props:
//   file       — { filename, download_url } | null (existing attached file)
//   onFile(f)  — called with a File object when the user selects one
//   onClear()  — remove the attached file
//   busy       — show a spinner overlay
//   accept     — e.g. "application/pdf"
//   label      — override the default prompt text

window.Dropzone = function Dropzone({ file, onFile, onClear, busy, accept = 'application/pdf', label }) {
  const [dragging, setDragging] = React.useState(false);
  const inputRef = React.useRef(null);

  function handleFiles(list) {
    if (!list || list.length === 0) return;
    onFile(list[0]);
  }

  return (
    <div className={`dropzone ${dragging ? 'dragging' : ''} ${busy ? 'busy' : ''}`}
         onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
         onDragLeave={() => setDragging(false)}
         onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
         onClick={() => !busy && inputRef.current?.click()}>
      <input type="file" accept={accept} ref={inputRef} style={{ display: 'none' }}
             onChange={(e) => handleFiles(e.target.files)} />
      {file ? (
        <div className="dropzone-attached">
          <span>📎 <a href={file.download_url} target="_blank" onClick={(e) => e.stopPropagation()}>{file.filename}</a></span>
          <button type="button" onClick={(e) => { e.stopPropagation(); onClear(); }}>Remove</button>
        </div>
      ) : (
        <div className="dropzone-prompt">
          {busy ? 'Uploading…' : (label || 'Drop a PDF here, or click to browse')}
        </div>
      )}
    </div>
  );
};
