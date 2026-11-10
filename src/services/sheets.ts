export interface SpreadsheetInfo {
  id: string;
  name: string;
  url?: string;
  isNewlyCreated: boolean;
  ownerEmail?: string | null;
  isShared: boolean;
}

const HEADERS = ['Ngày', 'Mã', 'Họ tên', 'Trạng thái', 'Ghi chú'];
const TARGET_FILE_NAME = 'Sổ điểm danh';
const TARGET_SHEET_NAME = 'DiemDanh';

/**
 * Lấy ID bảng tính dùng chung đã lưu trên server (nếu có)
 */
export async function getSharedSheetConfig(): Promise<{
  spreadsheetId: string | null;
  spreadsheetName: string | null;
  ownerEmail: string | null;
  webViewLink?: string | null;
}> {
  try {
    const res = await fetch('/api/shared-sheet');
    if (res.ok) {
      return await res.json();
    }
  } catch (e) {
    console.warn('Không thể kết nối API shared-sheet trên server:', e);
  }
  return { spreadsheetId: null, spreadsheetName: null, ownerEmail: null };
}

/**
 * Đăng ký / cập nhật bảng tính dùng chung lên server để các tài khoản khác cùng dùng
 */
export async function saveSharedSheetConfig(
  spreadsheetId: string,
  spreadsheetName: string,
  ownerEmail?: string | null,
  webViewLink?: string | null
): Promise<void> {
  try {
    await fetch('/api/shared-sheet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        spreadsheetId,
        spreadsheetName,
        ownerEmail,
        webViewLink,
      }),
    });
  } catch (e) {
    console.warn('Lỗi ghi cấu hình shared-sheet lên server:', e);
  }
}

/**
 * Tìm hoặc tạo bảng tính "Sổ điểm danh" dùng chung cho mọi tài khoản đăng nhập
 */
