import easyocr
import re
import json
import sys
import os

# verbose=False prevents Windows crash
reader = easyocr.Reader(['en'], gpu=False, verbose=False)

def extract_lines(image_path):
    # detail=0 returns simple list of strings
    return reader.readtext(image_path, detail=0)

def clean_value(text):
    if not text: return ""
    # Remove Hindi/Non-ASCII chars but keep spaces
    text = re.sub(r'[^\x00-\x7F]+', ' ', text)
    # Remove pipes or weird OCR artifacts
    text = text.replace('|', '').strip()
    return text

def parse_voter_id(lines):
    data = {
        "type": "Voter ID",
        "name": None,
        "father_name": None,
        "dob": None,
        "voter_id": None,
        "gender": None,
        "address": None
    }
    
    cleaned_lines = [clean_value(l) for l in lines if len(clean_value(l)) > 1]
    full_text = "\n".join(cleaned_lines)

    # 1. Voter ID
    epic_match = re.search(r'[A-Z]{3}[0-9]{7}|[A-Z]{2}[0-9]{8}', full_text)
    if epic_match: data["voter_id"] = epic_match.group()

    # 2. Gender
    if re.search(r'\b(MALE|Male)\b', full_text): data["gender"] = "Male"
    elif re.search(r'\b(FEMALE|Female)\b', full_text): data["gender"] = "Female"

    # 3. DOB
    dob_match = re.search(r'\d{2}[-./]\d{2}[-./]\d{4}', full_text)
    if dob_match: data["dob"] = dob_match.group().replace('/', '-')

    # 4. Name
    for i, line in enumerate(cleaned_lines):
        if "NAME" in line.upper() and not any(x in line.upper() for x in ["FATHER", "HUSBAND", "ELECTION"]):
            parts = re.split(r'[:\-]', line)
            if len(parts) > 1: data["name"] = parts[-1].strip()
            elif i + 1 < len(cleaned_lines): data["name"] = cleaned_lines[i+1]
            break
            
    if not data["name"]:
        for i, line in enumerate(cleaned_lines):
            if line.strip().upper() == "NAME":
                if i + 1 < len(cleaned_lines):
                    data["name"] = cleaned_lines[i+1]
                    break

    # 5. Father Name
    father_match = re.search(r'(Father|Husband)\'?s? Name\s*[:\-]?\s*([A-Za-z\s\.]+)', full_text, re.IGNORECASE)
    if father_match: data["father_name"] = father_match.group(2).strip()

    # 6. Address (Voter ID usually has "Address:" label on back)
    # Simple extraction: look for "Address" keyword
    addr_start = -1
    for i, line in enumerate(cleaned_lines):
        if "ADDRESS" in line.upper():
            addr_start = i
            break
    if addr_start != -1:
        # Take next 2-3 lines
        addr_lines = cleaned_lines[addr_start+1 : addr_start+4]
        data["address"] = ", ".join(addr_lines)

    return data

