const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const { exec } = require('child_process');

const { runOCR } = require('./parsers/ocrEngine');
const { parsePAN } = require('./parsers/panParser');
const { parseInvoice } = require('./parsers/invoiceParser');
const { parseForm } = require('./parsers/formParser');

const app = express();
app.use(cors());
app.use(express.json());

// ⏱ prevent silent timeout
app.use((req, res, next) => {
  res.setTimeout(60000);
  next();
});

const UPLOAD_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR);

/* ---------- MULTER ---------- */
const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage }).fields([
  { name: 'front', maxCount: 1 },
  { name: 'back', maxCount: 1 }
]);

/* ---------- PYTHON RUNNERS ---------- */

// Aadhaar
function runPythonAadhaar(imagePath) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'python_parsers', 'aadhaar_parser.py');
    const absolutePath = path.resolve(imagePath);

    // ⏳ Windows disk flush safety
    setTimeout(() => {
      const cmd = `py "${script}" "${absolutePath}"`;

      exec(cmd, (err, stdout, stderr) => {
        if (err) {
          console.error('🐍 Aadhaar Error:', stderr);
          return reject(err.message);
        }
        try {
          const match = stdout.match(/\{[\s\S]*\}/);
          if (!match) throw new Error('No JSON output from Python script');
          resolve(JSON.parse(match[0]));
        } catch (e) {
          reject(e.message);
        }
      });
    }, 300);
  });
}

// ID / Voter
function runPythonIDCard(frontPath, backPath = null) {
  return new Promise((resolve, reject) => {
    const script = path.join(__dirname, 'python_parsers', 'id_card_ocr.py');

    const frontAbs = path.resolve(frontPath);
    const backAbs = backPath ? path.resolve(backPath) : null;

    const cmd = backAbs
      ? `py "${script}" "${frontAbs}" "${backAbs}"`
      : `py "${script}" "${frontAbs}"`;

    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        console.error('🐍 ID Card Error:', stderr);
        return reject(err.message);
      }
      try {
        const match = stdout.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('No JSON output from Python script');
        resolve(JSON.parse(match[0]));
      } catch (e) {
        reject(e.message);
      }
    });
  });
}

/* ---------- MAIN API ---------- */
app.post('/scan', upload, async (req, res) => {
  try {
    if (!req.files?.front) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const originalPath = req.files.front[0].path;

    /* ---------- FIRST OCR ---------- */
    const baseOCR = await runOCR(originalPath);
    const { fullText, lines } = baseOCR;
    const upper = fullText.toUpperCase();

    /* ---------- DOCUMENT DETECTION ---------- */
    let docType = 'unknown';

    if (/\b\d{4}\s\d{4}\s\d{4}\b/.test(fullText)) {
      docType = 'aadhaar';
    }
    else if (/\b[A-Z]{5}[0-9]{4}[A-Z]\b/.test(upper)) {
      docType = 'pan';
    }
    else if (
      upper.includes('INTAKE FORM') ||
      upper.includes('REGISTRATION') ||
      upper.includes('APPLICATION') ||
      upper.includes('SECTION A')
    ) {
      docType = 'form';
    }
    else if (upper.includes('ELECTION') || upper.includes('ELECTOR')) {
      docType = 'voter';
    }
    else if (upper.includes('INVOICE') || upper.includes('TOTAL')) {
      docType = 'invoice';
    }
    else if (
      upper.includes('COLLEGE') ||
      upper.includes('UNIVERSITY') ||
      upper.includes('INSTITUTE') ||
      upper.includes('ACADEMY') ||
      upper.includes('SCHOOL') ||
      upper.includes('STUDENT') ||
      upper.includes('ID CARD') ||
      upper.includes('IDENTITY CARD') ||
      upper.includes('EMPLOYEE') ||
      upper.includes('DESIGNATION') ||
      upper.includes('CLASS') ||
      upper.includes('ROLL NO')
    ) {
      docType = 'id_card';
    }

    console.log('[Detected]:', docType);

    let result;

    /* ---------- ROUTING ---------- */
    if (docType === 'aadhaar') {
      const data = await runPythonAadhaar(originalPath);

      const validIDs = lines
        .map(l => l.text.trim())
        .map(t => t.match(/\b\d{4}\s\d{4}\s\d{4}\b/))
        .filter(m => m)
        .map(m => m[0]);

      if (validIDs.length > 0) {
        data.id_number = validIDs[validIDs.length - 1];
      }

      result = { type: 'Aadhaar Card', fields: data };
    }
    else if (docType === 'voter' || docType === 'id_card') {
      const backPath = req.files.back ? req.files.back[0].path : null;
      const data = await runPythonIDCard(originalPath, backPath);
      result = {
        type: docType === 'voter' ? 'Voter ID' : (data.type || 'ID Card'),
        fields: data
      };
    }
    else if (docType === 'pan') {
      result = parsePAN(lines, fullText);
    }
    else if (docType === 'invoice') {
      result = await parseInvoice(originalPath);
    }
    else if (docType === 'form') {
      result = parseForm(lines, fullText);
    }
    else {
      result = { type: 'Unknown Document', fields: {} };
    }

    res.json({ success: true, data: result });

  } catch (err) {
    console.error('🔥 BACKEND ERROR:', err);
    res.status(500).json({ error: err.message });
  }
});

/* ---------- SERVER ---------- */
app.listen(5000, () => {
  console.log('VeriScan Server running on 5000');
});
