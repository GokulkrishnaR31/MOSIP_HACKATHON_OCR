// backend/parsers/formParser.js

const CLEAN_REGEX = /[^a-zA-Z0-9\s\.\-\/@,]/g;

function clean(str) {
    return str.replace(CLEAN_REGEX, '').trim();
}

function toSnakeCase(str) {
    return str.trim().toLowerCase().replace(/[\s\-\.]+/g, '_');
}

// [UPDATED] Accepts lines and fullText directly to avoid double OCR
function parseForm(lines, fullText) {
    const extractedData = {};
    let formTitle = "General Form";

    // 1. Detect Title
    const titleLine = lines.find(l => l.text.length > 5 && l.text.toUpperCase().includes('FORM'));
    if (titleLine) formTitle = clean(titleLine.text);

    /* STRATEGY A: Horizontal Scanning (Label: Value)
       Matches: "Full Name: Gokul Krishna R", "Gender: Male"
    */
    lines.forEach(line => {
        if (line.text.includes(':')) {
            const parts = line.text.split(':');
            // Ensure we have exactly 2 parts and the label isn't too long
            if (parts.length >= 2 && parts[0].length < 30) {
                const key = toSnakeCase(parts[0]);
                // Rejoin the rest in case value contains colons (e.g. timestamps)
                const value = parts.slice(1).join(':').trim();
                
                if (key && value && value.length > 1) {
                    extractedData[key] = clean(value);
                }
            }
        }
    });

    /* STRATEGY B: Vertical Scanning (Label -> Next Line)
       Matches: "CURRENT DESIGNATION" -> "Full Stack Developer"
    */
    for (let i = 0; i < lines.length - 1; i++) {
        const currentLine = lines[i].text.trim();
        const nextLine = lines[i+1].text.trim();

        // If line is uppercase (likely a header) and short
        // E.g. "PRIMARY TECHNICAL SKILLS"
        const isHeader = currentLine === currentLine.toUpperCase() && currentLine.length > 4 && !/\d/.test(currentLine);

        if (isHeader) {
            // Check if value is on the NEXT line
            if (nextLine.length > 0 && nextLine.length < 100) {
                const key = toSnakeCase(currentLine);
                // Only add if not already found by horizontal scan
                if (!extractedData[key]) {
                    extractedData[key] = clean(nextLine);
                }
            }
        }
    }

    // 3. FAIL-SAFE
    const keysFound = Object.keys(extractedData).length;
    if (keysFound < 1) {
        console.log("[FormParser] Weak match. Dumping raw text.");
        extractedData["full_document_text"] = fullText; 
        extractedData["status"] = "Manual Review Required";
    }

    return {
        type: formTitle || 'Intake Form',
        fields: extractedData
    };
}

module.exports = { parseForm };