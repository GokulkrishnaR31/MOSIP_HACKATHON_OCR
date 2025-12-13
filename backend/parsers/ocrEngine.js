const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

const TESS = `"C:\\Program Files\\Tesseract-OCR\\tesseract.exe"`;
const TESSDATA = `"C:\\Program Files\\Tesseract-OCR\\tessdata"`;

async function normalizeImage(imagePath) {
  const ext = path.extname(imagePath).toLowerCase();
  if (['.png', '.jpg', '.jpeg'].includes(ext)) return imagePath;

  const out = imagePath.replace(ext, '.png');
  await sharp(imagePath).png().toFile(out);
  return out;
}

/**
 * runOCR(imagePath, options)
 * options.psm -> number
 * options.whitelist -> string
 */
function runOCR(imagePath, options = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      imagePath = await normalizeImage(imagePath);

      const out = path.join(
        path.dirname(imagePath),
        crypto.randomBytes(6).toString('hex')
      );

      const psm = options.psm ?? 6;
      const whitelist = options.whitelist
        ? `-c tessedit_char_whitelist=${options.whitelist}`
        : '';

      const cmd = `${TESS} "${imagePath}" "${out}" \
--tessdata-dir ${TESSDATA} \
-l eng+hin \
--psm ${psm} ${whitelist}`;

      exec(cmd, (err) => {
        if (err) return reject(err);

        const txt = out + '.txt';
        const fullText = fs.readFileSync(txt, 'utf8');
        fs.unlinkSync(txt);

        const lines = fullText
          .split('\n')
          .map(t => t.trim())
          .filter(Boolean)
          .map(text => ({ text }));

        console.log(`[OCR Engine] Final: ${lines.length} lines`);
        resolve({ fullText, lines, normalizedPath: imagePath });
      });

    } catch (e) {
      reject(e);
    }
  });
}

module.exports = { runOCR };
