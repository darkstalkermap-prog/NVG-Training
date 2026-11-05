// Render the class packet HTML files to Letter-size PDFs: node class/src/make_pdfs.js
const { chromium } = require('playwright'); const path = require('path');
const files = [['lesson_plan', '1_Instructor_Lesson_Plan'], ['written_exam', '2_Written_Exam'], ['answer_key', '3_Answer_Key_INSTRUCTOR_ONLY']];
(async () => { const b = await chromium.launch(); const p = await b.newPage();
  for (const [src, out] of files) { await p.goto('file://' + path.join(__dirname, src + '.html')); await p.evaluate(() => document.fonts.ready);
    await p.pdf({ path: path.join(__dirname, '..', out + '.pdf'), format: 'Letter', printBackground: true, preferCSSPageSize: true,
      displayHeaderFooter: true, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:8px;width:100%;text-align:center;color:#666">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>' });
    console.log(out); }
  await b.close(); })();