def parse_generic_id(lines):
    # --- STEP 0: PRE-FILTERING ---
    valid_lines = []
    for l in lines:
        clean_l = clean_value(l)
        u_l = clean_l.upper()
        
        # Strict Filter: Instructions, Legal text
        if (len(clean_l) < 2 or
            re.match(r'^\d+[\.\)]', clean_l) or # Starts with "1." or "3."
            any(w in u_l for w in ["LOSS", "DAMAGE", "PROPERTY", "VALID", "AUTHORITIES", "OFFENCE", "INSTRUCTIONS", "FOUND", "RETURN", "DUPLICATION"])):
            continue
            
        valid_lines.append(clean_l)
        
    text_blob = "\n".join(valid_lines)
    upper_blob = text_blob.upper()
    
    data = {
        "type": "ID Card",
        "org_name": None,
        "name": None,
        "id_number": None,
        "designation_or_class": None,
        "dob": None,
        "address": None
    }

    # 1. Type Detection
    if "EMPLOYEE" in upper_blob or "DESIGNATION" in upper_blob or "TC-" in upper_blob:
        data["type"] = "Employee ID"
    else:
        data["type"] = "Student ID"

    # 2. Org Name
    for line in valid_lines[:6]:
        if (len(line) > 4 and line.isupper() and 
            not any(x in line for x in ["ID CARD", "IDENTITY", "GOVERNMENT", "NAME", "REG", "ADDRESS"])):
            if "RAJALAKSHMI" in line:
                data["org_name"] = "RAJALAKSHMI ENGINEERING COLLEGE"
                break
            data["org_name"] = line
            break

    # 3. ID Number
    for i, line in enumerate(valid_lines):
        u_line = line.upper()
        if any(k in u_line for k in ["REG", "ROLL", "ID NO", "CODE", "EMP", "TC-"]):
            parts = re.split(r'[:\-\.]', line)
            if len(parts) > 1 and any(c.isdigit() for c in parts[-1]):
                data["id_number"] = parts[-1].strip()
                break
            if i + 1 < len(valid_lines):
                next_val = valid_lines[i+1].strip()
                if any(c.isdigit() for c in next_val):
                    data["id_number"] = next_val
                    break
    if not data["id_number"]:
        match = re.search(r'\bTC-[0-9]+\b', text_blob)
        if match: data["id_number"] = match.group()

    # 4. Name Extraction
    if not data["name"]:
        # TechCorp style
        for i, line in enumerate(valid_lines):
            if "NAME" in line.upper() and ":" not in line: 
                 if i + 1 < len(valid_lines):
                     candidate = valid_lines[i+1].strip()
                     if not any(c.isdigit() for c in candidate) and "DESIGNATION" not in candidate.upper():
                         data["name"] = candidate
                         break
    
    if not data["name"]:
        # Anchor Search (Reg No -> Upwards)
        anchor_indices = [i for i, l in enumerate(valid_lines) if any(k in l.upper() for k in ["REG", "ROLL", "EMP ID"])]
        if anchor_indices:
            anchor_idx = anchor_indices[0]
            for i in range(anchor_idx - 1, -1, -1):
                candidate = valid_lines[i].strip()
                u_cand = candidate.upper()
                if (len(candidate) < 3 or 
                    any(x in u_cand for x in ["IDENTITY", "CARD", "COLLEGE", "ENGINEERING", "TECHNOLOGY", "INSTITUTE", "STUDENT", "MALE", "FEMALE", "SYSTEMS", "PRINCIPAL", "ADDRESS"]) or
                    (data["org_name"] and candidate in data["org_name"])):
                    continue
                data["name"] = candidate
                break

    if not data["name"]:
        # Fallback Largest Text
        ignore = ["ID CARD", "IDENTITY", "STUDENT", "EMPLOYEE", "PRINCIPAL", "SIGNATURE", "ENGINEERING", "COLLEGE", "ADDRESS"]
        if data["org_name"]: ignore.append(data["org_name"].upper())
        for line in valid_lines:
            if line.isupper() and len(line) > 4 and not any(x in line.upper() for x in ignore) and not any(c.isdigit() for c in line):
                data["name"] = line
                break

    # 5. Designation / Class
    for line in valid_lines:
        u = line.upper()
        if any(keyword in u for keyword in ["B.TECH", "B.E", "BACHELOR", "INFORMATION TECHNOLOGY", "DEVELOPER", "MANAGER", "ENGINEER"]):
            data["designation_or_class"] = line.strip()
            break
    
    if not data["designation_or_class"]:
        for i, line in enumerate(valid_lines):
            u = line.upper()
            if "CLASS" in u:
                 val = re.sub(r'CLASS\s*[:\-]*', '', line, flags=re.IGNORECASE).strip()
                 data["designation_or_class"] = f"Class {val}"
                 break
            elif "DESIGNATION" in u:
                 val = line.split(":")[-1].strip()
                 data["designation_or_class"] = val if val else (valid_lines[i+1] if i+1<len(valid_lines) else None)
                 break

    # 6. DOB
    dob_match = re.search(r'\b\d{1,2}[-./\s]+(?:[0-9]{2}|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*[-./\s]+\d{4}\b', text_blob, re.IGNORECASE)
    if dob_match:
        data["dob"] = dob_match.group()

    # 7. ADDRESS Extraction (NEW)
    if not data["address"]:
        addr_start_idx = -1
        # Find line with "Address"
        for i, line in enumerate(valid_lines):
            if "ADDRESS" in line.upper():
                addr_start_idx = i
                break
        
        if addr_start_idx != -1:
            addr_lines = []
            # Capture lines until we hit a phone number pattern or end
            for i in range(addr_start_idx + 1, len(valid_lines)):
                line = valid_lines[i]
                # If line is mostly digits (phone number), stop or skip
                if sum(c.isdigit() for c in line) > 6: 
                    break 
                # If line is clearly a new label (e.g. "Blood Group")
                if ":" in line and "ADDRESS" not in line.upper():
                    break
                    
                addr_lines.append(line.strip())
            
            if addr_lines:
                data["address"] = ", ".join(addr_lines)

    return data

if __name__ == "__main__":
    try:
        if len(sys.argv) < 2:
            print(json.dumps({"error": "No image provided"}))
        else:
            front_path = sys.argv[1]
            back_path = sys.argv[2] if len(sys.argv) > 2 else None
            
            lines = []
            if os.path.exists(front_path):
                lines += extract_lines(front_path)
            
            if back_path and back_path != 'null' and os.path.exists(back_path):
                lines += extract_lines(back_path)

            if not lines:
                print(json.dumps({"error": "No text found in images"}))
            else:
                full_text_upper = " ".join(lines).upper()
                
                if "ELECTION" in full_text_upper or "ELECTOR" in full_text_upper:
                    result = parse_voter_id(lines)
                else:
                    result = parse_generic_id(lines)
                
                print(json.dumps(result))
                
    except Exception as e:
        print(json.dumps({"error": str(e)}))