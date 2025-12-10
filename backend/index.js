// backend/index.js — UNIVERSAL PRODUCTION (Passport Visual Fallback + Strict Routing)
const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs-extra');
const path = require('path');
const Tesseract = require('tesseract.js');
const cors = require('cors');
const stringSimilarity = require('string-similarity');
const mrz = require('mrz');

const app = express();
app.use(cors());
app.use(express.json());

const ROOT = path.join(__dirname);
const UPLOAD_DIR = path.join(ROOT, 'uploads');
fs.ensureDirSync(UPLOAD_DIR);

const upload = multer({ dest: UPLOAD_DIR, limits: { fileSize: 50 * 1024 * 1024 } });

// —————————————————————————————————————————————
// 1. CONFIGURATION & BLACKLISTS
// —————————————————————————————————————————————
const BLACKLIST = [
    'COMMERCIAL', 'DRIVER', 'LICENSE', 'LICENCE', 'PENNSYLVANIA', 'VISIT', 'USA', 'CLASS', 'END', 'REST', 
    'DEPARTMENT', 'GOVERNMENT', 'INDIA', 'INCOME', 'TAX', 'METEOROLOGICAL', 'SPECIMEN', 'SAMPLE',
    'ELECTION', 'COMMISSION', 'IDENTITY', 'CARD', 'FATHER', 'MOTHER', 'HUSBAND', 'PERMANENT', 'ACCOUNT',
    'NUMBER', 'GOVT', 'STATE', 'UNION', 'REPUBLIC', 'MOTOR', 'VEHICLE', 'AUTHORITY', 'ISSUING', 'VALID',
    'ENROLLMENT', 'YEAR', 'BIRTH', 'DOB', 'MALE', 'FEMALE', 'AUTHORISATION', 'FOLLOWING', 'TRANSPORT',
    'INVOICE', 'BILL', 'TOTAL', 'DATE', 'SUBTOTAL', 'AMOUNT', 'DUE', 'FORM', 'PASSPORT', 'REPUBLIQUE', 'HOLDER'
];

function cleanName(str) {
    if (!str) return 'Not detected';
    let cleaned = str.replace(/[^a-zA-Z\s]/g, '').replace(/\s+/g, ' ').trim();
    cleaned = cleaned.replace(/^[a-z]{1,2}\s/, ''); 
    return cleaned.length > 2 ? cleaned : 'Not detected';
}

function cleanID(str) {
    if (!str) return 'Not detected';
    return str.replace(/[^a-zA-Z0-9]/g, '').trim();
}

function cleanAadhaarID(str) {
    if (!str) return 'Not detected';
    return str.replace(/[^0-9]/g, ''); 
}

function isBlacklisted(str) {
    if (!str) return true;
    const upper = str.toUpperCase();
    return BLACKLIST.some(word => upper.includes(word));
}

function formatDate(yymmdd) {
    if (!yymmdd || yymmdd.length !== 6) return 'Not detected';
    let yy = parseInt(yymmdd.substring(0, 2));
    let year = yy > 30 ? `19${yy}` : `20${yy}`;
    return `${yymmdd.substring(4, 6)}-${yymmdd.substring(2, 4)}-${year}`;
}

// —————————————————————————————————————————————
// 2. PREPROCESSING
// —————————————————————————————————————————————
async function preprocess(filePath) {
  // Moderate contrast to handle both color IDs (PAN/DL) and BW documents
  return await sharp(filePath)
    .resize(3000, null, { withoutEnlargement: false })
    .withMetadata({ density: 300 })
    .greyscale()
    .normalize()
    .linear(1.5, -15) 
    .sharpen({ sigma: 1.0 })
    .png()
    .toBuffer();
}

// —————————————————————————————————————————————
// 3. PARSERS
// —————————————————————————————————————————————

