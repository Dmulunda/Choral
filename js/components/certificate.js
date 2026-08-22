// Printable "Certificate of Completion" — opened in a fresh browser
// window/tab with entirely self-contained HTML (its own <style>, no
// dependency on the app's stylesheet) so printing it doesn't drag in
// the sidebar/nav or fight the app's own print behavior. Only shown
// once course_approvals.status is 'approved' — see courseCatalog.js.
import { t } from '../i18n.js';

export function openCertificate({ studentName, courseTitle, approvedAt }) {
  const dateLabel = new Date(approvedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const logoUrl = `${window.location.origin}/img/vpd-logo.png`;

  const html = `
    <!DOCTYPE html>
    <html lang="${document.documentElement.lang || 'en'}">
    <head>
      <meta charset="UTF-8" />
      <title>${escapeHtml(t('courses.certificateTitle'))} — ${escapeHtml(studentName)}</title>
      <style>
        @page { size: landscape; margin: 0; }
        body {
          margin: 0;
          font-family: Georgia, 'Times New Roman', serif;
          background: #f1f5f9;
          display: flex;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
        }
        .certificate {
          background: white;
          width: 900px;
          max-width: 95vw;
          padding: 60px 70px;
          border: 12px solid #0B1F3A;
          outline: 2px solid #D4AF37;
          outline-offset: -20px;
          text-align: center;
          box-sizing: border-box;
        }
        .certificate img { height: 80px; margin-bottom: 16px; }
        .certificate h1 {
          font-size: 14px;
          letter-spacing: 4px;
          text-transform: uppercase;
          color: #D4AF37;
          margin: 0 0 8px;
        }
        .certificate h2 {
          font-size: 32px;
          color: #0B1F3A;
          margin: 0 0 24px;
        }
        .certificate .presented-to { font-size: 14px; color: #64748b; margin-bottom: 8px; }
        .certificate .student-name {
          font-size: 40px;
          color: #0B1F3A;
          margin: 0 0 24px;
          border-bottom: 1px solid #cbd5e1;
          display: inline-block;
          padding-bottom: 8px;
        }
        .certificate .course-line { font-size: 16px; color: #334155; margin-bottom: 32px; }
        .certificate .course-title { font-weight: bold; color: #0B1F3A; }
        .certificate .date { font-size: 14px; color: #64748b; }
        .no-print { text-align: center; margin-top: 20px; }
        .no-print button {
          font-family: inherit;
          font-size: 14px;
          padding: 10px 20px;
          border-radius: 8px;
          border: none;
          background: #0B1F3A;
          color: white;
          cursor: pointer;
        }
        @media print { .no-print { display: none; } body { background: white; } }
      </style>
    </head>
    <body>
      <div>
        <div class="certificate">
          <img src="${logoUrl}" alt="" />
          <h1>${escapeHtml(t('courses.certificateEyebrow'))}</h1>
          <h2>${escapeHtml(t('courses.certificateTitle'))}</h2>
          <p class="presented-to">${escapeHtml(t('courses.certificatePresentedTo'))}</p>
          <p class="student-name">${escapeHtml(studentName)}</p>
          <p class="course-line">${escapeHtml(t('courses.certificateFor'))} <span class="course-title">${escapeHtml(courseTitle)}</span></p>
          <p class="date">${escapeHtml(dateLabel)}</p>
        </div>
        <div class="no-print">
          <button onclick="window.print()">${escapeHtml(t('courses.print'))}</button>
        </div>
      </div>
    </body>
    </html>
  `;

  const win = window.open('', '_blank');
  if (!win) {
    window.alert(t('courses.certificatePopupBlocked'));
    return;
  }
  win.document.write(html);
  win.document.close();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
