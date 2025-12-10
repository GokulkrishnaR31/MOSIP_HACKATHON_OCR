// web-app/src/App.jsx — GHOST IMAGE FIX
import React, { useRef, useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API = 'http://localhost:5000';

export default function App() {
  const [image, setImage] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [maskPII, setMaskPII] = useState(false);
  const imgRef = useRef();
  const canvasRef = useRef();

  const handleImage = (e) => {
    const file = e.target.files[0];
    if (file) {
      setImage({ file, url: URL.createObjectURL(file) });
      setResult(null); // Reset result
    }
  };

  const scan = async () => {
    if (!image) return;
    setLoading(true);
    setResult(null);
    const fd = new FormData();
    fd.append('image', image.file);

    try {
      const res = await axios.post(`${API}/scan`, fd);
      setResult(res.data.data);
    } catch (err) {
      console.error(err);
      alert('Error: ' + (err.response?.data?.error || err.message));
    } finally {
      setLoading(false);
    }
  };

  const sanitize = async () => {
    if (!result) return;
    const boxes = result.bounding_boxes || [];
    const masks = boxes
      .filter(b => b.text && /[0-9]{4}|total|amount|name|address|license|dob/i.test(b.text))
      .map(b => b.bbox);

    try {
      const res = await axios.post(`${API}/sanitize`, {
        source_file: result.source_file,
        masks
      }, { responseType: 'arraybuffer' });

      const blob = new Blob([res.data], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = 'sanitized_document.png'; 
      a.click();
    } catch (err) {
      alert("Sanitization failed.");
    }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    
    // 1. ALWAYS CLEAR CANVAS FIRST (Fixes the ghost image bug)
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // Reset canvas size to match CSS display size to prevent distortion
      if (img) {
          canvas.width = img.clientWidth;
          canvas.height = img.clientHeight;
      }
    }

    // 2. STOP IF NO RESULT (Leave canvas transparent)
    if (!result || !img || !canvas) return;

    const ctx = canvas.getContext('2d');
    
    // 3. DRAW ONLY IF WE HAVE RESULTS
    const renderBoxes = () => {
        const sx = img.clientWidth / img.naturalWidth;
        const sy = img.clientHeight / img.naturalHeight;

        canvas.width = img.clientWidth;
        canvas.height = img.clientHeight;
        
        // Draw the image onto canvas (optional, but good for masking preview)
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        (result.bounding_boxes || []).forEach(b => {
          const x = b.bbox.x0 * sx;
          const y = b.bbox.y0 * sy;
          const w = (b.bbox.x1 - b.bbox.x0) * sx;
          const h = (b.bbox.y1 - b.bbox.y0) * sy;

          if (maskPII && /[0-9]{4}|total|name|address|dob/i.test(b.text)) {
            ctx.fillStyle = 'black';
            ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
          } else {
            ctx.strokeStyle = '#10b981';
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
          }
        });
    };

    if (img.complete) renderBoxes();
    else img.onload = renderBoxes;

  }, [result, maskPII, image]); // Added 'image' dependency to trigger clear on new upload

  const formatKey = (str) => (str || '').replace(/_/g, ' ');
  const formatValue = (val) => (val && val !== 'Not detected') ? val : '—';

  return (
    <div className="container">
      <header>
        <div className="logo">VeriScan</div>
        <h1>VeriScan — Universal OCR</h1>
        <p>Supports: Aadhaar, Pan Card, US DL, Passports & Invoices</p>
      </header>

      <div className="main-content">
        <div className="upload-card">
          <input type="file" accept="image/*" onChange={handleImage} id="upload" hidden />
          <label htmlFor="upload" className="file-drop-zone">
            {image ? (
              <div style={{ position: 'relative', width: '100%' }}>
                <img ref={imgRef} src={image.url} alt="doc" className="preview-img" />
                <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none', width: '100%' }} />
              </div>
            ) : (
              <div>
                <div className="file-icon">📂</div>
                <p>Click to upload document</p>
              </div>
            )}
          </label>

          <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
            <button className="scan-btn" onClick={scan} disabled={loading || !image}>
              {loading ? 'Processing...' : 'Scan Document'}
            </button>
            <label htmlFor="upload" className="scan-btn" style={{ background: '#334155', textAlign:'center', cursor:'pointer' }}>Reset</label>
          </div>
        </div>

        <div className="result-card">
          <h2>Verified Extraction</h2>
          {!result && <div className="placeholder">Upload a document to analyze</div>}
          {result && (
            <>
              <div style={{ marginBottom: 20, fontSize: '1.1rem', color: '#94a3b8' }}>
                <strong>Document:</strong> <span style={{color: '#fff', textTransform: 'capitalize'}}>
                    {(result.type || 'Unknown').replace(/_/g, ' ')}
                </span>
              </div>
              <div className="data-list">
                {Object.entries(result.fields || {}).map(([key, value]) => (
                  <div key={key} className="field-box">
                    <div className="field-label">{formatKey(key)}</div>
                    <div className="field-value">{formatValue(value)}</div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 24, display: 'flex', gap: 12 }}>
                <button className="scan-btn" onClick={() => setMaskPII(!maskPII)} style={{ background: maskPII ? '#f59e0b' : '#334155' }}>
                  {maskPII ? 'Unmask Data' : 'Mask Sensitive Info'}
                </button>
                <button className="scan-btn" onClick={sanitize} style={{ background: '#0ea5e9' }}>
                  Sanitize & Download
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}