// [A] INVOICE PARSER
function parseInvoice(lines, fullText) {
    const result = { type: 'Invoice', fields: { vendor: 'Not detected', total_amount: '0.00', line_items: '' } };
    
    // Vendor: First line NOT blacklisted/Invoice keyword
    const vendor = lines.find(l => !/invoice|bill|gst|date|due|balance/i.test(l) && l.length > 3);
    if (vendor) result.fields.vendor = vendor;

    // Total Amount: Look for currency or "Total"
    const amounts = fullText.match(/[\$₹]\s?([0-9,]+\.[0-9]{2})/g);
    if (amounts) {
        result.fields.total_amount = amounts[amounts.length-1];
    } else {
        const totalLine = lines.find(l => /total/i.test(l) && /\d+\.\d{2}/.test(l));
        if (totalLine) {
            const m = totalLine.match(/\d+\.\d{2}/);
            if (m) result.fields.total_amount = m[0];
        }
    }

    const date = fullText.match(/\d{2}[-\/]\d{2}[-\/]\d{4}/);
    if (date) result.fields.date = date[0];

    const inv = lines.find(l => /#/.test(l));
    if (inv) { const m = inv.match(/[A-Z0-9-]{3,}/); if(m) result.fields.invoice_number = m[0]; }

    const items = lines.filter(l => /^\d{1,3}\s+[a-zA-Z]/.test(l) && /\d+\.\d{2}$/.test(l));
    result.fields.line_items = items.join(' | ');

    return result;
}

// [B] AADHAAR PARSER
function parseAadhaar(lines, fullText) {
    const result = { type: 'Aadhaar Card', fields: { full_name: 'Not detected', id_number: 'Not detected', dob: 'Not detected' } };
    const idMatch = fullText.match(/\b\d{4}\s\d{4}\s\d{4}\b/);
    if (idMatch) result.fields.id_number = cleanAadhaarID(idMatch[0]);
    const dobMatch = fullText.match(/\d{2}[-\/]\d{2}[-\/]\d{4}/);
    if (dobMatch) result.fields.dob = dobMatch[0];
    const anchorIdx = lines.findIndex(l => /Male|Female|DOB|Year|Birth/i.test(l));
    if (anchorIdx > 0) {
        for (let i = 1; i <= 3; i++) {
            const candidate = lines[anchorIdx - i];
            if (candidate && !isBlacklisted(candidate) && candidate.length > 3 && !/\d/.test(candidate)) {
                result.fields.full_name = cleanName(candidate);
                break; 
            }
        }
    }
    return result;
}

// [C] INDIAN DL PARSER
function parseIndianDL(lines, fullText) {
    const result = { type: 'Indian Driving License', fields: { full_name: 'Not detected', id_number: 'Not detected', dob: 'Not detected' } };
    
    const idMatch = fullText.match(/[A-Z]{2}[-\s]?\d{2}[-\s]?\d{4,}/) || 
                    fullText.match(/DL\s*No\s*[:\.]?\s*([A-Z0-9\s-]+)/i);
    
    if (idMatch) result.fields.id_number = idMatch[0].replace(/DL\s*No/i, '').replace(/[^A-Z0-9]/g, '');

    const dates = fullText.match(/\d{2}[-\/]\d{2}[-\/]\d{4}/g) || [];
    if (dates.length > 0) {
        dates.sort((a,b) => parseInt(a.slice(-4)) - parseInt(b.slice(-4)));
        result.fields.dob = dates[0];
    }

    const nameLineIdx = lines.findIndex(l => /Name/i.test(l) && !/Father|Husband/i.test(l));
    if (nameLineIdx !== -1) {
        let raw = lines[nameLineIdx].replace(/Name\s*[:\.]?/i, '').trim();
        if (raw.length < 3 && lines[nameLineIdx + 1]) raw = lines[nameLineIdx + 1];
        result.fields.full_name = cleanName(raw);
    } else {
        const anchor = lines.findIndex(l => /Union|Motor|Driving|Maharashtra/i.test(l));
        if (anchor !== -1) {
            for(let i=1; i<=6; i++) {
                const cand = lines[anchor+i];
                if (cand && /^[A-Z\s]+$/.test(cand) && !isBlacklisted(cand) && cand.length > 4) {
                    result.fields.full_name = cleanName(cand);
                    break;
                }
            }
        }
    }
    return result;
}

// [D] PAN CARD
function parsePAN(lines, fullText) {
    const result = { type: 'PAN Card', fields: { full_name: 'Not detected', id_number: 'Not detected', dob: 'Not detected' } };
    const m = fullText.match(/[A-Z]{5}[0-9]{4}[A-Z]/);
    if (m) result.fields.id_number = m[0];
    const dobMatch = fullText.match(/\d{2}[-\/]\d{2}[-\/]\d{4}/);
    if (dobMatch) result.fields.dob = dobMatch[0];
    const headerIdx = lines.findIndex(l => /INCOME|TAX|GOVT|INDIA/i.test(l));
    if (headerIdx !== -1) {
        for (let i = 1; i <= 3; i++) {
            const line = lines[headerIdx + i];
            if (line && !isBlacklisted(line) && line.replace(/[^A-Z]/g, '').length > 3) {
                result.fields.full_name = cleanName(line);
                break;
            }
        }
    }
    return result;
}

// [E] PASSPORT PARSER (Expanded Visual Fallback)
function parsePassport(lines, fullText) {
    const result = { type: 'Passport', fields: { full_name: 'Not detected', id_number: 'Not detected', dob: 'Not detected', country: 'Not detected' } };
    const mrzLines = lines.filter(l => l.length > 25 && l.includes('<')).map(l => l.toUpperCase().replace(/[K(]/g, '<'));
    const pLine = mrzLines.find(l => l.startsWith('P') || l.startsWith('I'));
    
    // Strategy A: MRZ (Best)
    if (pLine) {
        const idx = mrzLines.indexOf(pLine);
        const line1 = mrzLines[idx];
        const line2 = mrzLines[idx + 1];
        let nameStrip = line1.substring(5); 
        let parts = nameStrip.split('<<');
        let surname = parts[0].replace(/</g, ' ').trim();
        let given = parts.length > 1 ? parts[1].split('<')[0].replace(/</g, ' ').trim() : '';
        result.fields.full_name = `${surname} ${given}`.trim();
        if (line2) {
            result.fields.id_number = line2.substring(0, 9).replace(/</g, '');
            result.fields.dob = formatDate(line2.substring(13, 19));
            result.fields.country = line2.substring(10, 13).replace(/</g, '');
        }
    } 
    
    // Strategy B: Visual Fallback (If MRZ Missing/Incomplete)
    if (result.fields.full_name === 'Not detected' || result.fields.id_number === 'Not detected') {
        // Name Extraction: Combine Surname + Given Names
        let surname = '';
        let given = '';
        
        const surIdx = lines.findIndex(l => /Nom|Surname/i.test(l));
        if (surIdx !== -1) {
            let raw = lines[surIdx].replace(/.*(Nom|Surname)[:\s\.\/]*/i, '').trim();
            if (raw.length < 2 && lines[surIdx+1]) raw = lines[surIdx+1];
            surname = cleanName(raw);
        }

        const givenIdx = lines.findIndex(l => /Pr[ée]nom|Given\s*names/i.test(l));
        if (givenIdx !== -1) {
            let raw = lines[givenIdx].replace(/.*(Pr[ée]nom|Given\s*names)[:\s\.\/]*/i, '').trim();
            if (raw.length < 2 && lines[givenIdx+1]) raw = lines[givenIdx+1];
            given = cleanName(raw);
        }

        if (surname && surname !== 'Not detected') {
            result.fields.full_name = given && given !== 'Not detected' ? `${given} ${surname}` : surname;
        }
        
        // ID Number (Look for Passport No label)
        const idMatch = fullText.match(/(?:Passport|Passeport)\s*N[o0].*?([A-Z0-9]{6,})/i);
        if (idMatch) result.fields.id_number = cleanID(idMatch[1]);

        // DOB (Support alphanumeric months like "6 MAI 1962")
        const dobMatch = fullText.match(/(\d{1,2}\s+[A-Z]{3,}\s+\d{4})/i) ||
                         fullText.match(/(?:Date\s*of\s*birth|Date\s*de\s*naissance).*?(\d{2}[-\/]\d{2}[-\/]\d{4})/i);
        if (dobMatch) result.fields.dob = dobMatch[1];
    }
    
    return result;
}

// [F] US DL / VOTER / GENERIC
function parseOtherID(lines, fullText) {
    const lower = fullText.toLowerCase();
    const result = { type: 'ID Card', fields: { full_name: 'Not detected', id_number: 'Not detected', dob: 'Not detected' } };

    if (/driver|license/i.test(lower)) result.type = 'US Driver License';
    else if (/election|voter/i.test(lower)) result.type = 'Voter ID';

    if (result.type === 'US Driver License') {
        const cand = lines.find(l => /DLN|Lic/i.test(l)) || lines.find(l => /\d{5,}/.test(l) && !isBlacklisted(l));
        if (cand) result.fields.id_number = cleanID(cand.replace(/DLN|Lic|No/i, ''));
    } else if (result.type === 'Voter ID') {
        const m = fullText.match(/[A-Z]{3}[0-9]{7}/);
        if (m) result.fields.id_number = m[0];
    } else {
        const m = fullText.match(/[A-Z0-9]{8,15}/);
        if (m) result.fields.id_number = m[0];
    }

    const nameLine = lines.find(l => stringSimilarity.compareTwoStrings(l.split(/[:\s]/)[0].toLowerCase(), 'name') > 0.8);
    if (nameLine) {
        result.fields.full_name = cleanName(nameLine.replace(/.*[:\.]/, ''));
    } else {
        const validCaps = lines.filter(l => /^[A-Z\s]+$/.test(l) && l.length > 4 && !isBlacklisted(l));
        if (validCaps.length > 0) result.fields.full_name = validCaps[0];
    }
    const dob = fullText.match(/\d{2}[-\/]\d{2}[-\/]\d{4}/);
    if (dob) result.fields.dob = dob[0];
    return result;
}

function parseGenericDoc(lines) {
    return { type: 'Document', fields: { title: lines[0] || 'Unknown', summary: lines.slice(1, 6).join(' ').substring(0, 300) + '...' } };
}

// —————————————————————————————————————————————
// 4. MAIN ROUTER (PRIORITY: Passport Check Expanded)
// —————————————————————————————————————————————
app.post('/scan', upload.single('image'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });

  try {
    const enhanced = await preprocess(req.file.path);
    const ocrResult = await Tesseract.recognize(enhanced, 'eng', { 
      tessedit_pageseg_mode: '6',
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/-:.,#$₹<| ' 
    });
    
    const fullText = ocrResult.data.text;
    const lines = fullText.split('\n').map(l => l.trim()).filter(l => l.length > 2);
    const lower = fullText.toLowerCase();
    let analysis;

    console.log("--- DEBUG OCR TEXT ---");
    console.log(fullText.substring(0, 300));
    console.log("----------------------");

    // --- PRIORITY ROUTING ---
    
    // 1. Passport (Unique MRZ markers OR explicit keyword)
    if (lines.some(l => l.includes('<<')) || /passport|passeport/i.test(fullText)) {
        console.log("Detected: Passport");
        analysis = parsePassport(lines, fullText);
    }
    // 2. INVOICE (Prioritized over IDs to prevent false positives)
    else if (/invoice|bill\s*to|total\s*due|amount\s*due/i.test(fullText)) {
        console.log("Detected: Invoice");
        analysis = parseInvoice(lines, fullText);
    }
    // 3. Aadhaar (Strict Regex)
    else if (/\b\d{4}\s\d{4}\s\d{4}\b/.test(fullText) || /aadhaar/i.test(fullText)) {
        console.log("Detected: Aadhaar");
        analysis = parseAadhaar(lines, fullText);
    }
    // 4. PAN Card (Strict Regex)
    else if (/[A-Z]{5}[0-9]{4}[A-Z]/.test(fullText)) {
        console.log("Detected: PAN");
        analysis = parsePAN(lines, fullText);
    }
    // 5. Indian DL (Expanded Regex + Keywords)
    else if (
        /union|motor|driving|licence|transport|maharashtra|state|drive|form\s*7/i.test(lower) && 
        !/\bUSA\b/.test(fullText) // Strict word boundary for USA
    ) {
        console.log("Detected: Indian DL");
        analysis = parseIndianDL(lines, fullText);
    }
    // 6. Other IDs (US DL / Voter / Generic)
    else if (/driver|license|election|voter|identity/i.test(lower)) {
        console.log("Detected: Other ID");
        analysis = parseOtherID(lines, fullText);
    }
    // 7. Generic Doc
    else {
        console.log("Detected: Generic Doc");
        analysis = parseGenericDoc(lines);
    }

    res.json({
      success: true,
      data: {
        ...analysis,
        source_file: req.file.path,
        bounding_boxes: (ocrResult.data.words || []).map(w => ({ text: w.text, confidence: w.confidence, bbox: w.bbox }))
      }
    });
  } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.post('/sanitize', async (req, res) => {
    const { source_file, masks } = req.body;
    if (!source_file || !fs.existsSync(source_file)) return res.status(400).send('File not found');
    try {
      // FIX: Filter tiny boxes to prevent crash
      const validMasks = (masks || []).filter(m => (m.x1 - m.x0) > 5 && (m.y1 - m.y0) > 5);
      
      const rects = validMasks.map(m => `<rect x="${m.x0}" y="${m.y0}" width="${m.x1 - m.x0}" height="${m.y1 - m.y0}" fill="black" />`).join('\n');
      
      const image = sharp(source_file);
      const meta = await image.metadata();
      const svg = Buffer.from(`<svg width="${meta.width}" height="${meta.height}">${rects}</svg>`);
      const output = await image.composite([{ input: svg, blend: 'over' }]).png().toBuffer();
      res.set('Content-Type', 'image/png');
      res.send(output);
    } catch (e) { res.status(500).send('Error'); }
});

app.listen(5000, () => { console.log('VeriScan Final Production (Universal Fix) → Port 5000'); });