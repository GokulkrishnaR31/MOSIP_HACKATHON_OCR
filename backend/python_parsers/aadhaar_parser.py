import easyocr
import re
import json
import sys
import os
import cv2

reader = easyocr.Reader(['en', 'hi'], gpu=False, verbose=False)

def extract_lines(image_path):
    image_path = os.path.abspath(image_path)

    # 🔥 Force-load using PIL first
    from PIL import Image

    try:
        img_pil = Image.open(image_path).convert("RGB")
        img_pil.save(image_path)
    except Exception as e:
        print(json.dumps({"error": "Image format not supported"}))
        sys.exit(0)

    # Now OpenCV WILL read it
    img = cv2.imread(image_path)
    if img is None:
        print(json.dumps({"error": "Image not readable by OpenCV"}))
        sys.exit(0)

    # Resize for speed
    h, w = img.shape[:2]
    if w > 1200:
        scale = 1200 / w
        img = cv2.resize(img, (int(w*scale), int(h*scale)))
        cv2.imwrite(image_path, img)

    return reader.readtext(image_path, detail=0)


def clean_value(text):
    if not text:
        return ""
    text = re.sub(r'[^\x00-\x7F]+', ' ', text)
    return text.strip()

def parse_aadhaar(lines):
    data = {
        "full_name": None,
        "dob": None,
        "gender": None,
        "id_number": None,
        "address": None,
        "mobile": None
    }

    cleaned = [clean_value(l) for l in lines if len(clean_value(l)) > 2]
    full_text = "\n".join(cleaned)

    m = re.search(r'\b\d{4}\s\d{4}\s\d{4}\b', full_text)
    if m:
        data["id_number"] = m.group()

    dob = re.search(r'\b\d{2}[-/]\d{2}[-/]\d{4}\b', full_text)
    if dob:
        data["dob"] = dob.group().replace('/', '-')

    if re.search(r'\bMALE\b', full_text, re.I):
        data["gender"] = "Male"
    elif re.search(r'\bFEMALE\b', full_text, re.I):
        data["gender"] = "Female"

    for i, line in enumerate(cleaned):
        if "GOVERNMENT" in line.upper():
            for j in range(1, 4):
                if i + j < len(cleaned):
                    cand = cleaned[i + j]
                    if not any(x in cand.upper() for x in ["DOB", "AADHAAR", "INDIA"]) and not any(c.isdigit() for c in cand):
                        data["full_name"] = cand
                        break
            break

    for i, line in enumerate(cleaned):
        if "ADDRESS" in line.upper():
            addr = []
            for j in range(i + 1, len(cleaned)):
                addr.append(cleaned[j])
                if re.search(r'\b\d{6}\b', cleaned[j]):
                    break
            data["address"] = ", ".join(addr)
            break

    return data

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No image provided"}))
    else:
        path = sys.argv[1]
        if os.path.exists(path):
            lines = extract_lines(path)
            print(json.dumps(parse_aadhaar(lines)))
        else:
            print(json.dumps({"error": "File not found"}))