export async function getOrCreateAttendanceSpreadsheet(
  accessToken: string,
  currentUserEmail?: string | null,
  customSheetId?: string | null
): Promise<SpreadsheetInfo> {
  // 1. Kiểm tra ID bảng tính dùng chung được chỉ định hoặc từ URL / server
  let candidateSheetId = customSheetId;

  if (!candidateSheetId) {
    // Kiểm tra tham số ?sheetId= trên thanh địa chỉ trình duyệt
    const urlParams = new URLSearchParams(window.location.search);
    const paramId = urlParams.get('sheetId');
    if (paramId) {
      candidateSheetId = paramId.trim();
    }
  }

  if (!candidateSheetId) {
    // Kiểm tra cấu hình dùng chung đã lưu trên server
    const serverConfig = await getSharedSheetConfig();
    if (serverConfig.spreadsheetId) {
      candidateSheetId = serverConfig.spreadsheetId;
    }
  }

  // 2. Nếu đã có ID bảng tính dùng chung, thử truy cập trực tiếp
  if (candidateSheetId) {
    try {
      const checkRes = await fetch(
        `https://sheets.googleapis.com/v4/spreadsheets/${candidateSheetId}?fields=properties.title,spreadsheetUrl`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );

      if (checkRes.ok) {
        const sheetData = await checkRes.json();
        await ensureSheetAndHeaders(accessToken, candidateSheetId);

        // Lưu lại để đảm bảo server luôn có ID mới nhất
        await saveSharedSheetConfig(
          candidateSheetId,
          sheetData.properties?.title || TARGET_FILE_NAME,
          currentUserEmail,
          sheetData.spreadsheetUrl
        );

        return {
          id: candidateSheetId,
          name: sheetData.properties?.title || TARGET_FILE_NAME,
          url: sheetData.spreadsheetUrl || `https://docs.google.com/spreadsheets/d/${candidateSheetId}/edit`,
          isNewlyCreated: false,
          isShared: true,
        };
      } else if (checkRes.status === 403) {
        // Tài khoản khác chưa được cấp quyền trên file này
        throw new Error(
          `Tài khoản (${currentUserEmail || 'này'}) chưa được cấp quyền chỉnh sửa bảng tính dùng chung ID [${candidateSheetId}]. Vui lòng nhờ người tạo bảng tính chia sẻ quyền "Người chỉnh sửa" (Editor) trên Google Sheets.`
        );
      }
    } catch (err: any) {
      // Nếu là lỗi 403 quyền truy cập, ném ra để giao diện hiển thị hướng dẫn
      if (err.message && err.message.includes('chưa được cấp quyền')) {
        throw err;
      }
      console.warn('Không thể mở bảng tính candidate ID, chuyển sang tìm kiếm Drive:', err);
    }
  }

  // 3. Nếu chưa có trên server, tìm trong Google Drive của tài khoản hiện tại xem đã có file "Sổ điểm danh" chưa
  const query = encodeURIComponent(
    `name = '${TARGET_FILE_NAME}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`
  );
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name,webViewLink)&pageSize=5`;

  const searchRes = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!searchRes.ok) {
    const errorText = await searchRes.text();
    console.error('Lỗi tìm kiếm file trên Drive:', errorText);
    throw new Error('Không thể kiểm tra file trên Google Drive');
  }

  const searchData = await searchRes.json();
  const existingFile = searchData.files && searchData.files.length > 0 ? searchData.files[0] : null;

  if (existingFile) {
    const spreadsheetId = existingFile.id;
    await ensureSheetAndHeaders(accessToken, spreadsheetId);

    // Lưu ID này lên server làm bảng tính dùng chung cho tất cả các tài khoản khác khi vào app
    await saveSharedSheetConfig(
      spreadsheetId,
      existingFile.name || TARGET_FILE_NAME,
      currentUserEmail,
      existingFile.webViewLink
    );

    return {
      id: spreadsheetId,
      name: existingFile.name || TARGET_FILE_NAME,
      url: existingFile.webViewLink,
      isNewlyCreated: false,
      isShared: true,
    };
  }

  // 4. Nếu chưa tài khoản nào tạo, tạo mới bảng tính "Sổ điểm danh" và lưu ID làm file dùng chung
  const createUrl = 'https://sheets.googleapis.com/v4/spreadsheets';
  const createPayload = {
    properties: {
      title: TARGET_FILE_NAME,
    },
    sheets: [
      {
        properties: {
          title: TARGET_SHEET_NAME,
          gridProperties: {
            frozenRowCount: 1,
          },
        },
        data: [
          {
            startRow: 0,
            startColumn: 0,
            rowData: [
              {
                values: HEADERS.map((header) => ({
                  userEnteredValue: { stringValue: header },
                  userEnteredFormat: {
                    textFormat: { bold: true },
                    backgroundColor: { red: 0.9, green: 0.95, blue: 1.0 },
                  },
                })),
              },
            ],
          },
        ],
      },
    ],
  };

  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(createPayload),
  });

  if (!createRes.ok) {
    const errorText = await createRes.text();
    console.error('Lỗi tạo bảng tính:', errorText);
    throw new Error('Không thể tạo bảng tính mới trên Google Sheets');
  }

  const newSpreadsheet = await createRes.json();
  const newId = newSpreadsheet.spreadsheetId;
  const newUrl = newSpreadsheet.spreadsheetUrl;

  // Tự động cấp quyền "Bất kỳ ai có liên kết đều có thể chỉnh sửa" để các giáo viên khác cùng dùng được
  try {
    await grantLinkEditPermission(accessToken, newId);
  } catch (e) {
    console.warn('Không thể tự động cấp quyền link chia sẻ:', e);
  }

  // Đăng ký ID này lên server để các tài khoản khác khi vào sẽ dùng chung ngay
  await saveSharedSheetConfig(
    newId,
    TARGET_FILE_NAME,
    currentUserEmail,
    newUrl
  );

  return {
    id: newId,
    name: TARGET_FILE_NAME,
    url: newUrl,
    isNewlyCreated: true,
    isShared: true,
  };
}

/**
 * Cấp quyền cho bất kỳ ai có liên kết được chỉnh sửa bảng tính (Google Drive API v3 dùng role: 'writer')
 */
export async function grantLinkEditPermission(accessToken: string, fileId: string): Promise<{ success: boolean; message?: string }> {
  const permUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`;
  const res = await fetch(permUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role: 'writer',
      type: 'anyone',
    }),
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => null);
    const errorMsg = errorJson?.error?.message || (await res.text().catch(() => 'Lỗi không xác định'));
    console.error('Lỗi cấp quyền anyone writer:', errorMsg);

    if (errorMsg.includes('sharingOutsideDomainNotAllowed') || errorMsg.includes('policy')) {
      throw new Error('Chính sách trường/tổ chức (Google Workspace) chặn chia sẻ công khai "Bất kỳ ai". Vui lòng dùng tính năng chia sẻ theo Email của đồng nghiệp bên dưới.');
    }
    throw new Error(`Google Drive từ chối cấp quyền: ${errorMsg}`);
  }

  return { success: true };
}

/**
 * Cấp quyền chỉnh sửa cho một email Gmail / FPT cụ thể
 */
