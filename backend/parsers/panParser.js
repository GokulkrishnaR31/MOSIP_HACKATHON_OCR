function parsePAN(lines, fullText) {
    const fields = {
        full_name: 'Not detected',
        pan_number: 'Not detected',
        dob: 'Not available'
    };

    /* -------- PAN NUMBER -------- */
    const panMatch = fullText.match(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/);
    if (panMatch) fields.pan_number = panMatch[0];

    /* -------- DOB (if present) -------- */
    const dobMatch = fullText.match(/\d{2}[\/\-]\d{2}[\/\-]\d{4}/);
    if (dobMatch) fields.dob = dobMatch[0];

    /* -------- NAME DETECTION -------- */
    for (let line of lines) {
        if (!line || !line.text) continue;

        const text = line.text.trim();

        // Skip headers
        if (/INCOME|TAX|DEPARTMENT|GOVERNMENT|INDIA|PAN/i.test(text)) continue;

        // Skip PAN number line
        if (fields.pan_number !== 'Not detected' && text.includes(fields.pan_number)) continue;

        // Likely name: uppercase, short, no digits
        if (
            text.length >= 3 &&
            text.length <= 25 &&
            /^[A-Z ]+$/.test(text)
        ) {
            fields.full_name = text;
            break;
        }
    }

    return { type: 'PAN Card', fields };
}

module.exports = { parsePAN };
