const { runOCR } = require('./ocrEngine');

async function parseInvoice(filePath) {
    const { lines, fullText } = await runOCR(filePath);

    const data = {
        vendor_name: "INVOICE",
        invoice_number: "",
        date: "",
        total_amount: "0.00",
        bill_to: ""
    };

    /* ---------------- INVOICE NUMBER ---------------- */
    const invMatch = fullText.match(/Invoice\s*#?\s*[:\-]?\s*([A-Z0-9\-]+)/i);
    if (invMatch) {
        data.invoice_number = invMatch[1];
    }

    /* ---------------- DATE ---------------- */
    const dateMatch = fullText.match(
        /Date\s*[:\-]?\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})/i
    );
    if (dateMatch) {
        data.date = dateMatch[1];
    }

    /* ---------------- BILL TO ---------------- */
    const billIdx = lines.findIndex(l => /BILL\s*TO/i.test(l.text));
    if (billIdx !== -1) {
        const billLines = [];
        for (let i = billIdx + 1; i < billIdx + 5 && i < lines.length; i++) {
            if (!/invoice|date|due/i.test(lines[i].text)) {
                billLines.push(lines[i].text);
            }
        }
        data.bill_to = billLines.join(', ');
    }

    /* ---------------- TOTAL AMOUNT ---------------- */
    const totalMatch = fullText.match(
        /TOTAL\s*[:\-]?\s*\$?\s*([\d,]+\.\d{2})/i
    );

    if (totalMatch) {
        data.total_amount = totalMatch[1].replace(/,/g, '');
    } else {
        // fallback: max amount
        const amounts = [];
        lines.forEach(l => {
            const m = l.text.match(/(\d{1,3}(?:,\d{3})*\.\d{2})/);
            if (m) amounts.push(parseFloat(m[1].replace(/,/g, '')));
        });
        if (amounts.length > 0) {
            data.total_amount = Math.max(...amounts).toFixed(2);
        }
    }

    return {
        type: 'Invoice',
        fields: data
    };
}

module.exports = { parseInvoice };
