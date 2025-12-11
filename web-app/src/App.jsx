import React, { useRef, useState, useEffect } from 'react';
import axios from 'axios';
import './App.css';

const API = 'http://localhost:5000';

export default function App() {
  // CHANGED: State now holds an object for front and back images
  const [images, setImages] = useState({ front: null, back: null });
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [maskPII, setMaskPII] = useState(false);
  
  // Refs (Only used for Front image preview logic for now)
  const imgRef = useRef();
  const canvasRef = useRef();

  // CHANGED: Handle image upload for specific type (front/back)
  const handleImage = (type, e) => {
    const file = e.target.files[0];
    if (file) {
      setImages(prev => ({ 
        ...prev, 
        [type]: { file, url: URL.createObjectURL(file) } 
      }));
      setResult(null); 
    }
  };

  const scan = async () => {
    if (!images.front) {
        alert("Front image is required!");
        return;
    }
    setLoading(true);
    setResult(null);

    const fd = new FormData();
    // CHANGED: Append named fields 'front' and 'back'
    fd.append('front', images.front.file);
    if (images.back) {
        fd.append('back', images.back.file);
    }

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

  // Canvas Drawing Logic (Only applies to FRONT image for preview)
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    
    // Clear canvas if no result or no front image
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    if (!result || !img || !canvas || !images.front) return;
    
    const renderBoxes = () => {
        const ctx = canvas.getContext('2d');
        const sx = img.clientWidth / img.naturalWidth;
        const sy = img.clientHeight / img.naturalHeight;

        canvas.width = img.clientWidth;
        canvas.height = img.clientHeight;
        
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        // Only render boxes if we are strictly masking or if confidence is high
        (result.bounding_boxes || []).forEach(b => {
          const x = b.bbox.x0 * sx;
          const y = b.bbox.y0 * sy;
          const w = (b.bbox.x1 - b.bbox.x0) * sx;
          const h = (b.bbox.y1 - b.bbox.y0) * sy;

          if (maskPII && /[0-9]{4}|total|name|address|dob/i.test(b.text)) {
            ctx.fillStyle = 'black';
            ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
          } else if (!maskPII) {
            ctx.strokeStyle = '#06b6d4'; 
            ctx.lineWidth = 2;
            ctx.strokeRect(x, y, w, h);
          }
        });
    };

    if (img.complete) renderBoxes();
    else img.onload = renderBoxes;

  }, [result, maskPII, images.front]);

  const formatKey = (str) => (str || '').replace(/_/g, ' ');
  const formatValue = (val) => (val && val !== 'Not detected') ? val : '—';

  return (
    <div className="app-container">
      <header>
        <div className="brand">
          <div className="logo-mark"></div>
          <span style={{ fontSize: '1.5rem', fontWeight: 'bold' }}>VeriScan</span>
        </div>
        <h1>Intelligent Document Processing</h1>
        <p className="subtitle">Securely extract data from Passports, IDs, and Invoices with AI.</p>
      </header>

      <div className="main-grid">
        {/* LEFT COLUMN: UPLOAD */}
        <div className="glass-card">
          <div className="card-header">
            <h2>Document Upload</h2>
          </div>
          
          {/* FRONT UPLOAD */}
          <div className="upload-wrapper" style={{marginBottom: '10px'}}>
            <label className="upload-label">Front Side (Required)</label>
            <input type="file" accept="image/*" onChange={(e) => handleImage('front', e)} id="upload-front" hidden />
            <label htmlFor="upload-front" className="upload-zone small">
                {images.front ? (
                <div className="preview-container">
                    <img ref={imgRef} src={images.front.url} alt="front" className="preview-img" />
                    <canvas ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, pointerEvents: 'none' }} />
                </div>
                ) : (
                <div className="empty-state">
                    <span style={{ fontSize: '1.5rem' }}>📄</span>
                    <p>Upload Front Side</p>
                </div>
                )}
            </label>
          </div>

          {/* BACK UPLOAD */}
          <div className="upload-wrapper">
             <label className="upload-label">Back Side (Optional)</label>
             <input type="file" accept="image/*" onChange={(e) => handleImage('back', e)} id="upload-back" hidden />
             <label htmlFor="upload-back" className="upload-zone small" style={{borderStyle: 'dashed'}}>
                {images.back ? (
                <div className="preview-container">
                    <img src={images.back.url} alt="back" className="preview-img" />
                </div>
                ) : (
                <div className="empty-state">
                    <span style={{ fontSize: '1.5rem' }}>🔄</span>
                    <p>Upload Back Side</p>
                </div>
                )}
            </label>
          </div>

          <div className="action-bar">
            <button className="btn btn-secondary" onClick={() => { setImages({front:null, back:null}); setResult(null); }}>
              Reset
            </button>
            <button className="btn btn-primary" onClick={scan} disabled={loading || !images.front}>
              {loading ? <>Processing...</> : <>Scan Document ⚡</>}
            </button>
          </div>
        </div>

        {/* RIGHT COLUMN: RESULTS */}
        <div className="glass-card">
          <div className="card-header">
            <h2>Extraction Results</h2>
          </div>

          <div className="result-content">
            {!result ? (
              <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', opacity: 0.5, flexDirection: 'column' }}>
                <span style={{ fontSize: '3rem', marginBottom: '1rem' }}>🔍</span>
                <p>Waiting for document...</p>
              </div>
            ) : (
              <>
                <div className="doc-tag">
                  {(result.type || 'Unknown Type').replace(/_/g, ' ')}
                </div>
                
                <div className="fields-grid">
                  {Object.entries(result.fields || {}).map(([key, value]) => (
                    <div key={key} className="field-item">
                      <div className="field-label">{formatKey(key)}</div>
                      <div className="field-value">{formatValue(value)}</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>

          {result && (
            <div className="action-bar">
               <button 
                  className="btn btn-secondary" 
                  onClick={() => setMaskPII(!maskPII)}
                  style={{ borderColor: maskPII ? '#f59e0b' : '' }}
                >
                  {maskPII ? '👁️ Unmask Data' : '🔒 Mask PII'}
                </button>
                <button className="btn btn-primary" onClick={sanitize} style={{ background: '#10b981' }}>
                  Download Sanitized 📥
                </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}