export async function shareWithEmail(
  accessToken: string,
  fileId: string,
  email: string
): Promise<{ success: boolean; message?: string }> {
  const permUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?sendNotificationEmail=false&supportsAllDrives=true`;
  const res = await fetch(permUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role: 'writer',
      type: 'user',
      emailAddress: email.trim(),
    }),
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => null);
    const errorMsg = errorJson?.error?.message || (await res.text().catch(() => 'Lỗi không xác định'));
    console.error('Lỗi chia sẻ cho email:', errorMsg);
    throw new Error(`Không thể cấp quyền cho ${email}: ${errorMsg}`);
  }

  return { success: true };
}

/**
 * Cấp quyền cho toàn bộ thành viên trong tổ chức domain (ví dụ: fpt.edu.vn)
 */
export async function shareWithDomain(
  accessToken: string,
  fileId: string,
  domain: string
): Promise<{ success: boolean; message?: string }> {
  const permUrl = `https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`;
  const res = await fetch(permUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      role: 'writer',
      type: 'domain',
      domain: domain.trim(),
    }),
  });

  if (!res.ok) {
    const errorJson = await res.json().catch(() => null);
    const errorMsg = errorJson?.error?.message || 'Lỗi không xác định';
    throw new Error(`Không thể chia sẻ cho domain ${domain}: ${errorMsg}`);
  }

  return { success: true };
}

/**
 * Đảm bảo bảng tính hiện có chứa sheet "DiemDanh" và có các cột: Ngày, Mã, Họ tên, Trạng thái, Ghi chú
 */
async function ensureSheetAndHeaders(accessToken: string, spreadsheetId: string): Promise<void> {
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`;
  const metaRes = await fetch(metaUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!metaRes.ok) {
    throw new Error('Không thể đọc cấu trúc bảng tính');
  }

  const metaData = await metaRes.json();
  const sheets = metaData.sheets || [];
  const hasDiemDanh = sheets.some((s: any) => s.properties?.title === TARGET_SHEET_NAME);

  if (!hasDiemDanh) {
    // Thêm tab "DiemDanh"
    const addSheetRes = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        requests: [
          {
            addSheet: {
              properties: {
                title: TARGET_SHEET_NAME,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          },
        ],
      }),
    });

    if (!addSheetRes.ok) {
      throw new Error('Không thể thêm trang tính DiemDanh');
    }
  }

  // Kiểm tra hoặc ghi dòng tiêu đề A1:E1
  const headerCheckUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TARGET_SHEET_NAME}!A1:E1`;
  const headerCheckRes = await fetch(headerCheckUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (headerCheckRes.ok) {
    const headerData = await headerCheckRes.json();
    if (!headerData.values || headerData.values.length === 0 || headerData.values[0].length === 0) {
      // Ghi tiêu đề vào nếu chưa có
      await fetch(`${headerCheckUrl}?valueInputOption=USER_ENTERED`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          range: `${TARGET_SHEET_NAME}!A1:E1`,
          majorDimension: 'ROWS',
          values: [HEADERS],
        }),
      });
    }
  }
}

/**
 * Chuyển đổi mã trạng thái sang tiếng Việt lưu trong Google Sheets
 */
export function getStatusLabel(status: 'present' | 'absent' | 'excused'): string {
  switch (status) {
    case 'present':
      return 'Có mặt';
    case 'absent':
      return 'Vắng';
    case 'excused':
      return 'Có phép';
    default:
      return 'Có mặt';
  }
}

/**
 * Chuyển đổi chuỗi tiếng Việt từ Sheets sang mã trạng thái
 */
export function parseStatusFromLabel(label: string): 'present' | 'absent' | 'excused' {
  const normalized = (label || '').trim().toLowerCase();
  if (normalized.includes('vắng') || normalized === 'absent') {
    return 'absent';
  }
  if (normalized.includes('phép') || normalized === 'excused') {
    return 'excused';
  }
  return 'present';
}

export interface AttendanceRecordInput {
  code: string;
  name: string;
  status: 'present' | 'absent' | 'excused';
  note: string;
}

/**
 * Ghi trạng thái và ghi chú của tất cả sinh viên vào trang "DiemDanh", theo ngày đang chọn.
 * Nếu ngày đó đã có dòng trong bảng tính thì cập nhật đúng dòng đó, không tạo dòng trùng.
 */
export async function saveAttendanceRecords(
  accessToken: string,
  spreadsheetId: string,
  date: string,
  records: AttendanceRecordInput[]
): Promise<{ updatedCount: number; insertedCount: number }> {
  // 1. Đảm bảo sheet và tiêu đề tồn tại
  await ensureSheetAndHeaders(accessToken, spreadsheetId);

  // 2. Đọc toàn bộ dữ liệu hiện có trong trang DiemDanh!A:E
  const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TARGET_SHEET_NAME}!A:E`;
  const readRes = await fetch(readUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!readRes.ok) {
    const errorMsg = await readRes.text();
    console.error('Lỗi đọc bảng tính trước khi lưu:', errorMsg);
    throw new Error('Không thể đọc dữ liệu từ bảng tính "Sổ điểm danh". Vui lòng thử lại.');
  }

  const readData = await readRes.json();
  const rows = (readData.values || []) as string[][];

  const updateBatch: { range: string; values: string[][] }[] = [];
  const rowsToAppend: string[][] = [];
  const handledCodes = new Set<string>();

  // 3. Quét các dòng đã có để tìm dòng trùng ngày & mã SV (dòng 1 là tiêu đề nên duyệt từ index 1)
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowDate = (row[0] || '').trim();
    const rowCode = (row[1] || '').trim();

    if (rowDate === date.trim()) {
      const match = records.find(
        (r) => r.code.trim().toLowerCase() === rowCode.toLowerCase()
      );
      if (match) {
        // Cập nhật đúng dòng đó (Sheets tính chỉ số dòng bắt đầu từ 1)
        const sheetRowIndex = i + 1;
        updateBatch.push({
          range: `${TARGET_SHEET_NAME}!A${sheetRowIndex}:E${sheetRowIndex}`,
          values: [
            [
              date.trim(),
              match.code.trim(),
              match.name.trim(),
              getStatusLabel(match.status),
              match.note || '',
            ],
          ],
        });
        handledCodes.add(match.code.trim().toLowerCase());
      }
    }
  }

  // 4. Với những sinh viên chưa có dòng trong ngày đó, chuẩn bị thêm mới
  for (const record of records) {
    if (!handledCodes.has(record.code.trim().toLowerCase())) {
      rowsToAppend.push([
        date.trim(),
        record.code.trim(),
        record.name.trim(),
        getStatusLabel(record.status),
        record.note || '',
      ]);
    }
  }

  // 5. Thực hiện cập nhật các dòng đã có (nếu có)
  if (updateBatch.length > 0) {
    const batchUpdateUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`;
    const batchRes = await fetch(batchUpdateUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'USER_ENTERED',
        data: updateBatch,
      }),
    });

    if (!batchRes.ok) {
      const err = await batchRes.text();
      console.error('Lỗi cập nhật dòng điểm danh:', err);
      throw new Error('Lỗi khi cập nhật bản ghi điểm danh cũ trong bảng tính.');
    }
  }

  // 6. Thực hiện thêm các dòng mới (nếu có)
  if (rowsToAppend.length > 0) {
    const appendUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TARGET_SHEET_NAME}!A:E:append?valueInputOption=USER_ENTERED`;
    const appendRes = await fetch(appendUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        values: rowsToAppend,
      }),
    });

    if (!appendRes.ok) {
      const err = await appendRes.text();
      console.error('Lỗi ghi thêm dòng điểm danh mới:', err);
      throw new Error('Lỗi khi thêm bản ghi điểm danh mới vào bảng tính.');
    }
  }

  return {
    updatedCount: updateBatch.length,
    insertedCount: rowsToAppend.length,
  };
}

/**
 * Tải dữ liệu điểm danh theo ngày đã chọn từ trang "DiemDanh"
 */
export async function loadAttendanceByDate(
  accessToken: string,
  spreadsheetId: string,
  date: string
): Promise<Map<string, { status: 'present' | 'absent' | 'excused'; note: string }>> {
  const readUrl = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${TARGET_SHEET_NAME}!A:E`;
  const readRes = await fetch(readUrl, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!readRes.ok) {
    throw new Error('Không thể đọc dữ liệu điểm danh từ bảng tính');
  }

  const readData = await readRes.json();
  const rows = (readData.values || []) as string[][];
  const resultMap = new Map<string, { status: 'present' | 'absent' | 'excused'; note: string }>();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowDate = (row[0] || '').trim();
    const rowCode = (row[1] || '').trim().toLowerCase();
    const statusLabel = row[3] || '';
    const note = row[4] || '';

    if (rowDate === date.trim() && rowCode) {
      resultMap.set(rowCode, {
        status: parseStatusFromLabel(statusLabel),
        note: note,
      });
    }
  }

  return resultMap;
}
