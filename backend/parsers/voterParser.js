function parseVoter(lines) {
  // 1. Clean Input: Remove headers and short noise
  let texts = lines
    .map(l => l.text.trim())
    .filter(t => t.length > 2) // Remove garbage like ".." or "—"
    .filter(t => !/ELECTION COMMISSION|IDENTITY CARD|INDIA|GOVERNMENT/i.test(t));

  let voterId = null;
  let dob = null;
  let gender = null;
  let fullName = null;
  let fatherName = null;
  let constituency = null;

  // --- STEP 1: EXTRACT HARD FIELDS (ID, DOB, GENDER) ---

  // 1. Voter ID (Matches ZIE..., YYY..., standard formats)
  const idIndex = texts.findIndex(t => /\b[A-Z]{3}[0-9I]{7}\b/i.test(t) || /\b[A-Z]{2}[0-9I]{8}\b/i.test(t));
  if (idIndex !== -1) {
      const match = texts[idIndex].match(/\b[A-Z0-9]{10,}\b/i) || texts[idIndex].match(/[A-Z]{3}\d{7}/);
      if (match) {
          voterId = match[0].toUpperCase().replace('1', 'I').replace('O', '0');
          texts.splice(idIndex, 1); // Remove ID line from pool
      }
  }

  // 2. Date of Birth
  const dobIndex = texts.findIndex(t => /\d{2}[-./]\d{2}[-./]\d{4}/.test(t) || /Age/i.test(t));
  if (dobIndex !== -1) {
      const m = texts[dobIndex].match(/\d{2}[-./]\d{2}[-./]\d{4}/);
      if (m) dob = m[0].replace(/[\./]/g, '-');
      else if (/Age/i.test(texts[dobIndex])) dob = texts[dobIndex]; // Fallback to Age line
      
      texts.splice(dobIndex, 1); // Remove DOB line
  }

  // 3. Gender
  const genderIndex = texts.findIndex(t => /Male|Female|Transgender/i.test(t));
  if (genderIndex !== -1) {
      if (/Female|Mahila/i.test(texts[genderIndex])) gender = "Female";
      else if (/Male|Purush/i.test(texts[genderIndex])) gender = "Male";
      texts.splice(genderIndex, 1); // Remove Gender line
  }

  // 4. Constituency (Look for "Assembly" or digits followed by text)
  const constIndex = texts.findIndex(t => /Constituency|Assembly/i.test(t));
  if (constIndex !== -1) {
      const parts = texts[constIndex].split(/[:\-]/);
      constituency = parts[parts.length - 1].trim();
      texts.splice(constIndex, 1);
  }

  // --- STEP 2: EXTRACT NAME & FATHER (CONTEXTUAL FALLBACK) ---

  // Strategy: The FIRST remaining meaningful line is usually the Name.
  // The SECOND remaining meaningful line is usually the Father's Name.
  
  // Filter out any remaining Hindi lines (detects if line has many non-ASCII chars)
  const isEnglish = (str) => /^[A-Za-z0-9\s\.\-\(\):]+$/.test(str);
  
  let candidates = texts.filter(t => {
      // Ignore common labels if they remain alone
      if (/^Name\s*[:\-]*$/i.test(t)) return false; 
      if (/^Father\s*[:\-]*$/i.test(t)) return false;
      return true;
  });

  if (candidates.length > 0) {
      // 1. Try to find "Name:" explicit label first
      const explicitName = candidates.find(t => /Name\s*[:\-]/i.test(t) && !/Father|Husband/i.test(t));
      
      if (explicitName) {
          fullName = explicitName.split(/[:\-]/).pop().trim();
          // Remove this line so we don't use it for Father Name
          candidates = candidates.filter(c => c !== explicitName);
      } else {
          // FALLBACK: Take the first English-looking line
          fullName = candidates.find(t => isEnglish(t)) || candidates[0];
          candidates = candidates.filter(c => c !== fullName);
      }
  }

  if (candidates.length > 0) {
      // 2. Try to find "Father's Name" explicit label
      const explicitFather = candidates.find(t => /Father|Husband/i.test(t));
      
      if (explicitFather) {
          fatherName = explicitFather.split(/[:\-]/).pop().trim();
      } else {
          // FALLBACK: Take the next available line
          fatherName = candidates.find(t => isEnglish(t)) || candidates[0];
      }
  }

  // Final Cleanup
  const clean = (str) => str ? str.replace(/[^\x00-\x7F]/g, "").trim() : "Not Found";

  return {
    type: 'Voter ID',
    fields: {
      fullName: clean(fullName),
      fatherName: clean(fatherName),
      gender: gender || "Not Found",
      dob: dob || "Not Found",
      voterId: voterId || "Not Found",
      constituency: constituency || "Not Found"
    }
  };
}

module.exports = { parseVoter };